import {
  REDRESS_CODES,
  RESULT_CODES as CORE_RESULT_CODES,
  fleetIndex,
  sumPoints,
} from 'regatta-core';
import IOC_NATIONS from '../constants/iocNations';
import type { LeaderboardEntry, RawLeaderboardEntry } from '../types';

/**
 * Every code a result can show, in regatta-core's order: ZFP / SCP / T1,
 * the no-place codes in SHRS 5.3 order, DPI and redress. The screens and
 * exports list codes from here; what each one scores is the library's.
 */
export const RESULT_CODES: readonly string[] = CORE_RESULT_CODES;

/** Redress (RRS A9): a score the protest committee gave. */
export const RDG_TYPES: readonly string[] = REDRESS_CODES;

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

/** Mark the scores the library excluded and total the rest. */
const markExcluded = (
  rawPositions: string[],
  scoreValues: string[],
  excludedFlags: string[],
): { markedRaces: string[]; total: number } => {
  const excluded = (i: number) => excludedFlags[i] === '1';
  return {
    markedRaces: rawPositions.map((race, i) =>
      excluded(i)
        ? `(${stripExclusionParens(race)})`
        : stripExclusionParens(race),
    ),
    total: sumPoints(
      scoreValues
        .filter((_value, i) => !excluded(i))
        .map((value) => parseFloat(stripExclusionParens(value)) || 0),
    ),
  };
};

/**
 * A row from the main process as the screen shows it: the race columns
 * split, the scores regatta-core excluded in brackets, and its net total.
 * Every read carries the excluded scores (`race_excluded`); a row without
 * them has none marked (nothing here works discards out).
 */
export const processLeaderboardEntry = (
  entry: RawLeaderboardEntry,
): LeaderboardEntry => {
  const races = entry.race_positions ? entry.race_positions.split(',') : [];
  const race_points = entry.race_points ? entry.race_points.split(',') : races;
  const race_ids = entry.race_ids ? entry.race_ids.split(',') : [];
  const race_statuses = entry.race_statuses
    ? entry.race_statuses.split(',')
    : races.map(() => 'FINISHED');
  // RRS A6.2 kept places, split like the other columns (absent: none).
  const { race_held_places: heldCsv, ...columns } = entry;
  const heldPlaces =
    typeof heldCsv === 'string' ? { race_held_places: heldCsv.split(',') } : {};
  const excludedCsv =
    typeof entry.race_excluded === 'string' ? entry.race_excluded : '';
  const { markedRaces, total } = markExcluded(
    races,
    race_points,
    excludedCsv.split(','),
  );
  const { race_excluded: _excluded, ...shown } = columns;
  return {
    ...shown,
    races: markedRaces,
    race_points,
    race_ids,
    race_statuses,
    ...heldPlaces,
    // The library's total; a row without one (none from the main process)
    // totals the scores it shows.
    computed_total:
      entry.total_points_final ??
      entry.total_points_event ??
      (races.length > 0 ? total : null),
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
  const isPenalty = RESULT_CODES.includes(raceStatus);
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

/**
 * The points a penalty cell scored ("5.2" for a ZFP, "11" for a DSQ), so the
 * table can show them next to the code and a judge need not open the
 * explanation to check the number. Only for a plain penalty code: a redress
 * (RDG) or DPI cell already shows its points, and a finish shows its place.
 * Nothing is shown (null) when the stored points are missing, are not a
 * number, or do not line up with the race columns: a number is never guessed.
 */
export const getPenaltyPointsText = (
  entry: Pick<LeaderboardEntry, 'race_points' | 'race_statuses'> | undefined,
  raceIndex: number,
  raceStatus: string,
): string | null => {
  if (!RESULT_CODES.includes(raceStatus)) return null;
  if (RDG_TYPES.includes(raceStatus) || raceStatus === 'DPI') return null;
  const points = entry?.race_points;
  if (!points || points.length !== entry?.race_statuses?.length) return null;
  const raw = stripExclusionParens(points[raceIndex] ?? '').trim();
  if (raw === '' || !Number.isFinite(Number(raw))) return null;
  // 5.0 -> "5", 5.20 -> "5.2"
  return String(Number(raw));
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
 * order. Uses regatta-core's `fleetIndex` so the 5th and later fleets
 * ("Fleet 5", …) get real, distinct precedence (RULE-m2).
 */
const GENERAL_GROUP_RANK = Number.MAX_SAFE_INTEGER - 1;

const fleetGroupRank = (group: string): number => {
  if (group === 'General') return GENERAL_GROUP_RANK;
  const index = fleetIndex(group);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export const compareFleetGroups = (a: string, b: string): number =>
  fleetGroupRank(a) - fleetGroupRank(b);
