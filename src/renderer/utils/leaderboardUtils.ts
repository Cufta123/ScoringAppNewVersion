import IOC_NATIONS from '../constants/iocNations';
import { fleetRank } from '../../shared/fleetNames';
import { getExcludeCountForProfile } from '../../shared/discardProfile';
import { sumPoints } from '../../shared/points';
import { averageRedressPoints } from '../../shared/redress';
import {
  capExcludeCountForBoat,
  getExcludedIndexes,
} from '../../shared/scoring/discards';
import type { LeaderboardEntry, RawLeaderboardEntry } from '../types';

export const PENALTY_CODES = [
  'DNF',
  'DNS',
  'DSQ',
  'OCS',
  'ZFP',
  'T1',
  'RET',
  'RAF',
  'SCP',
  'BFD',
  'UFD',
  'DNC',
  'NSC',
  'WTH',
  'DNE',
  'DGM',
  'DPI',
  // RDG variants — all carry a numeric score (not penaltyPosition)
  'RDG1', // Redress: average of ALL series races
  'RDG2', // Redress: average of SELECTED races
  'RDG3', // Redress: manual numeric entry
];

export const RDG_TYPES = ['RDG1', 'RDG2', 'RDG3'];

export type { RawLeaderboardEntry };

/**
 * Deep copy of leaderboard rows, so an edit draft never aliases the saved rows.
 * The rows are plain JSON data. (A JSON round trip rather than structuredClone,
 * which the jsdom test environment does not provide; it returns `any`, so this
 * keeps callers strongly typed.)
 */
export const cloneEntries = (rows: LeaderboardEntry[]): LeaderboardEntry[] =>
  JSON.parse(JSON.stringify(rows));

/**
 * A race cell without the parentheses that mark a discarded score: "(7)" -> "7".
 */
export const stripExclusionParens = (value: unknown): string =>
  String(value).replace(/[()]/g, '');

/**
 * Strip exclusion parentheses and return 0 for any non-numeric value.
 * Uses parseFloat so RDG average scores (e.g. 3.4) are preserved.
 */
export const parseRaceNum = (val: unknown): number => {
  const n = parseFloat(stripExclusionParens(val));
  return Number.isNaN(n) ? 0 : n;
};

/**
 * A boat's points race by race as numbers, discards included (the Gross
 * column): her scored points, or the race cells when no points are stored.
 */
export const grossPointValues = (
  entry: Pick<LeaderboardEntry, 'race_points' | 'races'> | null | undefined,
): number[] => (entry?.race_points || entry?.races || []).map(parseRaceNum);

/**
 * RRS A9 average of a boat's points over a chosen set of race indices, excluding
 * one race (the redressed cell), for the edit preview. The rule itself — which
 * races count, rounding to the tenth — lives in shared/redress.ts, which the
 * main-process recompute also uses, so the preview equals what Save persists.
 *
 * `selectedIndices` of `null` averages every index; a non-null set averages only
 * the given indices. Non-numeric values are skipped, as are other races scored
 * by average redress (`statuses`). An empty average falls back to `penaltyPos`
 * for the preview; the backend keeps the stored value until there is something
 * to average.
 */
export const averageRacePoints = (
  raceValues: string[],
  selectedIndices: Set<number> | null,
  excludeIdx: number,
  penaltyPos: number,
  statuses: string[] = [],
): number => {
  const cells = raceValues
    .map((value, idx) => ({
      points: parseFloat(stripExclusionParens(value)),
      status: statuses[idx] || 'FINISHED',
      idx,
    }))
    .filter(({ idx, points }) => {
      if (idx === excludeIdx) return false;
      if (selectedIndices !== null && !selectedIndices.has(idx)) return false;
      return !Number.isNaN(points);
    });
  return averageRedressPoints(cells) ?? penaltyPos;
};

/**
 * SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more —
 * unless the Race Committee changed the rule for this event.
 *
 * Delegates to the shared implementation the main process also uses, so a
 * custom profile (thresholds, altered first/second/every, or "never discard")
 * produces the same count in the edit-mode preview as in the stored scores.
 * The renderer used to reimplement this and honoured only `thresholds`,
 * silently applying the standard 4/8/8 to every other custom profile.
 */
