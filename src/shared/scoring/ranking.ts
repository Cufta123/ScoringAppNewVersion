/**
 * RRS A8 / SHRS 5.7 ranking primitives shared by qualifying, final and overall
 * scoring. Pure: no database, no UI.
 */

/** A boat's id: the database's integer, or a string where a caller keys by text. */
export type BoatKey = string | number;

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
 * Boats that are STILL tied with the boat directly above them after every
 * tie-break has been applied (`compare` returns 0). RRS A8 breaks ties only
 * while the scores differ somewhere; boats with identical scores remain tied
 * and share the place, rather than being split by an internal id.
 */
export function findUnbrokenTies<T extends { boat_id: BoatKey }>(
  order: T[],
  compare: (left: T, right: T) => number,
): Set<string> {
  const tied = new Set<string>();
  for (let i = 1; i < order.length; i += 1) {
    if (compare(order[i - 1], order[i]) === 0) {
      tied.add(String(order[i].boat_id));
    }
  }
  return tied;
}

/**
 * Number a ranked table 1..n, giving a boat that remained tied with the boat
 * above (same total, in `tiedWithAbove`) the same place: 1, 2, 2, 4.
 */
export function assignPlaces(
  table: { boat_id: BoatKey; totalPoints: number; place?: number }[],
  tiedWithAbove: Set<string>,
): void {
  table.forEach((boat, index) => {
    const above = table[index - 1];
    // eslint-disable-next-line no-param-reassign
    boat.place =
      above &&
      above.totalPoints === boat.totalPoints &&
      tiedWithAbove.has(String(boat.boat_id))
        ? above.place
        : index + 1;
  });
}

/**
 * SHRS 2026 5.7(ii)(3): resolve the highest-place tie first, then re-apply
 * the tie-break comparison on the remaining tied boats. The shared-heat
 * comparison of 5.7.2 is not transitive, so a single sort is not enough.
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
