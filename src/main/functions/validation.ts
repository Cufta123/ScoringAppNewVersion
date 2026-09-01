/**
 * Server-side numeric and identity guards for score writes.
 *
 * BK-6: several write paths bind `Number(new_position)` / `Number(place)` to the
 * `Scores.position` / `Scores.points` REAL NOT NULL columns without checking for
 * NaN. better-sqlite3 turns NaN into NULL, which then violates NOT NULL (or a
 * 0 / negative value silently degrades the score), producing an opaque
 * SQLITE_CONSTRAINT that rolls back the whole batch. These helpers turn that
 * into a clear, descriptive error BEFORE the write.
 *
 * RRS A10 / CMP C-23/C-24: redress (RDG*) and DPI points are SET BY THE PROTEST
 * COMMITTEE and may legitimately be fractional or less than 1, so those call
 * sites use `sanitizePositiveFinite` (finite and > 0, fractional allowed) rather
 * than the integer helper — do NOT clamp them to integers.
 */

/**
 * Normalize a sail number for identity comparison. Sail numbers may be stored
 * as a number or a string (or null), so both sides of a match must agree on one
 * string form. Empty/null values collapse to ''.
 */
export function normalizeSailNumber(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Find sail numbers that are used by more than one boat (an empty sail number
 * counts too). Two boats sharing a sail number collide when keying a
 * boat-by-sail map, which silently drops one boat's score — so this must be
 * checked before any such map is built.
 */
export function detectDuplicateSailNumbers(
  boats: Array<{ boat_id: number | string; sail_number: unknown }>,
): Array<{ sail: string; boatIds: Array<number | string> }> {
  const bySail = new Map<string, Array<number | string>>();
  boats.forEach((boat) => {
    const key = normalizeSailNumber(boat.sail_number);
    const ids = bySail.get(key) ?? [];
    ids.push(boat.boat_id);
    bySail.set(key, ids);
  });
  return [...bySail.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([sail, boatIds]) => ({ sail, boatIds }));
}

/**
 * Coerce `value` to a finite integer >= 1, or throw a descriptive error.
 * Used for finishing places and derived penalty positions/points, which are
 * always positive whole numbers.
 */
export function sanitizePositiveInteger(
  value: unknown,
  context: string,
): number {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
    throw new Error(
      `${context} must be a positive integer (received ${JSON.stringify(value)}).`,
    );
  }
  return num;
}

/**
 * Coerce `value` to a finite number > 0 (fractional allowed), or throw a
 * descriptive error. Used for protest-committee-set RDG/DPI points, which may
 * be fractional or less than 1 (CMP C-23/C-24) but can never be NaN, Infinity,
 * 0 or negative.
 */
export function sanitizePositiveFinite(
  value: unknown,
  context: string,
): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(
      `${context} must be a positive number (received ${JSON.stringify(value)}).`,
    );
  }
  return num;
}
