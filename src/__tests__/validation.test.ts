import {
  normalizeSailNumber,
  detectDuplicateSailNumbers,
  sanitizePositiveInteger,
  sanitizePositiveFinite,
} from '../main/functions/validation';

describe('normalizeSailNumber', () => {
  it('normalizes a numeric sail number to its string form', () => {
    expect(normalizeSailNumber(101)).toBe('101');
  });

  it('normalizes number and string forms to the same key', () => {
    expect(normalizeSailNumber(101)).toBe(normalizeSailNumber('101'));
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSailNumber('  42  ')).toBe('42');
  });

  it('collapses null/undefined to an empty string (never "null"/"undefined")', () => {
    expect(normalizeSailNumber(null)).toBe('');
    expect(normalizeSailNumber(undefined)).toBe('');
  });
});

describe('detectDuplicateSailNumbers', () => {
  it('returns nothing when every boat has a distinct sail number', () => {
    expect(
      detectDuplicateSailNumbers([
        { boat_id: 1, sail_number: '101' },
        { boat_id: 2, sail_number: 102 },
        { boat_id: 3, sail_number: '103' },
      ]),
    ).toEqual([]);
  });

  it('flags a sail number shared by two boats, including number-vs-string', () => {
    expect(
      detectDuplicateSailNumbers([
        { boat_id: 1, sail_number: '101' },
        { boat_id: 2, sail_number: 101 },
      ]),
    ).toEqual([{ sail: '101', boatIds: [1, 2] }]);
  });

  it('flags two boats with an empty sail number as a duplicate', () => {
    expect(
      detectDuplicateSailNumbers([
        { boat_id: 5, sail_number: null },
        { boat_id: 6, sail_number: '' },
        { boat_id: 7, sail_number: '99' },
      ]),
    ).toEqual([{ sail: '', boatIds: [5, 6] }]);
  });

  it('does not flag a single empty sail number', () => {
    expect(
      detectDuplicateSailNumbers([
        { boat_id: 5, sail_number: null },
        { boat_id: 7, sail_number: '99' },
      ]),
    ).toEqual([]);
  });
});

describe('sanitizePositiveInteger', () => {
  it('accepts positive integers', () => {
    expect(sanitizePositiveInteger(1, 'Place')).toBe(1);
    expect(sanitizePositiveInteger('3', 'Place')).toBe(3);
    expect(sanitizePositiveInteger(20, 'Place')).toBe(20);
  });

  it('rejects NaN, 0, negatives, fractions and Infinity', () => {
    for (const bad of [NaN, 0, -1, 2.5, Infinity, -Infinity]) {
      expect(() => sanitizePositiveInteger(bad, 'Place')).toThrow(
        /must be a positive integer/,
      );
    }
  });

  it('rejects non-numeric input', () => {
    expect(() => sanitizePositiveInteger('abc', 'Place')).toThrow(
      /must be a positive integer/,
    );
    expect(() => sanitizePositiveInteger(undefined, 'Place')).toThrow(
      /must be a positive integer/,
    );
    expect(() => sanitizePositiveInteger(null, 'Place')).toThrow(
      /must be a positive integer/,
    );
  });

  it('names the context in the error message', () => {
    expect(() => sanitizePositiveInteger(0, 'Place for sail 101')).toThrow(
      /Place for sail 101/,
    );
  });
});

describe('sanitizePositiveFinite (RDG/DPI points)', () => {
  it('accepts positive integers and fractions, including values below 1', () => {
    expect(sanitizePositiveFinite(4.5, 'Redress')).toBe(4.5);
    expect(sanitizePositiveFinite(0.5, 'Redress')).toBe(0.5);
    expect(sanitizePositiveFinite(8, 'Redress')).toBe(8);
  });

  it('rejects NaN, 0, negatives and Infinity', () => {
    for (const bad of [NaN, 0, -1, -0.5, Infinity, -Infinity]) {
      expect(() => sanitizePositiveFinite(bad, 'Redress')).toThrow(
        /must be a positive number/,
      );
    }
  });
});
