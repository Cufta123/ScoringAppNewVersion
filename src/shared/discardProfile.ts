/**
 * SHRS 5.4 discard profile: parsing, normalisation and the exclusion count.
 *
 * Pure — no database access — so the renderer's edit-mode preview and the main
 * process's scoring compute the discard count from ONE implementation. The
 * renderer previously reimplemented this and honoured only the `thresholds`
 * list, silently falling back to the standard 4/8/8 for any custom
 * first/second/every profile the Race Committee had configured.
 *
 * SHRS 5.4:
 *   - after 4 races completed in the series, exclude the worst score;
 *   - after 8, exclude the two worst;
 *   - one more exclusion per 8 additional races;
 *   - "The Race Committee may change this rule before the warning signal for
 *     the first race in a series."
 */

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

export function getExcludeCountForConfig(
  numberOfRaces: number,
  config: DiscardConfig,
): number {
  // SHRS 5.4 as changed by the Race Committee: never discard (RULE-m6).
  if (config.neverDiscard) {
    return 0;
  }

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

/**
 * Exclusion count straight from a stored discard-profile string (the shape the
 * renderer holds). Equivalent to normalising then counting.
 */
export function getExcludeCountForProfile(
  numberOfRaces: number,
  discardProfile: string | null = 'standard',
): number {
  return getExcludeCountForConfig(
    numberOfRaces,
    normalizeDiscardConfig(discardProfile),
  );
}
