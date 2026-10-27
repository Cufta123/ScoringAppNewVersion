/**
 * Point totals, without floating-point noise.
 *
 * Scores are not all whole numbers: RRS A7 ties average to halves and RDG
 * redress averages are rounded to tenths (RRS A9). Tenths are not exact in
 * binary, so summing them leaves noise — roughly one sum in four of tenth-point
 * scores comes out as e.g. 87.10000000000001 instead of 87.1. Two boats on the
 * same total then compare unequal, the event tie is never detected, and the
 * SHRS 5.7 / RRS A8 tie-break is skipped in favour of the rounding error.
 *
 * Every total that is compared or ranked goes through `roundPoints`. Rounding
 * to a millionth removes the noise (which is ~1e-14) while staying far finer
 * than any score a rule can produce, so no legitimate difference is erased.
 */
const POINT_PRECISION = 1e6;

export function roundPoints(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * POINT_PRECISION) / POINT_PRECISION;
}

/** Sum a list of scores and return a total that compares exactly. */
export function sumPoints(values: Iterable<number>): number {
  let total = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const value of values) total += value;
  return roundPoints(total);
}
