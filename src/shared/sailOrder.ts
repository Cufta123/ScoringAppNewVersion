/**
 * SHRS tie ordering by boat identity.
 *
 * SHRS 5.3: "Ties will be recorded in alphanumerical order of national letter
 * and sail number." SHRS 3.1(iv) says the same for heat assignment, and the
 * rule 3 preamble ranks boats "first by alphabetical order of their national
 * letter, then by numerical order of their sail number".
 *
 * Shared by the main process (`compareSeededRows`, the authoritative recording
 * order) and the renderer's data-entry ordering so a tie is broken identically
 * on screen and in the database — RULE-m5 was the renderer comparing the sail
 * number alone and silently dropping the national letter.
 */

/** Numeric-aware sail-number compare: keeps 9 before 10, unlike a string sort. */
export const compareSailNumbers = (
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): number =>
  String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

/** National letter first (alphabetical), then sail number (numerical). */
export function compareNationalSail(
  left: {
    country?: string | null;
    sail_number?: string | number | null;
  },
  right: {
    country?: string | null;
    sail_number?: string | number | null;
  },
): number {
  const leftCountry = String(left.country ?? '').toUpperCase();
  const rightCountry = String(right.country ?? '').toUpperCase();
  const byCountry = leftCountry.localeCompare(rightCountry);
  if (byCountry !== 0) return byCountry;

  return compareSailNumbers(left.sail_number, right.sail_number);
}

export default compareNationalSail;
