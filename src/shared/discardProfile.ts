/**
 * The SHRS 5.4 discard setting as the app stores it (a JSON string on the
 * Events row, edited on the event form): parsing, normalisation, and the
 * library's profile it stands for. How many scores are excluded, and which,
 * is regatta-core's (`discardCount`, `excludedScores`).
 *
 * SHRS 5.4: "The Race Committee may change this rule before the warning
 * signal for the first race in a series."
 */
import type { DiscardProfile } from 'regatta-core';

export type DiscardConfig = {
  firstDiscardAt: number;
  secondDiscardAt: number;
  additionalEvery: number;
  thresholds?: number[];
  /**
   * RULE-m6: an explicitly EMPTY threshold list is a valid RC change meaning
   * "never discard". It is carried as an explicit flag (and serialized
   * alongside `thresholds: []`) rather than being inferred from an empty
   * list. The arithmetic branch omits `thresholds` entirely, so an empty
   * list can only ever mean "never discard" — never an arithmetic profile.
   */
  neverDiscard?: boolean;
};

export const DEFAULT_DISCARD_CONFIG: DiscardConfig = {
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

  // RULE-m6: the explicit flag is the unambiguous "never discard" sentinel and
  // wins over any threshold list that may have been serialised alongside it.
  if (candidate.neverDiscard === true) {
    return { ...DEFAULT_DISCARD_CONFIG, thresholds: [], neverDiscard: true };
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'thresholds')) {
    const thresholds = normalizeThresholdList(candidate.thresholds);
    if (thresholds.length === 0) {
      // SHRS 5.4 RC change: no thresholds at all ⇒ no race is ever discarded.
      // This used to fall through to the standard 4/8/8 profile, so an event
      // configured for "never discard" quietly discarded anyway (RULE-m6).
      return { ...DEFAULT_DISCARD_CONFIG, thresholds: [], neverDiscard: true };
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
      : firstDiscardAt + additionalEvery;

  // NB: omit `thresholds` here. An arithmetic profile must round-trip back to
  // itself; emitting `thresholds: []` would make the next parse treat it as an
  // empty threshold list and return `neverDiscard` instead (round-trip bug).
  return {
    firstDiscardAt,
    secondDiscardAt: normalizedSecondDiscardAt,
    additionalEvery,
  };
}

export function normalizeDiscardConfigString(value: unknown): string {
  return JSON.stringify(normalizeDiscardConfig(value));
}

/**
 * A stored discard setting as regatta-core's SHRS 5.4 profile. How many
 * scores a profile excludes after how many races is the library's
 * (`discardCount`); this only reads the setting.
 */
export function toDiscardProfile(stored: unknown): DiscardProfile {
  const config = normalizeDiscardConfig(stored);
  if (config.neverDiscard) return { kind: 'none' };
  if (config.thresholds && config.thresholds.length > 0) {
    return { kind: 'thresholds', at: [...config.thresholds] };
  }
  const { firstDiscardAt, secondDiscardAt, additionalEvery } = config;
  if (
    firstDiscardAt === DEFAULT_DISCARD_CONFIG.firstDiscardAt &&
    secondDiscardAt === DEFAULT_DISCARD_CONFIG.secondDiscardAt &&
    additionalEvery === DEFAULT_DISCARD_CONFIG.additionalEvery
  ) {
    return { kind: 'standard' };
  }
  return {
    kind: 'custom',
    first: firstDiscardAt,
    second: secondDiscardAt,
    every: additionalEvery,
  };
}
