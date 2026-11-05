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
  // A boat shares the place above only if no rule separates her from ANY
  // boat on it. 5.7(ii) compares each pair on its own races, so "level" is
  // not transitive: A level with B and with C while B beats C. Comparing
  // with the boat just above alone let C share B's place (or not) by the
  // order the boats came in. regatta-core does the same (Nov 2026).
  const tied = new Set<string>();
  let onPlace: T[] = [];
  order.forEach((boat) => {
    if (
      onPlace.length > 0 &&
      onPlace.every((other) => compare(other, boat) === 0)
    ) {
      tied.add(String(boat.boat_id));
      onPlace.push(boat);
    } else {
      onPlace = [boat];
    }
  });
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
 * SHRS 2026 5.7(ii)(3): resolve the highest-place tie first, then compare
 * the remaining tied boats again.
 *
 * 5.7(ii) compares each pair on the races they sailed together, so it is not
 * transitive: A can beat B, B beat C and C beat A. Sorting with such a
 * comparator gives an order that depends on the input order (it used to
 * follow the database's row order, and could rank a boat above one that
 * beat her head-to-head). So each place goes to a boat that no remaining
 * boat beats; when there is none (a true circle, which the rules do not
 * settle) `fallback` picks the place, plain RRS A8.1/A8.2 as 5.7(ii)(4) does
 * for boats that never met. Boats the comparison leaves level keep their
 * input order.
 */
export function resolveTiesSequentially<T>(
  items: T[],
  compare: (left: T, right: T) => number,
  fallback: (left: T, right: T) => number = () => 0,
): T[] {
  const remaining = [...items];
  const resolved: T[] = [];

  while (remaining.length > 0) {
    const unbeaten = remaining.find((candidate) =>
      remaining.every((other) => compare(other, candidate) >= 0),
    );
    const winner = unbeaten ?? [...remaining].sort(fallback)[0];
    remaining.splice(remaining.indexOf(winner), 1);
    resolved.push(winner);
  }

  return resolved;
}
