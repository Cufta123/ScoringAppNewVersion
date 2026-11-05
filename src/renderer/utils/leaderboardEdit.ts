/**
 * The edit-mode draft of the leaderboard, as plain functions: what a typed
 * result does to the race on screen. The hook (useLeaderboardEdit) only holds
 * the state and calls these.
 *
 * No scoring rule is written here. The edited race's column is re-ranked by
 * regatta-core's `applyRaceColumnEdit` (the main process checks and scores
 * the same column again on Save). Totals, discards and redress averages are
 * not worked out here at all: after every edit the hook asks the main process
 * for the library's standings with the edit (`previewLeaderboardEdit`), and
 * those rows replace the draft. Until they arrive the other columns and the
 * totals show what they showed before the edit.
 */
import {
  applyRaceColumnEdit,
  holdsPlace,
  keepsProvidedPoints,
  type RaceCell,
} from 'regatta-core';
import { parseRaceNum, stripExclusionParens } from './leaderboardUtils';
import type { LeaderboardEntry } from '../types';

/**
 * A result the user changed this session, kept so Save knows which races to
 * write, which cells were typed, and which races an RDG2 averages.
 */
export interface UserRaceEdit {
  boatId: number;
  raceIndex: number;
  /** The place, or the points, the cell was given. */
  rawPosition: number;
  status: string;
  // SHRS 5.6: indices into the edited cell's OWN series race list.
  rdgSelection?: { seriesIndices: number[] };
}

/**
 * The largest heat of the edited series (SHRS 5.2), as the main process
 * reported it; the boats on the leaderboard while it is not loaded yet.
 */
export const largestHeatFor = (maxHeatSize: number, entryCount: number) =>
  maxHeatSize || entryCount;

/** The points a boat holds in one race, as the leaderboard shows them. */
export function currentPoints(
  entry: LeaderboardEntry,
  raceIndex: number,
): number {
  const points = parseFloat(
    stripExclusionParens(entry.race_points?.[raceIndex] ?? ''),
  );
  return Number.isNaN(points) ? parseRaceNum(entry.races[raceIndex]) : points;
}

// ─── One typed cell ───────────────────────────────────────────────────────────

/**
 * What a typed value (or a newly chosen status, `value === null`) means for
 * one cell before the race is re-ranked: the place typed for a finish or
 * ZFP / SCP / T1, the points typed for RDG3 / DPI. Null when the input is
 * unusable and nothing should change.
 *
 * RDG1 and RDG2 are averages of her races (RRS A9), worked out by the
 * library: the cell keeps her current points there (a value Save accepts)
 * until the library's preview shows the average. A code with no place takes
 * the DNF score in the re-rank, whatever is passed here.
 */
export function resolveEditedCell(
  entry: LeaderboardEntry,
  raceIndex: number,
  value: string | number | null,
  status: string,
): { position: number; points: number } | null {
  const input =
    value == null
      ? parseRaceNum(entry.races[raceIndex])
      : parseFloat(String(value));

  if (holdsPlace(status)) {
    if (Number.isNaN(input) || input < 0) return null;
    return { position: input, points: input };
  }
  if (status === 'RDG3' || status === 'DPI') {
    // RRS A9(c) / A10: the protest committee's points, as typed. A status
    // just chosen (null) starts from the cell's value.
    if (value !== null && Number.isNaN(input)) return null;
    return { position: input, points: input };
  }
  const held = currentPoints(entry, raceIndex);
  return { position: held, points: held };
}

/**
 * Input check: a finishing place is a whole number from 1 to the boats in
 * the race. Other cells are left as they are.
 */
export function clampFinishingPlace(
  cell: { position: number; points: number },
  status: string,
  heatSize: number,
): { position: number; points: number } {
  if (!holdsPlace(status)) return cell;
  const position = Math.min(Math.max(Math.round(cell.position), 1), heatSize);
  return { position, points: position };
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

/** A shown cell with the brackets of an excluded score kept as they were. */
const keepMark = (shown: string, value: number) =>
  String(shown).startsWith('(') ? `(${value})` : String(value);

/**
 * Apply one edited cell to the rows: the race column re-ranked by
 * regatta-core (`applyRaceColumnEdit`: RRS A6.1 promotion, the move of a new
 * place, A6.2 kept places, A7 shared points, 44.3(c), SHRS 5.2). Only that
 * column changes; boats in other races are never touched, and totals stay
 * until the library's preview replaces the rows.
 */
export function applyRaceEdit(
  rows: LeaderboardEntry[],
  group: number[],
  edit: {
    boatId: number;
    raceIndex: number;
    position: number;
    points: number;
    status: string;
    /** Boats in the largest heat of the series (SHRS 5.2). */
    maxBoats: number;
  },
): LeaderboardEntry[] {
  const { boatId, raceIndex } = edit;
  const target = rows.find((e) => e.boat_id === boatId);
  if (!target) return rows;

  const column: RaceCell[] = group.map((idx) => {
    const entry = rows[idx];
    const position = parseRaceNum(entry.races[raceIndex]);
    const held = Number(entry.race_held_places?.[raceIndex] || NaN);
    return {
      position,
      points: currentPoints(entry, raceIndex),
      status: entry.race_statuses?.[raceIndex] || 'FINISHED',
      // RRS A6.2: the finishing place a redressed / DPI boat kept.
      ...(Number.isFinite(held) ? { heldPlace: held } : {}),
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

  const rankedByIdx = new Map<number, RaceCell>();
  group.forEach((idx, i) => rankedByIdx.set(idx, ranked[i]));

  return rows.map((entry, idx) => {
    const cell = rankedByIdx.get(idx);
    if (!cell) return entry;
    const races = [...entry.races];
    races[raceIndex] = keepMark(entry.races[raceIndex], cell.position);
    const points =
      entry.race_points && entry.race_points.length === entry.races.length
        ? entry.race_points.map(stripExclusionParens)
        : entry.races.map(stripExclusionParens);
    points[raceIndex] = String(cell.points);
    const statuses = entry.race_statuses
      ? [...entry.race_statuses]
      : entry.races.map(() => 'FINISHED');
    statuses[raceIndex] = cell.status;
    const held = entry.race_held_places
      ? [...entry.race_held_places]
      : entry.races.map(() => '');
    held[raceIndex] =
      keepsProvidedPoints(cell.status) && cell.heldPlace != null
        ? String(cell.heldPlace)
        : '';
    return {
      ...entry,
      races,
      race_points: points,
      race_statuses: statuses,
      race_held_places: held,
    };
  });
}
