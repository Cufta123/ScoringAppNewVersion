/**
 * SHRS 2. NUMBER AND SIZE OF HEATS — shared by the main process (which
 * enforces the cap) and the renderer (which has to offer a sane default),
 * so the rule is stated once.
 *
 *   2.1 The number of heats shall be as few as possible.
 *   2.2 The number of boats in each heat shall be as equal as possible.
 *   2.3 The maximum number of boats in a heat shall be 20.
 */

/** SHRS 2.3. */
export const SHRS_MAX_BOATS_PER_HEAT = 20;

/** The app's own limit: heats are named "Heat A1".."Heat Z1". */
export const MAX_HEATS = 26;

/**
 * The fewest heats that can hold `entryCount` boats without breaking 2.3 —
 * which, by 2.1, is the number that should be used unless the race office has
 * a reason to pick another.
 *
 * The UI used to default to 5 regardless of the entry list, so a club event of
 * a dozen boats got five heats of two or three unless someone changed the
 * dropdown: not the fewest possible, and a much worse regatta. One heat is the
 * floor, including for an entry list that is still empty.
 */
export function minimumHeatsForEntries(entryCount: number): number {
  if (!Number.isFinite(entryCount) || entryCount <= 0) return 1;
  return Math.min(
    MAX_HEATS,
    Math.max(1, Math.ceil(entryCount / SHRS_MAX_BOATS_PER_HEAT)),
  );
}
