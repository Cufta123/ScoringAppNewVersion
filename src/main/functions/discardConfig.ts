/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';

export type DiscardConfig = {
  firstDiscardAt: number;
  secondDiscardAt: number;
  additionalEvery: number;
  thresholds?: number[];
};

const DEFAULT_DISCARD_CONFIG: DiscardConfig = {
  firstDiscardAt: 4,
  secondDiscardAt: 8,
  additionalEvery: 8,
};

function sanitizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const integer = Math.trunc(parsed);
  if (integer <= 0) {
    return fallback;
  }
  return integer;
}

function normalizeThresholdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error(
      'Discard thresholds must be an array of positive integers.',
    );
  }

  const normalized = value.map((entry) => {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        'Discard thresholds must contain only positive integers.',
      );
    }
    return parsed;
  });

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index] <= normalized[index - 1]) {
      throw new Error(
        'Discard thresholds must be in strictly increasing order.',
      );
    }
  }

  return normalized;
}

export function normalizeDiscardConfig(value: unknown): DiscardConfig {
  if (value == null || value === '' || value === 'standard') {
    return { ...DEFAULT_DISCARD_CONFIG };
  }

  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch (_error) {
      return { ...DEFAULT_DISCARD_CONFIG };
    }
  }

  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DISCARD_CONFIG };
  }

  const candidate = raw as Partial<DiscardConfig> & { thresholds?: unknown };
  if (Object.prototype.hasOwnProperty.call(candidate, 'thresholds')) {
    const thresholds = normalizeThresholdList(candidate.thresholds);
    if (thresholds.length === 0) {
      return { ...DEFAULT_DISCARD_CONFIG, thresholds: [] };
    }

    return {
      firstDiscardAt: thresholds[0],
      secondDiscardAt:
        thresholds[1] ?? thresholds[0] + DEFAULT_DISCARD_CONFIG.additionalEvery,
      additionalEvery: DEFAULT_DISCARD_CONFIG.additionalEvery,
      thresholds,
    };
  }

  const firstDiscardAt = sanitizePositiveInteger(
    candidate.firstDiscardAt,
    DEFAULT_DISCARD_CONFIG.firstDiscardAt,
  );
  const secondDiscardAt = sanitizePositiveInteger(
    candidate.secondDiscardAt,
    DEFAULT_DISCARD_CONFIG.secondDiscardAt,
  );
  const additionalEvery = sanitizePositiveInteger(
    candidate.additionalEvery,
    DEFAULT_DISCARD_CONFIG.additionalEvery,
  );

  const normalizedSecondDiscardAt =
    secondDiscardAt > firstDiscardAt
      ? secondDiscardAt
      : firstDiscardAt + DEFAULT_DISCARD_CONFIG.additionalEvery;

  return {
    firstDiscardAt,
    secondDiscardAt: normalizedSecondDiscardAt,
    additionalEvery,
    thresholds: [],
  };
}

export function normalizeDiscardConfigString(value: unknown): string {
  return JSON.stringify(normalizeDiscardConfig(value));
}

export function getExcludeCountForConfig(
  numberOfRaces: number,
  config: DiscardConfig,
): number {
  if (Array.isArray(config.thresholds) && config.thresholds.length > 0) {
    return config.thresholds.reduce(
      (count, threshold) => (numberOfRaces >= threshold ? count + 1 : count),
      0,
    );
  }

  if (numberOfRaces < config.firstDiscardAt) return 0;
  if (numberOfRaces < config.secondDiscardAt) return 1;
  return (
    2 +
    Math.floor(
      (numberOfRaces - config.secondDiscardAt) / config.additionalEvery,
    )
  );
}

export function getEventDiscardConfig(
  event_id: any,
  series: 'qualifying' | 'final',
): DiscardConfig {
  const column =
    series === 'qualifying'
      ? 'shrs_discard_profile_qualifying'
      : 'shrs_discard_profile_final';

  const row = db
    .prepare(
      `SELECT ${column} as discard_profile FROM Events WHERE event_id = ?`,
    )
    .get(event_id) as { discard_profile?: string } | undefined;

  return normalizeDiscardConfig(row?.discard_profile ?? 'standard');
}
