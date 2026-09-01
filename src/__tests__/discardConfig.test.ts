/* eslint-disable camelcase */
/**
 * Unit tests for discardConfig.ts — SHRS 5.4 discard configuration. Covers the
 * standard-profile boundary arithmetic and the custom-profile parsing/validation
 * branches (thresholds, per-field overrides, and their error paths), which drive
 * how many scores each boat discards and therefore its series score.
 */
import {
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
  getExcludeCountForConfig,
} from '../main/functions/discardConfig';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

const DEFAULT = { firstDiscardAt: 4, secondDiscardAt: 8, additionalEvery: 8 };

describe('normalizeDiscardConfig — defaults', () => {
  it('returns the standard profile for null / empty / "standard"', () => {
    expect(normalizeDiscardConfig(null)).toMatchObject(DEFAULT);
    expect(normalizeDiscardConfig('')).toMatchObject(DEFAULT);
    expect(normalizeDiscardConfig('standard')).toMatchObject(DEFAULT);
    expect(normalizeDiscardConfig(undefined)).toMatchObject(DEFAULT);
  });

  it('falls back to the standard profile on unparseable JSON', () => {
    expect(normalizeDiscardConfig('{not json')).toMatchObject(DEFAULT);
  });

  it('falls back to the standard profile for a non-object JSON value', () => {
    expect(normalizeDiscardConfig('5')).toMatchObject(DEFAULT);
  });
});

describe('normalizeDiscardConfig — threshold profiles', () => {
  it('accepts a strictly increasing threshold list', () => {
    expect(normalizeDiscardConfig({ thresholds: [4, 8, 16] })).toMatchObject({
      firstDiscardAt: 4,
      secondDiscardAt: 8,
      thresholds: [4, 8, 16],
    });
  });

  it('treats an empty threshold list as "never discard"', () => {
    expect(normalizeDiscardConfig({ thresholds: [] })).toMatchObject({
      thresholds: [],
    });
  });

  it('rejects a non-array thresholds field', () => {
    expect(() => normalizeDiscardConfig({ thresholds: 'nope' })).toThrow();
  });

  it('rejects non-positive-integer thresholds', () => {
    expect(() => normalizeDiscardConfig({ thresholds: [4, 0] })).toThrow();
    expect(() => normalizeDiscardConfig({ thresholds: [4, 2.5] })).toThrow();
  });

  it('rejects a non-increasing threshold list', () => {
    expect(() => normalizeDiscardConfig({ thresholds: [8, 4] })).toThrow();
  });

  it('rejects a threshold list with duplicate values (not strictly increasing)', () => {
    expect(() => normalizeDiscardConfig({ thresholds: [4, 4, 8] })).toThrow();
  });
});

describe('normalizeDiscardConfig — per-field overrides', () => {
  it('keeps valid firstDiscardAt / secondDiscardAt / additionalEvery', () => {
    expect(
      normalizeDiscardConfig({
        firstDiscardAt: 5,
        secondDiscardAt: 10,
        additionalEvery: 6,
      }),
    ).toMatchObject({
      firstDiscardAt: 5,
      secondDiscardAt: 10,
      additionalEvery: 6,
    });
  });

  it('repairs a secondDiscardAt that is not greater than firstDiscardAt', () => {
    // 3 <= 5, so secondDiscardAt becomes firstDiscardAt + default additionalEvery.
    expect(
      normalizeDiscardConfig({ firstDiscardAt: 5, secondDiscardAt: 3 }),
    ).toMatchObject({ firstDiscardAt: 5, secondDiscardAt: 13 });
  });

  it('replaces invalid numeric fields with the defaults', () => {
    expect(
      normalizeDiscardConfig({ firstDiscardAt: -1, additionalEvery: 0 }),
    ).toMatchObject({ firstDiscardAt: 4, additionalEvery: 8 });
  });

  it('falls back to the default for a non-numeric field', () => {
    expect(normalizeDiscardConfig({ firstDiscardAt: 'abc' })).toMatchObject({
      firstDiscardAt: 4,
    });
  });

  it('truncates a fractional field to an integer rather than rejecting it', () => {
    expect(normalizeDiscardConfig({ firstDiscardAt: 4.9 })).toMatchObject({
      firstDiscardAt: 4,
    });
  });
});

describe('normalizeDiscardConfigString', () => {
  it('round-trips a normalized config back to JSON', () => {
    const parsed = JSON.parse(normalizeDiscardConfigString('standard'));
    expect(parsed).toMatchObject(DEFAULT);
  });
});

