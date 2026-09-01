/* eslint-disable camelcase */
/**
 * SHRS 5.3 / 3.1(iv): "Ties will be recorded in alphanumerical order of
 * national letter and sail number." (RULE-m5)
 */
import { compareNationalSail, compareSailNumbers } from '../shared/sailOrder';
import { compareSeededRows } from '../main/functions/scoreStatus';

const sorted = <T>(rows: T[], cmp: (a: T, b: T) => number) =>
  [...rows].sort(cmp);

describe('compareSailNumbers', () => {
  it('orders sail numbers numerically, not as strings', () => {
    expect(compareSailNumbers(9, 10)).toBeLessThan(0);
    expect(sorted([10, 9, 100, 2], compareSailNumbers)).toEqual([
      2, 9, 10, 100,
    ]);
  });

  it('treats null/undefined as an empty sail number rather than throwing', () => {
    expect(() => compareSailNumbers(null, undefined)).not.toThrow();
    expect(compareSailNumbers(null, undefined)).toBe(0);
  });
});

describe('compareNationalSail (SHRS 5.3)', () => {
  it('orders by national letter BEFORE sail number', () => {
    // CRO 999 must precede GER 1 — sail number alone would invert this.
    expect(
      compareNationalSail(
        { country: 'CRO', sail_number: 999 },
        { country: 'GER', sail_number: 1 },
      ),
    ).toBeLessThan(0);
  });

  it('falls back to numerical sail order within one nation', () => {
    const rows = [
      { country: 'CRO', sail_number: 10 },
      { country: 'CRO', sail_number: 9 },
      { country: 'AUT', sail_number: 50 },
    ];
    expect(sorted(rows, compareNationalSail)).toEqual([
      { country: 'AUT', sail_number: 50 },
      { country: 'CRO', sail_number: 9 },
      { country: 'CRO', sail_number: 10 },
    ]);
  });

  it('is case-insensitive on the national letter', () => {
    expect(
      compareNationalSail(
        { country: 'cro', sail_number: 1 },
        { country: 'CRO', sail_number: 1 },
      ),
    ).toBe(0);
  });

  it('sorts a missing national letter first, deterministically', () => {
    const rows = [
      { country: 'CRO', sail_number: 1 },
      { country: null, sail_number: 5 },
    ];
    expect(sorted(rows, compareNationalSail)[0].sail_number).toBe(5);
  });
});

describe('compareSeededRows keeps the 5.3 identity tie-break', () => {
  it('breaks a same-status displaced tie on national letter first', () => {
    const rows = [
      { position: null, status: 'DNF', country: 'GER', sail_number: 1 },
      { position: null, status: 'DNF', country: 'CRO', sail_number: 999 },
    ];
    expect(sorted(rows, compareSeededRows).map((r) => r.country)).toEqual([
      'CRO',
      'GER',
    ]);
  });

  it('still ranks finishers by position before any identity tie-break', () => {
    const rows = [
      { position: 2, status: 'FINISHED', country: 'AUT', sail_number: 1 },
      { position: 1, status: 'FINISHED', country: 'GER', sail_number: 9 },
    ];
    expect(sorted(rows, compareSeededRows).map((r) => r.position)).toEqual([
      1, 2,
    ]);
  });
});
