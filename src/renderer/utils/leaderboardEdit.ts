/**
 * The edit-mode preview of the leaderboard, as plain functions: what a typed
 * result does to the rows on screen. The hook (useLeaderboardEdit) only holds
 * the state and calls these.
 *
 * Scoring rules are NOT written here. A race column is re-ranked by
 * shared/raceColumnEdit (the main process runs the same code on Save, so what
 * is shown is what is saved), discards come from applyExclusions, and redress
 * averages from shared/redress via averageRacePoints.
 */
import {
  PENALTY_CODES,
  applyExclusions,
  averageRacePoints,
  parseRaceNum,
  stripExclusionParens,
} from './leaderboardUtils';
import {
  getScoringPenaltyPoints,
  scoringPenaltyStatuses,
} from '../../shared/scoringPenalty';
import applyRaceColumnEdit from '../../shared/raceColumnEdit';
import type { LeaderboardEntry } from '../types';

/**
 * A result the user changed this session, kept so Save knows which races to
 * write and RDG averages can follow later edits.
 */
export interface UserRaceEdit {
  boatId: number;
  raceIndex: number;
  rawPosition: number;
  status: string;
  // SHRS 5.6: indices into the edited cell's OWN series race list.
  rdgSelection?: { seriesIndices: number[] };
}

/** Position + scored points + status for one boat in one race column. */
interface RaceCellState {
  position: number;
  points: number;
  status: string;
}

/** What the edit preview needs to know about the series being edited. */
export interface EditScoringContext {
  finalSeriesStarted: boolean;
  discardProfile: string;
  /** Largest heat of the edited series; 0 while it is not loaded. */
  maxHeatSize: number;
  /** Discard race count for the entry being (re)scored. */
  raceCountFor: (entry: LeaderboardEntry) => number;
}

const fleetOf = (entry: LeaderboardEntry): string =>
  String(entry.placement_group ?? 'General');

export function createEditScoringContext(
  rows: LeaderboardEntry[],
  finalSeriesStarted: boolean,
  discardProfile: string,
  maxHeatSize: number,
): EditScoringContext {
  // SHRS 5.4 (MEGA M-NEW-1): series-wide completed-race count for the series
  // being edited, used so edit-mode discard previews match the backend's
  // series-wide count. Column count is stable across a single cell edit, so
  // reading it from the rows on screen is safe.
  const seriesRaceCount = Math.max(0, ...rows.map((e) => e.races?.length || 0));

  // SHRS 5.1: the Final Series is scored per fleet, and fleets may sail
  // different numbers of races (SHRS 4.5). A final edit's discard count must
  // therefore be the largest race count in the edited boat's OWN fleet — not the
  // max across all fleets, which would over-discard boats in shorter-race
  // fleets and disagree with the fleet-wide totals the backend persists.
  const fleetRaceCounts = finalSeriesStarted
    ? rows.reduce((acc, e) => {
        acc.set(
          fleetOf(e),
          Math.max(acc.get(fleetOf(e)) ?? 0, e.races?.length || 0),
        );
        return acc;
      }, new Map<string, number>())
    : null;

  return {
    finalSeriesStarted,
    discardProfile,
    maxHeatSize,
    // Fleet-wide in the Final Series, series-wide while qualifying-only.
    raceCountFor: (entry) =>
      finalSeriesStarted
        ? (fleetRaceCounts?.get(fleetOf(entry)) ?? 0)
        : seriesRaceCount,
  };
}

/**
 * SHRS 5.2: a non-position-keeping penalty scores largest-heat-size + 1. Uses
 * the largest heat of the series whose cells are editable (RULE-m4) and falls
 * back to the entry count only if heat sizes are not yet loaded.
 */
export const getPenaltyPosition = (
  ctx: EditScoringContext,
  entryCount: number,
): number => (ctx.maxHeatSize || entryCount) + 1;

// ─── Redress averages (RRS A9) ────────────────────────────────────────────────

// RRS A9: redress averages use the boat's POINTS in the other races. Race
// cells hold finishing places, which differ from points for position-keeping
// penalties (ZFP/SCP/T1), so averages must read race_points instead — with
// the cells as fallback when the points array is absent or misaligned.
const pointsCellsForAverage = (entry: LeaderboardEntry): string[] =>
  entry.race_points && entry.race_points.length === entry.races.length
    ? entry.race_points.map(String)
    : entry.races.map(String);