describe('normalizeDiscardConfig — round-trip (self-inverse)', () => {
  const roundTrip = (value: unknown) =>
    normalizeDiscardConfig(JSON.parse(normalizeDiscardConfigString(value)));

  it('round-trips an arithmetic custom profile back to itself, not never-discard', () => {
    const original = normalizeDiscardConfig({
      firstDiscardAt: 6,
      secondDiscardAt: 14,
      additionalEvery: 8,
    });
    const reparsed = roundTrip(original);

    expect(reparsed).toEqual(original);
    expect(reparsed.neverDiscard).toBeUndefined();
    // The 6/14/8 schedule is preserved through the round-trip.
    expect(getExcludeCountForConfig(5, reparsed)).toBe(0);
    expect(getExcludeCountForConfig(6, reparsed)).toBe(1);
    expect(getExcludeCountForConfig(14, reparsed)).toBe(2);
    expect(getExcludeCountForConfig(22, reparsed)).toBe(3);
  });

  it('does not serialize an arithmetic profile with an empty thresholds list', () => {
    const serialized = normalizeDiscardConfigString({
      firstDiscardAt: 6,
      secondDiscardAt: 14,
      additionalEvery: 8,
    });
    expect(serialized).not.toContain('"thresholds":[]');
    expect(JSON.parse(serialized)).not.toHaveProperty('thresholds');
  });

  it('round-trips a never-discard profile back to never-discard', () => {
    const original = normalizeDiscardConfig({ thresholds: [] });
    const reparsed = roundTrip(original);

    expect(reparsed).toEqual(original);
    expect(reparsed.neverDiscard).toBe(true);
    expect(getExcludeCountForConfig(50, reparsed)).toBe(0);
  });

  it('round-trips the standard profile back to the standard defaults', () => {
    const original = normalizeDiscardConfig('standard');
    const reparsed = roundTrip(original);

    expect(reparsed).toEqual(original);
    expect(reparsed.neverDiscard).toBeUndefined();
    expect(getExcludeCountForConfig(8, reparsed)).toBe(2);
  });

  it('round-trips a threshold-list profile back to the same thresholds', () => {
    const original = normalizeDiscardConfig({ thresholds: [4, 8, 16] });
    const reparsed = roundTrip(original);

    expect(reparsed).toEqual(original);
    expect(getExcludeCountForConfig(16, reparsed)).toBe(3);
  });
});

describe('getExcludeCountForConfig — SHRS 5.4 boundaries', () => {
  it('follows 0 / 1 / 2 (+1 per 8) for the standard profile', () => {
    const c = normalizeDiscardConfig('standard');
    expect(getExcludeCountForConfig(3, c)).toBe(0);
    expect(getExcludeCountForConfig(4, c)).toBe(1);
    expect(getExcludeCountForConfig(7, c)).toBe(1);
    expect(getExcludeCountForConfig(8, c)).toBe(2);
    expect(getExcludeCountForConfig(15, c)).toBe(2);
    expect(getExcludeCountForConfig(16, c)).toBe(3);
    expect(getExcludeCountForConfig(24, c)).toBe(4);
  });

  it('counts how many thresholds are reached for a threshold profile', () => {
    const c = normalizeDiscardConfig({ thresholds: [4, 8, 16] });
    expect(getExcludeCountForConfig(3, c)).toBe(0);
    expect(getExcludeCountForConfig(4, c)).toBe(1);
    expect(getExcludeCountForConfig(8, c)).toBe(2);
    expect(getExcludeCountForConfig(16, c)).toBe(3);
    expect(getExcludeCountForConfig(99, c)).toBe(3);
  });

  it('supports a single-threshold profile (one discard once reached)', () => {
    const c = normalizeDiscardConfig({ thresholds: [6] });
    expect(getExcludeCountForConfig(5, c)).toBe(0);
    expect(getExcludeCountForConfig(6, c)).toBe(1);
    expect(getExcludeCountForConfig(99, c)).toBe(1);
  });

  // RULE-m6 / SHRS 5.4: "The Race Committee may change this rule before the
  // warning signal for the first race in a series." An explicitly empty
  // threshold list is such a change and means NEVER discard. It used to fall
  // through to the standard 4/8/8, so an event configured for no discards
  // discarded anyway.
  it('an EMPTY threshold list means "never discard" (SHRS 5.4 RC change)', () => {
    const c = normalizeDiscardConfig({ thresholds: [] });
    expect(c.neverDiscard).toBe(true);
    expect(getExcludeCountForConfig(0, c)).toBe(0);
    expect(getExcludeCountForConfig(4, c)).toBe(0);
    expect(getExcludeCountForConfig(8, c)).toBe(0);
    expect(getExcludeCountForConfig(50, c)).toBe(0);
  });

  it('does NOT treat a custom first/second/every profile as never-discard', () => {
    // The arithmetic branch also emits `thresholds: []`, so the never-discard
    // sentinel must be the explicit flag — otherwise every stored custom
    // profile would silently stop discarding.
    const c = normalizeDiscardConfig({
      firstDiscardAt: 5,
      secondDiscardAt: 10,
      additionalEvery: 10,
    });
    expect(c.neverDiscard).toBeUndefined();
    expect(getExcludeCountForConfig(4, c)).toBe(0);
    expect(getExcludeCountForConfig(5, c)).toBe(1);
    expect(getExcludeCountForConfig(10, c)).toBe(2);
  });

  it('follows a custom per-field profile boundary, not just the standard defaults', () => {
    // firstDiscardAt=3, secondDiscardAt=6, additionalEvery=6.
    const c = normalizeDiscardConfig({
      firstDiscardAt: 3,
      secondDiscardAt: 6,
      additionalEvery: 6,
    });
    expect(getExcludeCountForConfig(2, c)).toBe(0);
    expect(getExcludeCountForConfig(3, c)).toBe(1);
    expect(getExcludeCountForConfig(5, c)).toBe(1);
    expect(getExcludeCountForConfig(6, c)).toBe(2);
    expect(getExcludeCountForConfig(11, c)).toBe(2);
    expect(getExcludeCountForConfig(12, c)).toBe(3);
  });

  it('returns 0 exclusions for 0 or negative race counts', () => {
    const c = normalizeDiscardConfig('standard');
    expect(getExcludeCountForConfig(0, c)).toBe(0);
    expect(getExcludeCountForConfig(-1, c)).toBe(0);
  });
});
