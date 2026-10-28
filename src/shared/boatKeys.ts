/**
 * How a race officer names a boat when entering a finish: by sail number.
 *
 * Sail numbers are national, so two boats at one event can share one (ITA 12
 * and CRO 12) — common in the IOM class. Within a heat where the number is
 * unique, the number alone names the boat; where it is not, the national
 * letters are needed ("ITA 12"). Only the same letters AND number twice is a
 * real duplicate, which no screen could tell apart.
 *
 * Earlier the app refused any repeated number: it would not create the heats
 * of an event with ITA 12 and CRO 12 entered, and could not score a heat with
 * both in it.
 */

export interface KeyedBoat {
  boat_id: number | string;
  sail_number: unknown;
  country?: string | null;
}

/** "ita12", "ITA-12", " ita  12 " -> "ITA 12"; "012 " -> "012". */
export function normalizeEntryKey(value: unknown): string {
  const text = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const match = text.match(/^([A-Z]{2,3})[\s-]*([0-9][0-9A-Z]*)$/);
  return match ? `${match[1]} ${match[2]}` : text;
}

const sailOf = (boat: KeyedBoat) => normalizeEntryKey(boat.sail_number);
const nationalKey = (boat: KeyedBoat) =>
  normalizeEntryKey(`${String(boat.country ?? '').trim()} ${sailOf(boat)}`);

/**
 * The name to enter each boat by, within one group of boats (a heat): the
 * sail number when it is unique there, else national letters + number.
 */
export function entryKeysFor(boats: KeyedBoat[]): Map<string, string> {
  const count = new Map<string, number>();
  boats.forEach((boat) => {
    count.set(sailOf(boat), (count.get(sailOf(boat)) ?? 0) + 1);
  });
  return new Map(
    boats.map((boat) => [
      String(boat.boat_id),
      (count.get(sailOf(boat)) ?? 0) > 1 ? nationalKey(boat) : sailOf(boat),
    ]),
  );
}

/**
 * Every name that identifies one boat of the group: her entry key, and her
 * national letters + number (always accepted, even when the number alone
 * would do).
 */
export function boatsByEntryName<T extends KeyedBoat>(
  boats: T[],
): Map<string, T> {
  const keys = entryKeysFor(boats);
  const byName = new Map<string, T>();
  boats.forEach((boat) => {
    byName.set(keys.get(String(boat.boat_id)) as string, boat);
    if (String(boat.country ?? '').trim()) byName.set(nationalKey(boat), boat);
  });
  return byName;
}

/**
 * Boats no screen can tell apart: the same national letters and sail number,
 * or no sail number at all.
 */
export function findIndistinguishableBoats(
  boats: KeyedBoat[],
): Array<{ name: string; boatIds: Array<number | string> }> {
  const byName = new Map<string, Array<number | string>>();
  boats.forEach((boat) => {
    const name = sailOf(boat) === '' ? '' : nationalKey(boat);
    const ids = byName.get(name) ?? [];
    ids.push(boat.boat_id);
    byName.set(name, ids);
  });
  return [...byName.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, boatIds]) => ({ name, boatIds }));
}

/** "CRO 12 (boats 4, 9)" — for an error a race officer can act on. */
export function describeIndistinguishable(
  groups: Array<{ name: string; boatIds: Array<number | string> }>,
): string {
  return groups
    .map(({ name, boatIds }) =>
      name === ''
        ? `${boatIds.length} boats have no sail number`
        : `${name} is entered ${boatIds.length} times`,
    )
    .join('; ');
}
