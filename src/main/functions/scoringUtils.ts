/* eslint-disable camelcase */

// SHRS 5.4 / RRS A8 helpers shared by qualifying, final and overall scoring.

export const nonExcludableStatuses = new Set(['DNE', 'DGM']);

export interface KeptScoreEntry {
  points: number;
  status?: string;
  race_number?: number;
  race_id?: number;
}

/**
 * Lexicographic comparison of two point arrays (RRS A8.1 / A8.2 style).
 * Missing entries compare as worst possible score.
 */
export function compareScoreArrays(
  scoresA: number[],
  scoresB: number[],
): number {
  const maxLength = Math.max(scoresA.length, scoresB.length);
  for (let i = 0; i < maxLength; i += 1) {
    const scoreA = scoresA[i] ?? Number.MAX_SAFE_INTEGER;
    const scoreB = scoresB[i] ?? Number.MAX_SAFE_INTEGER;
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
  }
  return 0;
}

/**
 * Apply SHRS 5.4 exclusions: drop the worst `excludeCount` excludable scores
 * (DNE/DGM are never excluded) and return the remaining points in the
 * original entry order. Worst-score ties are broken by earliest race.
 */
export function getKeptScores(
  entries: KeptScoreEntry[],
  excludeCount: number,
): number[] {
  if (excludeCount <= 0) {
    return entries.map((entry) => entry.points);
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

  const excludedIndexes = new Set(
    candidates.slice(0, excludeCount).map(({ idx }) => idx),
  );

  return entries
    .filter((_entry, idx) => !excludedIndexes.has(idx))
    .map((entry) => entry.points);
}

/**
 * SHRS 2026 5.7(ii)(3): resolve the highest-place tie first, then re-apply
 * the tie-break comparison on the remaining tied boats.
 */
export function resolveTiesSequentially<T>(
  items: T[],
  compare: (left: T, right: T) => number,
): T[] {
  const remaining = [...items];
  const resolved: T[] = [];

  while (remaining.length > 0) {
    remaining.sort(compare);
    const [winner] = remaining.splice(0, 1);
    resolved.push(winner);
  }

  return resolved;
}
