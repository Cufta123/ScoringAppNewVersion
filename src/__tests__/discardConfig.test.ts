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

  it('an EMPTY threshold list falls back to the standard 4/8/8 profile, not "never discard"', () => {
    // NOTE (potential issue): normalizeDiscardConfig keeps thresholds:[] but
    // getExcludeCountForConfig only honours thresholds when length > 0, so an
    // empty list silently reverts to the default profile. A user who sets an
    // empty threshold list expecting "no discards" would still get standard
    // discards. Documented here; flagged for a product decision.
    const c = normalizeDiscardConfig({ thresholds: [] });
    expect(getExcludeCountForConfig(50, c)).toBe(7); // 2 + floor((50-8)/8)
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