export const getExcludeCount = (
  numberOfRaces: number,
  discardProfile: string | null = 'standard',
): number => getExcludeCountForProfile(numberOfRaces, discardProfile);

/**
 * Apply score exclusions per SHRS 5.4: mark worst scores with parentheses,
 * return marked races array and the net total (sum of non-excluded scores).
 *
 * The choice of races is the scoring core's (src/shared/scoring/discards.ts),
 * the same code the stored leaderboard uses. Races arrive in race order, so
 * equal worst scores fall on the earliest race in both places.
 */
export const applyExclusions = (
  rawPositions: Array<string | number>,
  raceStatuses: string[] = [],
  scoreValues: Array<string | number> = rawPositions,
  discardProfile: string | null = 'standard',
  // SHRS 5.4: the discard count keys off races completed IN THE SERIES, not
  // the boat's own race count. Callers that know the series-wide count pass
  // it here; omitting it falls back to the boat's own count (single-entry
  // callers and unit tests).
  seriesRaceCount: number | undefined = undefined,
): { markedRaces: string[]; total: number } => {
  const points = scoreValues.map((value) => {
    const v = parseFloat(stripExclusionParens(value));
    return Number.isNaN(v) ? 0 : v;
  });
  // Never discard all of a boat's scores (same cap as the stored scores).
  const excludeCount = capExcludeCountForBoat(
    getExcludeCount(seriesRaceCount ?? rawPositions.length, discardProfile),
    rawPositions.length,
  );
  const excluded = getExcludedIndexes(
    rawPositions.map((_race, index) => ({
      points: points[index],
      status: raceStatuses[index] || 'FINISHED',
      race_number: index,
    })),
    excludeCount,
  );

  return {
    markedRaces: rawPositions.map((race, i) =>
      excluded.has(i)
        ? `(${stripExclusionParens(race)})`
        : stripExclusionParens(race),
    ),
    total: sumPoints(points.filter((_point, i) => !excluded.has(i))),
  };
};

/**
 * Process a raw leaderboard DB entry into display-ready format.
 */
export const processLeaderboardEntry = (
  entry: RawLeaderboardEntry,
  discardProfile: string | null = 'standard',
  // SHRS 5.4 series-wide completed-race count (see applyExclusions). Callers
  // that process a whole leaderboard compute this once as the max race count
  // across all entries and pass it in.
  seriesRaceCount: number | undefined = undefined,
): LeaderboardEntry => {
  const races = entry.race_positions ? entry.race_positions.split(',') : [];
  const race_points = entry.race_points ? entry.race_points.split(',') : races;
  const race_ids = entry.race_ids ? entry.race_ids.split(',') : [];
  const race_statuses = entry.race_statuses
    ? entry.race_statuses.split(',')
    : races.map(() => 'FINISHED');
  const { markedRaces, total } = applyExclusions(
    races,
    race_statuses,
    race_points,
    discardProfile,
    seriesRaceCount,
  );
  return {
    ...entry,
    races: markedRaces,
    race_points,
    race_ids,
    race_statuses,
    // LB-9: use the locally computed net total, which is consistent with the
    // parenthesised markings and the CURRENT discard profile. The DB-stored
    // total can be stale if the profile changed without a recompute. Fall back
    // to the stored value only when there are no races to compute from.
    computed_total:
      races.length > 0
        ? total
        : (entry.total_points_final ?? entry.total_points_event ?? null),
  };
};

/**
 * Map an IOC country code to a react-world-flags code.
 */
/**
 * Whether the boat-type column says anything: only when the entries sail more
 * than one model. In a one-design event (every boat an IOM) it is a column of
 * identical words that takes space from the race columns.
 */
