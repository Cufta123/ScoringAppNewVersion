/* eslint-disable camelcase */
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';
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
const NON_EXCLUDABLE_STATUSES = new Set(['DNE', 'DGM']);

export type { RawLeaderboardEntry };

const parseDiscardThresholdsFromProfile = (
  discardProfile?: string | null,
): number[] | null => {
  if (!discardProfile || discardProfile === 'standard') return null;
  try {
    const parsed: unknown = JSON.parse(discardProfile);
    const rawThresholds =
      parsed && typeof parsed === 'object'
        ? (parsed as { thresholds?: unknown }).thresholds
        : undefined;
    if (!Array.isArray(rawThresholds)) return null;
    const thresholds = rawThresholds
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry > 0);

    if (thresholds.length !== rawThresholds.length) return null;
    for (let index = 1; index < thresholds.length; index += 1) {
      if (thresholds[index] <= thresholds[index - 1]) return null;
    }
    return thresholds;
  } catch (_error) {
    return null;
  }
};

/**
 * Strip exclusion parentheses and return 0 for any non-numeric value.
 * Uses parseFloat so RDG average scores (e.g. 3.4) are preserved.
 */
export const parseRaceNum = (val: unknown): number => {
  const n = parseFloat(String(val).replace(/[()]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

/**
 * SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more.
 */
export const getExcludeCount = (
  numberOfRaces: number,
  discardProfile: string | null = 'standard',
): number => {
  const thresholds = parseDiscardThresholdsFromProfile(discardProfile);
  if (thresholds && thresholds.length > 0) {
    return thresholds.filter((threshold) => numberOfRaces >= threshold).length;
  }

  if (numberOfRaces < 4) return 0;
  if (numberOfRaces < 8) return 1;
  return 2 + Math.floor((numberOfRaces - 8) / 8);
};

/**
 * Apply score exclusions per SHRS 5.4: mark worst scores with parentheses,
 * return marked races array and the net total (sum of non-excluded scores).
 */
export const applyExclusions = (
  rawPositions: Array<string | number>,
  raceStatuses: string[] = [],
  scoreValues: Array<string | number> = rawPositions,
  discardProfile: string | null = 'standard',
  // MEGA M-NEW-1 / SHRS 5.4: the discard count keys off races completed IN THE
  // SERIES, not the boat's own race count. Callers that know the series-wide
  // count pass it here so the renderer agrees with the backend
  // (calculateBoatScores). Omitting it falls back to per-boat (legacy behavior,
  // used by unit tests and any single-entry caller).
  seriesRaceCount: number | undefined = undefined,
): { markedRaces: string[]; total: number } => {
  const n = rawPositions.length;
  const raceCountForDiscards = seriesRaceCount ?? n;
  const seriesExcludeCount = getExcludeCount(
    raceCountForDiscards,
    discardProfile,
  );
  // LB-11: never discard ALL of a boat's scores (a boat with fewer races than
  // the series-wide discard count must keep at least one), mirroring the backend
  // cap in calculateBoatScores.ts.
  const excludeCount = Math.min(seriesExcludeCount, Math.max(0, n - 1));
  const points = scoreValues.map((r) => {
    const v = parseFloat(String(r).replace(/[()]/g, ''));
    return Number.isNaN(v) ? 0 : v;
  });
  if (excludeCount === 0) {
    return {
      markedRaces: rawPositions.map((r) => String(r).replace(/[()]/g, '')),
      total: points.reduce((a, b) => a + b, 0),
    };
  }
  const candidates = points
    .map((point, index) => ({ point, index }))
    .filter(
      ({ index }) =>
        !NON_EXCLUDABLE_STATUSES.has(
          String(raceStatuses[index] || 'FINISHED').toUpperCase(),
        ),
    )
    .sort((a, b) => b.point - a.point || a.index - b.index);
  const excludedIndices = new Set(
    candidates.slice(0, excludeCount).map(({ index }) => index),
  );

  let total = 0;
  const markedRaces = rawPositions.map((race, i) => {
    if (excludedIndices.has(i)) {
      return `(${String(race).replace(/[()]/g, '')})`;
    }
    const p = points[i];
    total += p;
    return String(race).replace(/[()]/g, '');
  });
  return { markedRaces, total };
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
export const getFlagCode = (iocCode: string): string =>
  iocToFlagCodeMap[iocCode] || iocCode;

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
    const clean = race.replace(/[()]/g, '');
    displayText = `(RDG (${clean}))`;
    displayColor = 'var(--text-muted, #5A7389)';
  } else if (isRdgCell) {
    displayText = `RDG (${race})`;
    displayColor = 'var(--teal-hover, #0B7A63)';
  } else if (isDpiCell && isExcluded) {
    const clean = race.replace(/[()]/g, '');
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

export const GROUP_ORDER = ['Gold', 'Silver', 'Bronze', 'Copper', 'General'];