/**
 * RRS A9(a): RDG1 — average of the boat's points in all the other races of the
 * series. Penalty scores are her points and are included in the average.
 */
export const averageAllRacePoints = (
  entry: LeaderboardEntry,
  excludeIdx: number,
  penaltyPos: number,
): number =>
  averageRacePoints(
    pointsCellsForAverage(entry),
    null,
    excludeIdx,
    penaltyPos,
    entry.race_statuses,
  );

// RULE-M10 / SHRS 5.6: "averages shall be calculated separately for each of
// the Qualifying and Final Series." An RDG2 average therefore only ever
// covers races in the SAME series as the redressed cell — the boat's races on
// the leaderboard currently being edited. Pooling qualifying and final race
// points into one average (the previous behaviour) grants the wrong redress
// whenever the two series have different points profiles.
/** RRS A9(b): RDG2 — average of her points in the selected group of races. */
export const averageSelectedRacePoints = (
  entry: LeaderboardEntry,
  seriesIndices: number[],
  excludeIdx: number,
  penaltyPos: number,
): number =>
  averageRacePoints(
    pointsCellsForAverage(entry),
    new Set(seriesIndices),
    excludeIdx,
    penaltyPos,
    entry.race_statuses || [],
  );

// ─── Rescoring one entry ──────────────────────────────────────────────────────

// Position-keeping penalties (ZFP/SCP/T1) display their finishing place, but
// score more points (RRS 44.3c/T1). The race cells store the place, so the
// edit-mode preview total must convert those cells to their penalty points
// via the shared getScoringPenaltyPoints before summing.
// Other statuses already store their points as the cell value.
const toScoreValuesForTotal = (
  rawRaces: string[],
  statuses: string[],
  penaltyPosition: number,
): Array<string | number> => {
  const maxBoats = penaltyPosition - 1;
  return rawRaces.map((race, i) => {
    const status = statuses[i] || 'FINISHED';
    if (!scoringPenaltyStatuses.has(status)) return race;
    const place = parseFloat(stripExclusionParens(race));
    if (Number.isNaN(place)) return race;
    return getScoringPenaltyPoints(place, maxBoats, status);
  });
};

const defaultStatuses = (entry: LeaderboardEntry): string[] =>
  entry.race_statuses
    ? [...entry.race_statuses]
    : entry.races.map(() => 'FINISHED');

/**
 * Run discards over `positions` / `points` / `statuses` and return the entry
 * with its races, points and every total brought up to date. Every edit path
 * ends here.
 */
function rescoreEntry(
  entry: LeaderboardEntry,
  ctx: EditScoringContext,
  positions: string[],
  points: Array<string | number>,
  statuses: string[],
): LeaderboardEntry {
  const { markedRaces, total } = applyExclusions(
    positions,
    statuses,
    points,
    ctx.discardProfile,
    ctx.raceCountFor(entry),
  );
  return {
    ...entry,
    races: markedRaces,
    // The scored points (not the raw place), so the Gross column and any
    // race_points consumer match the backend's read-mode semantics.
    race_points: points.map(String),
    race_statuses: statuses,
    total_points_event: total,
    total_points_final: total,
    computed_total: total,
    // Keep the Overall column (SHRS 5.4 combined total) in sync with the
    // live edit. Without this only Gross + F-Tot move while editing; Overall
    // stays stale until save. qualifying_points is fixed during the final
    // series, so combined = qualifying + the new final total.
    ...(ctx.finalSeriesStarted
      ? {
          total_points_combined: (Number(entry.qualifying_points) || 0) + total,
        }
      : {}),
  };
}

/**
 * Set one cell of `entry` to a redress average (RDG1/RDG2). The points of the
 * other cells are derived from their places, as the backend's read does.
 */
export function withRedressAverage(
  entry: LeaderboardEntry,
  ctx: EditScoringContext,
  raceIndex: number,
  average: number,
  status: string,
  penaltyPosition: number,
): LeaderboardEntry {
  const positions = entry.races.map(stripExclusionParens);
  const statuses = defaultStatuses(entry);
  positions[raceIndex] = String(average);
  statuses[raceIndex] = status;
  return rescoreEntry(
    entry,
    ctx,
    positions,
    toScoreValuesForTotal(positions, statuses, penaltyPosition),
    statuses,
  );
}