export const hasMixedBoatTypes = (
  entries: ReadonlyArray<{ boat_type?: string | null }>,
): boolean =>
  new Set(
    entries
      .map((entry) =>
        String(entry.boat_type ?? '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  ).size > 1;

export const getFlagCode = (iocCode: string): string =>
  IOC_NATIONS[iocCode]?.flag || iocCode;

/**
 * LB-6 (security): escape one CSV cell. Neutralises CSV formula injection — a
 * value whose first character is `=`, `+`, `-` or `@` is interpreted as a
 * formula by Excel/Sheets and can execute (e.g. `=HYPERLINK(...)`) — by
 * prefixing a single quote, which forces it to be read as literal text. Also
 * quotes cells containing a comma, double quote, or newline (LF/CR) so embedded
 * delimiters/newlines can't break the row/column grid.
 */
export const escapeCsvCell = (value: unknown): string => {
  let s = String(value ?? '');
  // OWASP CSV-injection trigger set: = + - @ plus the tab and carriage-return
  // control characters (a leading \t or \r before a formula is also a trigger).
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
};

interface RaceCellDisplay {
  displayText: string;
  displayColor: string;
  isPenalty: boolean;
  isRdgCell: boolean;
  isExcluded: boolean;
}

/**
 * Determine display text and colour for a race cell value.
 */
export const getRaceCellDisplay = (
  race: string,
  raceStatus: string,
): RaceCellDisplay => {
  const isPenalty = PENALTY_CODES.includes(raceStatus);
  const isRdgCell = RDG_TYPES.includes(raceStatus);
  // DPI carries a PC-set numeric score (RRS A10), so it is displayed with its
  // number (like RDG), not as a bare place-less penalty code.
  const isDpiCell = raceStatus === 'DPI';
  const isExcluded = typeof race === 'string' && race.startsWith('(');

  let displayText: string;
  let displayColor: string;

  // Excluded/discarded cells are de-emphasized but must stay readable: the
  // muted token (#5A7389) clears WCAG AA (4.94:1) where the old #888/#999
  // (3.5:1 / 2.85:1) failed. Active RDG text uses the darker teal (--teal-hover,
  // 5.28:1) instead of --teal (#0F9478, 3.8:1) so it passes too.
  if (isRdgCell && isExcluded) {
    const clean = stripExclusionParens(race);
    displayText = `(RDG (${clean}))`;
    displayColor = 'var(--text-muted, #5A7389)';
  } else if (isRdgCell) {
    displayText = `RDG (${race})`;
    displayColor = 'var(--teal-hover, #0B7A63)';
  } else if (isDpiCell && isExcluded) {
    const clean = stripExclusionParens(race);
    displayText = `(DPI (${clean}))`;
    displayColor = 'var(--text-muted, #5A7389)';
  } else if (isDpiCell) {
    displayText = `DPI (${race})`;
    displayColor = 'var(--danger, #e63946)';
  } else if (isPenalty && isExcluded) {
    displayText = `(${raceStatus})`;
    displayColor = 'var(--text-muted, #5A7389)';
  } else if (isPenalty) {
    displayText = raceStatus;
    displayColor = 'var(--danger, #e63946)';
  } else if (isExcluded) {
    displayText = race;
    displayColor = 'var(--text-muted, #5A7389)';
  } else {
    displayText = race;
    displayColor = 'inherit';
  }

  return { displayText, displayColor, isPenalty, isRdgCell, isExcluded };
};

// `border` keeps the lighter, recognisable fleet colour for the table outline;
// `thead` is darkened so the WHITE header text clears WCAG AA (4.5:1). The
// original shared colours (e.g. white on Gold #c8960a ≈2.6:1) failed AA.
export const FLEET_COLORS: Record<string, { border: string; thead: string }> = {
  Gold: { border: '#c8960a', thead: '#8a6800' },
  Silver: { border: '#7a8a94', thead: '#5c6870' },
  Bronze: { border: '#9a6020', thead: '#86521a' },
  Copper: { border: '#8a5020', thead: '#7a461a' },
  General: { border: '#6b7c93', thead: '#566575' },
};

/**
 * SHRS 5.5 fleet precedence for display grouping: Gold, Silver, Bronze, Copper
 * "and so on", then the single-fleet "General" bucket, then anything we cannot
 * order. Uses the shared `fleetRank` so the 5th and later fleets ("Fleet 5", …)
 * get real, distinct precedence instead of all colliding on one rank (RULE-m2).
 */
const GENERAL_GROUP_RANK = Number.MAX_SAFE_INTEGER - 1;

const fleetGroupRank = (group: string): number =>
  group === 'General' ? GENERAL_GROUP_RANK : fleetRank(group);

export const compareFleetGroups = (a: string, b: string): number =>
  fleetGroupRank(a) - fleetGroupRank(b);
