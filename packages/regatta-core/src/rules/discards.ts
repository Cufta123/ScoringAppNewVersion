/**
 * SHRS 5.4 discards.
 */
import type { DiscardProfile } from '../types';

/** How many scores are excluded after `completedRaces` races of a series. */
export function discardCount(
  completedRaces: number,
  profile: DiscardProfile,
): number {
  if (profile.kind === 'none') return 0;
  if (profile.kind === 'thresholds') {
    return profile.at.filter((at) => completedRaces >= at).length;
  }
  // Standard: after 4 races one, after 8 two, then one more for every 8.
  const { first, second, every } =
    profile.kind === 'custom' ? profile : { first: 4, second: 8, every: 8 };
  if (completedRaces < first) return 0;
  if (completedRaces < second) return 1;
  return 2 + Math.floor((completedRaces - second) / every);
}

/** RRS 90.3(b): a DNE or DGM is never excluded. */
export const NOT_EXCLUDABLE: ReadonlySet<string> = new Set(['DNE', 'DGM']);

export interface Discardable {
  points: number;
  code?: string;
  /** When the race was sailed; equal worst scores drop the earliest. */
  order: number;
}

/**
 * Which of a boat's scores are excluded: her `count` worst excludable ones.
 * A boat always keeps one score (an app guard: with every race scored for
 * every boat it never binds). Returns indexes into `scores`.
 */
export function excludedScores(
  scores: readonly Discardable[],
  count: number,
): Set<number> {
  const limit = Math.min(count, Math.max(0, scores.length - 1));
  if (limit <= 0) return new Set();
  const worstFirst = scores
    .map((score, index) => ({ score, index }))
    .filter(({ score }) => !NOT_EXCLUDABLE.has(score.code ?? ''))
    .sort(
      (a, b) =>
        b.score.points - a.score.points || a.score.order - b.score.order,
    );
  return new Set(worstFirst.slice(0, limit).map(({ index }) => index));
}
