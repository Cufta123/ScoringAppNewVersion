/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';

export type DiscardConfig = {
  firstDiscardAt: number;
  secondDiscardAt: number;
  additionalEvery: number;
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

  const candidate = raw as Partial<DiscardConfig>;
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
  };
}

export function normalizeDiscardConfigString(value: unknown): string {
  return JSON.stringify(normalizeDiscardConfig(value));
}

export function getExcludeCountForConfig(
  numberOfRaces: number,
  config: DiscardConfig,
): number {
  if (numberOfRaces < config.firstDiscardAt) return 0;
  if (numberOfRaces < config.secondDiscardAt) return 1;
  return (
    2 + Math.floor((numberOfRaces - config.secondDiscardAt) / config.additionalEvery)
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
    .prepare(`SELECT ${column} as discard_profile FROM Events WHERE event_id = ?`)
    .get(event_id) as { discard_profile?: string } | undefined;

  return normalizeDiscardConfig(row?.discard_profile ?? 'standard');
}
