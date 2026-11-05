/**
 * Ranking a series: totals, then RRS A8 as changed by SHRS 5.7, and places
 * shared by boats no rule can separate (1, 2, 2, 4).
 */

/** One race score of one boat, as the tie-breaks see it. */
export interface TieScore {
  /** The physical race (same value = sailed in the same heat). */
  race: string;
  /** Sorts races in time; larger is later. */
  order: number;
  points: number;
}

/** A8.1 / A8.2 list compare; a missing entry is the worst score. */
export function compareLists(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? Infinity;
    const right = b[i] ?? Infinity;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

export const bestFirst = (scores: readonly number[]) =>
  [...scores].sort((a, b) => a - b);

export const lastRaceFirst = (scores: readonly TieScore[]) =>
  [...scores].sort((a, b) => b.order - a.order).map((score) => score.points);

/** The races two boats sailed together, as pairs, last race first. */
export function sharedRaces(a: readonly TieScore[], b: readonly TieScore[]) {
  const byRace = new Map(b.map((score) => [score.race, score]));
  return a
    .filter((score) => byRace.has(score.race))
    .sort((x, y) => y.order - x.order)
    .map((score) => ({ a: score.points, b: byRace.get(score.race)!.points }));
}

/**
 * Two boats compared on the races they sailed together: A8.1 with every
 * score of those races (SHRS 5.7(ii)(2)), then A8.2. Null if they never met.
 */
export function compareOnSharedRaces(
  a: readonly TieScore[],
  b: readonly TieScore[],
): number | null {
  const shared = sharedRaces(a, b);
  if (shared.length === 0) return null;
  const left = shared.map((pair) => pair.a);
  const right = shared.map((pair) => pair.b);
  return (
    compareLists(bestFirst(left), bestFirst(right)) || compareLists(left, right)
  );
}

export interface Ranked<T> {
  item: T;
  place: number;
  /**
   * The tie-break went round in a circle (A ahead of B, B ahead of C, C
   * ahead of A: possible under 5.7(ii), which compares each pair on the
   * races they sailed together), so `fallback` placed this boat or a boat
   * of her tie above her.
   */
  circular?: boolean;
}

/**
 * Lowest total first. Equal totals are broken by `compare`, the higher
 * place first (SHRS 5.7(ii)(3)): the place goes to the boat no other tied
 * boat beats, then the rest are compared again. When every boat is beaten
 * by another (a circle, which the rules do not settle), `fallback` decides
 * the place. Boats `compare` cannot separate share the place.
 */
export function rankByTotal<T>(
  items: readonly T[],
  total: (item: T) => number,
  compare: (a: T, b: T) => number,
  fallback: (a: T, b: T) => number = () => 0,
): Ranked<T>[] {
  const groups = new Map<number, T[]>();
  items.forEach((item) => {
    const key = total(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  const ranked: Ranked<T>[] = [];
  [...groups.keys()]
    .sort((a, b) => a - b)
    .forEach((key) => {
      const remaining = [...groups.get(key)!];
      let circle = false;
      while (remaining.length > 0) {
        const unbeaten = remaining.find((candidate) =>
          remaining.every((other) => compare(other, candidate) >= 0),
        );
        const item = unbeaten ?? [...remaining].sort(fallback)[0];
        if (unbeaten === undefined) circle = true;
        remaining.splice(remaining.indexOf(item), 1);
        const above = ranked[ranked.length - 1];
        const shares =
          above !== undefined &&
          total(above.item) === key &&
          compare(above.item, item) === 0;
        ranked.push({
          item,
          place: shares ? above.place : ranked.length + 1,
          ...(circle ? { circular: true } : {}),
        });
      }
    });
  return ranked;
}
