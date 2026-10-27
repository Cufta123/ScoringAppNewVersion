/**
 * SHRS 5.4 discards: which of a boat's scores are excluded from her series
 * score. Pure — the main-process recompute, the explain panel and the
 * leaderboard screen all call these, so they can never pick different races.
 */

/** RRS 90.3(b)/A5: a DNE or DGM can never be excluded. */
export const nonExcludableStatuses: ReadonlySet<string> = new Set([
  'DNE',
  'DGM',
]);

export interface KeptScoreEntry {
  points: number;
  status?: string;
  race_number?: number;
  race_id?: number;
}

/**
 * The worst `excludeCount` excludable scores, as indexes into `entries`.
 * Equal worst scores are broken by the earliest race (race_number, then
 * race_id), so the same race is marked whichever order `entries` arrive in.
 */
export function getExcludedIndexes(
  entries: KeptScoreEntry[],
  excludeCount: number,
): Set<number> {
  if (excludeCount <= 0) {
    return new Set();
  }

  const candidates = entries
    .map((entry, idx) => ({ entry, idx }))
    .filter(
      ({ entry }) =>
        !nonExcludableStatuses.has(
          String(entry.status ?? 'FINISHED').toUpperCase(),
        ),
    )
    .sort(
      (left, right) =>
        right.entry.points - left.entry.points ||
        (left.entry.race_number ?? Number.MAX_SAFE_INTEGER) -
          (right.entry.race_number ?? Number.MAX_SAFE_INTEGER) ||
        (left.entry.race_id ?? Number.MAX_SAFE_INTEGER) -
          (right.entry.race_id ?? Number.MAX_SAFE_INTEGER),
    );

  return new Set(candidates.slice(0, excludeCount).map(({ idx }) => idx));
}

/**
 * SHRS 5.4 discard counts are series-wide, but low-point scoring can never drop
 * a boat below her single best race. A boat with fewer scores than the series
 * discard count (e.g. a late entrant whose missing races are not seeded) must
 * still keep one score, so cap the count at (scores available − 1).
 *
 * Every site that turns a series-wide discard count into a per-boat one must
 * use this, so a boat's total and her tie-break vector are derived from the
 * same number of discards.
 */
export function capExcludeCountForBoat(
  seriesExcludeCount: number,
  availableScoreCount: number,
): number {
  return Math.min(seriesExcludeCount, Math.max(0, availableScoreCount - 1));
}

/**
 * The points left after excluding the worst `excludeCount` excludable scores,
 * in the original entry order.
 */
export function getKeptScores(
  entries: KeptScoreEntry[],
  excludeCount: number,
): number[] {
  if (excludeCount <= 0) {
    return entries.map((entry) => entry.points);
  }

  const excludedIndexes = getExcludedIndexes(entries, excludeCount);

  return entries
    .filter((_entry, idx) => !excludedIndexes.has(idx))
    .map((entry) => entry.points);
}
