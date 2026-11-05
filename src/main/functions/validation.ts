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

/** ", not 3.5" — what was entered, when there was something to show. */
function given(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `, not ${value}`;
  }
  if (typeof value === 'string' && value.trim() && value.length <= 20) {
    return `, not "${value.trim()}"`;
  }
  return ' (it was empty)';
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
      `${context} must be a whole number of 1 or more${given(value)}.`,
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
    throw new Error(`${context} must be a number above 0${given(value)}.`);
  }
  return num;
}