/**
 * RRS A9: a redress average must reflect the boat's ACTUAL points, so RDG1/
 * RDG2 cells granted THIS session are recomputed whenever an edit changes any
 * race points they average over (the boat's own races, including ripples
 * caused by edits to other boats). RDG cells loaded from the DB are left
 * untouched — they were granted against an earlier state and are not this
 * session's to alter.
 *
 * Returns the refreshed rows plus the queued edits whose value changed, so
 * the save persists the up-to-date average (the caller stores them).
 */
export function refreshSessionRdgAverages(
  rows: LeaderboardEntry[],
  edits: Map<string, UserRaceEdit>,
  ctx: EditScoringContext,
): { rows: LeaderboardEntry[]; changedEdits: Array<[string, UserRaceEdit]> } {
  // All averages are computed from the SAME snapshot (the rows as passed in,
  // i.e. right after the triggering edit). RDG cells can reference each
  // other's points; cascading each refresh into the next would make the
  // result depend on edit-map iteration order.
  const indexOfBoat = new Map<unknown, number>();
  rows.forEach((e, i) => {
    if (!indexOfBoat.has(e.boat_id)) indexOfBoat.set(e.boat_id, i);
  });
  const next = [...rows];
  const changedEdits: Array<[string, UserRaceEdit]> = [];
  const penaltyPosition = getPenaltyPosition(ctx, rows.length);

  edits.forEach((edit, key) => {
    if (edit.status !== 'RDG1' && edit.status !== 'RDG2') return;
    const entryIdx = indexOfBoat.get(edit.boatId);
    if (entryIdx === undefined) return;
    const snapEntry = rows[entryIdx];

    let avg: number;
    if (edit.status === 'RDG1') {
      avg = averageAllRacePoints(snapEntry, edit.raceIndex, penaltyPosition);
    } else {
      const selection = edit.rdgSelection;
      if (!selection) return;
      // SHRS 5.6: same-series races only.
      avg = averageSelectedRacePoints(
        snapEntry,
        selection.seriesIndices,
        edit.raceIndex,
        penaltyPosition,
      );
    }

    if (avg === edit.rawPosition) return;
    changedEdits.push([key, { ...edit, rawPosition: avg }]);
    next[entryIdx] = withRedressAverage(
      next[entryIdx],
      ctx,
      edit.raceIndex,
      avg,
      edit.status,
      penaltyPosition,
    );
  });
  return { rows: next, changedEdits };
}

// ─── One typed cell ───────────────────────────────────────────────────────────

/**
 * What a typed value (or a newly chosen status, `value === null`) means for
 * one cell: the finishing place it shows and the points it scores, before the
 * race column is re-ranked. Null when the input is unusable and nothing should
 * change. RDG2 is not resolved here: it goes through the race picker.
 */
export function resolveEditedCell(
  entry: LeaderboardEntry,
  raceIndex: number,
  value: string | number | null,
  status: string,
  penaltyPosition: number,
): { position: number; points: number } | null {
  const isPenalty = PENALTY_CODES.includes(status);
  const input =
    value == null
      ? parseRaceNum(entry.races[raceIndex])
      : parseFloat(String(value));

  if (!isPenalty && (Number.isNaN(input) || input < 0)) return null;
  if ((status === 'RDG3' || status === 'DPI') && value !== null) {
    if (Number.isNaN(input)) return null;
  }
  // Position-keeping penalties (ZFP/SCP/T1) take a typed finishing place, so
  // reject unusable input the same way a plain finish does.
  if (
    scoringPenaltyStatuses.has(status) &&
    value !== null &&
    (Number.isNaN(input) || input < 0)
  ) {
    return null;
  }
  const maxBoats = penaltyPosition - 1;

  if (status === 'RDG1') {
    const average = averageAllRacePoints(entry, raceIndex, penaltyPosition);
    return { position: average, points: average };
  }
  if (status === 'RDG3' || status === 'DPI') {
    // RRS A10: DPI (discretionary penalty imposed) points are set by the
    // protest committee. The typed value IS the race score (like RDG3), never
    // auto-derived from the heat size. A null value (status just selected)
    // seeds from the existing cell so the user can then type the PC's number.
    return { position: input, points: input };
  }
  if (isPenalty) {
    if (scoringPenaltyStatuses.has(status)) {
      // Position-keeping penalty: keeps its finishing place, scores RRS 44.3c/
      // T1 points.
      return {
        position: input,
        points: getScoringPenaltyPoints(input, maxBoats, status),
      };
    }
    // Hard penalty (DNS/DSQ/…): largest heat size + 1 per SHRS 5.2.
    return { position: penaltyPosition, points: penaltyPosition };
  }
  return { position: input, points: input };
}

