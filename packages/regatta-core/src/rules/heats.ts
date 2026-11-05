/**
 * SHRS 2, number and size of heats, and the note under the Heat Movement
 * Tables.
 *
 *   2.1 The number of heats shall be as few as possible.
 *   2.2 The number of boats in each heat shall be as equal as possible.
 *   2.3 The maximum number of boats in a heat shall be 20.
 */
import { MAX_HEAT_SIZE } from './fleets';

/** The most heats a round can have: they are lettered A to Z. */
export const MAX_HEATS = 26;

/**
 * SHRS 2.1 / 2.3: the fewest heats that hold `entries` boats with no heat
 * over 20. One for an empty entry list; never more than `MAX_HEATS`.
 */
export function fewestHeats(entries: number): number {
  if (!Number.isFinite(entries) || entries <= 0) return 1;
  return Math.min(MAX_HEATS, Math.max(1, Math.ceil(entries / MAX_HEAT_SIZE)));
}

/**
 * The note under the SHRS Heat Movement Tables: "with entries of 10, 14,
 * 18, 22, 26, 30, 34 and 38 every second race will result in Heat 1 having
 * 2 more boats than Heat 2". True when a round of `heatCount` heats with
 * `boats` boats is such a case, so the imbalance is the table's, not a
 * mistake. Larger entries follow the same step (every 4 from 10).
 */
export function movementImbalanceExpected(
  heatCount: number,
  boats: number,
): boolean {
  return heatCount === 2 && boats >= 10 && boats % 4 === 2;
}
