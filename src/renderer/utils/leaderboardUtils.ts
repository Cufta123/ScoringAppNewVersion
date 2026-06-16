/* eslint-disable camelcase */
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';

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

/** A raw leaderboard row as returned by the DB (comma-joined string columns). */
export interface RawLeaderboardEntry {
  race_positions?: string | null;
  race_points?: string | null;
  race_ids?: string | null;
  race_statuses?: string | null;
  total_points_final?: number | null;
  total_points_event?: number | null;
  [key: string]: unknown;
}

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
): { markedRaces: string[]; total: number } => {
  const n = rawPositions.length;
  const excludeCount = getExcludeCount(n, discardProfile);
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
) => {
  const races = entry.race_positions ? entry.race_positions.split(',') : [];
  const race_points = entry.race_points ? entry.race_points.split(',') : races;
  const race_ids = entry.race_ids ? entry.race_ids.split(',') : [];
  const race_statuses = entry.race_statuses
    ? entry.race_statuses.split(',')
    : races.map(() => 'FINISHED');
  const { markedRaces } = applyExclusions(
    races,
    race_statuses,
    race_points,
    discardProfile,
  );
  return {
    ...entry,
    races: markedRaces,
    race_points,
    race_ids,
    race_statuses,
    computed_total: entry.total_points_final ?? entry.total_points_event,
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
  const isExcluded = typeof race === 'string' && race.startsWith('(');

  let displayText: string;
  let displayColor: string;

  if (isRdgCell && isExcluded) {
    const clean = race.replace(/[()]/g, '');
    displayText = `(RDG (${clean}))`;
    displayColor = '#888';
  } else if (isRdgCell) {
    displayText = `RDG (${race})`;
    displayColor = 'var(--teal, #2a9d8f)';
  } else if (isPenalty && isExcluded) {
    displayText = `(${raceStatus})`;
    displayColor = '#999';
  } else if (isPenalty) {
    displayText = raceStatus;
    displayColor = 'var(--danger, #e63946)';
  } else if (isExcluded) {
    displayText = race;
    displayColor = '#999';
  } else {
    displayText = race;
    displayColor = 'inherit';
  }

  return { displayText, displayColor, isPenalty, isRdgCell, isExcluded };
};

export const FLEET_COLORS: Record<string, { border: string; thead: string }> = {
  Gold: { border: '#c8960a', thead: '#c8960a' },
  Silver: { border: '#7a8a94', thead: '#7a8a94' },
  Bronze: { border: '#9a6020', thead: '#9a6020' },
  Copper: { border: '#8a5020', thead: '#8a5020' },
  General: { border: '#6b7c93', thead: '#6b7c93' },
};

export const GROUP_ORDER = ['Gold', 'Silver', 'Bronze', 'Copper', 'General'];
