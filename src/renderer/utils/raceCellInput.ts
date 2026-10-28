/**
 * What a person may type into a leaderboard race cell while editing results.
 *
 * A finishing place is a whole number from 1 to the number of boats that
 * sailed that race. Protest-committee points (RDG3, DPI) are a number above 0,
 * at most 99, with at most one decimal; a comma is read as the decimal point,
 * as Croatian and most European keyboards type it.
 *
 * Invalid input is never corrected silently (15 in a 10-boat heat used to turn
 * into 10 as it was typed): it is shown in red with the reason and blocks Save
 * until it is fixed.
 */
export type RaceCellInputKind = 'place' | 'points';

export type RaceCellInputCheck =
  | { ok: true; value: number }
  | { ok: false; short: string; message: string };

const fail = (short: string, message: string): RaceCellInputCheck => ({
  ok: false,
  short,
  message,
});

const MAX_MANUAL_POINTS = 99;

export function checkRaceCellInput(
  text: string,
  kind: RaceCellInputKind,
  maxPlace = 0,
): RaceCellInputCheck {
  const value = text.trim().replace(',', '.');

  if (kind === 'points') {
    if (value === '') return fail('Required', 'Enter the points.');
    if (!/^\d+(\.\d)?$/.test(value)) {
      return fail(
        'Number only',
        'Points must be a number with at most one decimal, e.g. 4 or 4.5.',
      );
    }
    const points = Number(value);
    if (points <= 0) return fail('Above 0', 'Points must be more than 0.');
    if (points > MAX_MANUAL_POINTS) {
      return fail(
        `Max ${MAX_MANUAL_POINTS}`,
        `Points cannot be more than ${MAX_MANUAL_POINTS}.`,
      );
    }
    return { ok: true, value: points };
  }

  const range = maxPlace > 0 ? `1–${maxPlace}` : '1 or more';
  if (value === '') return fail(range, `Enter a place (${range}).`);
  if (!/^\d+$/.test(value)) {
    return fail(range, `A place is a whole number (${range}).`);
  }
  const place = Number(value);
  if (place < 1) return fail(range, `The best place is 1 (${range}).`);
  if (maxPlace > 0 && place > maxPlace) {
    return fail(
      range,
      `Only ${maxPlace} boats sailed this race, so the place must be ${range}.`,
    );
  }
  return { ok: true, value: place };
}
