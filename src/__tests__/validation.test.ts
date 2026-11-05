import {
  sanitizePositiveInteger,
  sanitizePositiveFinite,
} from '../main/functions/validation';

describe('sanitizePositiveInteger', () => {
  it('accepts positive integers', () => {
    expect(sanitizePositiveInteger(1, 'Place')).toBe(1);
    expect(sanitizePositiveInteger('3', 'Place')).toBe(3);
    expect(sanitizePositiveInteger(20, 'Place')).toBe(20);
  });

  it('rejects NaN, 0, negatives, fractions and Infinity', () => {
    for (const bad of [NaN, 0, -1, 2.5, Infinity, -Infinity]) {
      expect(() => sanitizePositiveInteger(bad, 'Place')).toThrow(
        /must be a whole number of 1 or more/,
      );
    }
  });

  it('rejects non-numeric input', () => {
    expect(() => sanitizePositiveInteger('abc', 'Place')).toThrow(
      /must be a whole number of 1 or more/,
    );
    expect(() => sanitizePositiveInteger(undefined, 'Place')).toThrow(
      /must be a whole number of 1 or more/,
    );
    expect(() => sanitizePositiveInteger(null, 'Place')).toThrow(
      /must be a whole number of 1 or more/,
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
        /must be a number above 0/,
      );
    }
  });
});
