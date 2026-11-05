/**
 * Putting boats into heats: SHRS 3 seeding, the 3.1 serpentine for the first
 * race, the Heat Movement Table after it, and the 5.3 recording order the
 * table reads places from.
 */
import {
  NO_PLACE_CODES,
  PENALTY_CODES,
  type Boat,
  type NoPlaceCode,
} from '../types';

const natKey = (boat: Boat) => boat.nat.trim().toUpperCase();
const sailKey = (boat: Boat) =>
  boat.sail.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * SHRS 3 preamble, 3.1(4), 5.3: national letters alphabetically, then sail
 * number numerically (9 before 10).
 */
export function compareBoats(a: Boat, b: Boat): number {
  return (
    natKey(a).localeCompare(natKey(b)) ||
    sailKey(a).localeCompare(sailKey(b), undefined, { numeric: true }) ||
    // "012" and "12" are two boats (sameBoat) but equal numbers: keep a
    // fixed order between them.
    sailKey(a).localeCompare(sailKey(b))
  );
}

/**
 * The same boat entered twice: the same national letters and the same sail
 * number as written ("CRO 12" and "cro 12 " are one boat; "CRO 012" and
 * "CRO 12" are two, as in the app).
 */
export function sameBoat(a: Boat, b: Boat): boolean {
  return natKey(a) === natKey(b) && sailKey(a) === sailKey(b);
}

/**
 * SHRS 3.1(1): heat index of each seeded boat, top boat first, walking
 * 1, 2, …, n, n, …, 2, 1, 1, 2, …
 */
export function serpentine(boatCount: number, heatCount: number): number[] {
  const heats: number[] = [];
  for (let i = 0; i < boatCount; i += 1) {
    const lap = Math.floor(i / heatCount);
    const step = i % heatCount;
    heats.push(lap % 2 === 0 ? step : heatCount - 1 - step);
  }
  return heats;
}

/**
 * The Heat Movement Table: 1st stays in her heat, every further place moves
 * one heat down the list, wrapping from the first heat to the last.
 */
export function nextHeat(
  heatIndex: number,
  place: number,
  heatCount: number,
): number {
  const shift = (place - 1) % heatCount;
  return (((heatIndex - shift) % heatCount) + heatCount) % heatCount;
}

const CODE_RANK = new Map<string, number>(
  NO_PLACE_CODES.map((code, index) => [code, index]),
);

/**
 * SHRS 5.3: where a no-place code is recorded among the codes (0 = DNF).
 * Codes 5.3 does not name come after DGM, in no order of their own.
 */
export function codeRank(code: string): number {
  return CODE_RANK.get(code) ?? NO_PLACE_CODES.length;
}

/**
 * SHRS 5.3 recording order of a finish list as entered: boats that keep a
 * place (no code, or ZFP / SCP / T1) stay in the order given; boats with a
 * no-place code follow, in the 5.3 order of their codes, boats with the
 * same code ordered by `tieBreak` (5.3: national letters and sail number).
 */
export function inRecordingOrder<T>(
  items: readonly T[],
  codeOf: (item: T) => string | undefined,
  tieBreak: (a: T, b: T) => number,
): T[] {
  const keepsPlace = (item: T) => {
    const code = codeOf(item);
    return !code || (PENALTY_CODES as readonly string[]).includes(code);
  };
  const placed = items.filter(keepsPlace);
  const displaced = items
    .filter((item) => !keepsPlace(item))
    .sort(
      (a, b) => codeRank(codeOf(a)!) - codeRank(codeOf(b)!) || tieBreak(a, b),
    );
  return [...placed, ...displaced];
}

/** One boat as recorded: a finishing slot, or a code. */
export interface Recorded {
  boat: Boat;
  slot?: number;
  code?: NoPlaceCode;
}

/**
 * SHRS 5.3 recording order: finishers by place, then the codes in the order
 * DNF, RET, NSC, OCS, DNS, DNC, WTH, UFD, BFD, DSQ, DNE; ties by national
 * letters and sail number (also 3.1(3), 3.1(4)).
 */
export function compareRecorded(a: Recorded, b: Recorded): number {
  const rank = (row: Recorded) =>
    row.code === undefined ? -1 : CODE_RANK.get(row.code)!;
  return (
    rank(a) - rank(b) ||
    (a.slot ?? 0) - (b.slot ?? 0) ||
    compareBoats(a.boat, b.boat)
  );
}