/**
 * A finishing place cannot exceed the number of boats in the race (SHRS).
 * Plain finishes AND position-keeping penalties hold a real finishing place,
 * so both are clamped; hard-penalty/RDG cells keep their computed value.
 */
export function clampFinishingPlace(
  cell: { position: number; points: number },
  status: string,
  heatSize: number,
  maxBoats: number,
): { position: number; points: number } {
  const keepsFinishingPlace = scoringPenaltyStatuses.has(status);
  if (status !== 'FINISHED' && !keepsFinishingPlace) return cell;
  const position = Math.min(Math.max(Math.round(cell.position), 1), heatSize);
  return {
    position,
    points: keepsFinishingPlace
      ? getScoringPenaltyPoints(position, maxBoats, status)
      : position,
  };
}

// ─── One race column ──────────────────────────────────────────────────────────

/**
 * Indices (into `rows`) of the boats that share THIS physical race (same
 * race_id at this column). Those are the only boats whose finishing places
 * interact: a final fleet's boats share their final race; a qualifying heat's
 * boats share their heat race. Grouping by race_id is exact for both series
 * and stops an edit in one fleet/heat from cascading into another.
 */
export function findRaceGroup(
  rows: LeaderboardEntry[],
  boatId: number,
  raceIndex: number,
): number[] {
  const target = rows.find((e) => e.boat_id === boatId);
  const targetRaceId = target?.race_ids?.[raceIndex];
  const group: number[] = [];
  rows.forEach((entry, idx) => {
    const sameRace =
      targetRaceId != null &&
      entry.race_ids?.[raceIndex] != null &&
      String(entry.race_ids[raceIndex]) === String(targetRaceId);
    if (sameRace || (targetRaceId == null && entry.boat_id === boatId)) {
      group.push(idx);
    }
  });
  return group;
}

/**
 * Apply one edited cell to the rows: re-rank the race column and rescore every
 * boat in it. The RRS A6.1 promotion, the manual ripple and the RRS A7
 * re-average all live in shared/raceColumnEdit, which the main process runs
 * too — so this preview cannot show something other than what Save persists.
 * Boats in other races are never touched by an edit in this race.
 */
export function applyRaceEdit(
  rows: LeaderboardEntry[],
  group: number[],
  ctx: EditScoringContext,
  edit: {
    boatId: number;
    raceIndex: number;
    position: number;
    points: number;
    status: string;
    maxBoats: number;
  },
): LeaderboardEntry[] {
  const { boatId, raceIndex } = edit;
  const target = rows.find((e) => e.boat_id === boatId);
  if (!target) return rows;

  const column: RaceCellState[] = group.map((idx) => {
    const entry = rows[idx];
    const pos = parseRaceNum(entry.races[raceIndex]);
    const rawPts = parseFloat(
      stripExclusionParens(
        entry.race_points?.[raceIndex] ?? entry.races[raceIndex],
      ),
    );
    return {
      position: pos,
      points: Number.isNaN(rawPts) ? pos : rawPts,
      status: entry.race_statuses?.[raceIndex] || 'FINISHED',
    };
  });

  const ranked = applyRaceColumnEdit(column, {
    index: group.indexOf(rows.findIndex((entry) => entry.boat_id === boatId)),
    previousPosition: parseRaceNum(target.races[raceIndex]),
    previousStatus: target.race_statuses?.[raceIndex] || 'FINISHED',
    newPosition: edit.position,
    newPoints: edit.points,
    newStatus: edit.status,
    maxBoats: edit.maxBoats,
  });

  const rankedByIdx = new Map<number, RaceCellState>();
  group.forEach((idx, i) => rankedByIdx.set(idx, ranked[i]));

  return rows.map((entry, idx) => {
    const cell = rankedByIdx.get(idx);
    if (!cell) return entry;
    const positions = entry.races.map(stripExclusionParens);
    const points =
      entry.race_points && entry.race_points.length === entry.races.length
        ? entry.race_points.map(stripExclusionParens)
        : [...positions];
    const statuses = defaultStatuses(entry);
    positions[raceIndex] = String(cell.position);
    points[raceIndex] = String(cell.points);
    statuses[raceIndex] = cell.status;
    return rescoreEntry(entry, ctx, positions, points, statuses);
  });
}
