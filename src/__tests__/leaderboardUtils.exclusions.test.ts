import {
  applyExclusions,
  getExcludeCount,
  processLeaderboardEntry,
} from '../renderer/utils/leaderboardUtils';

describe('leaderboardUtils applyExclusions edge cases', () => {
  it('does not exclude DNE/DGM even if they are worst scores', () => {
    const raw = ['10', '9', '8', '1'];
    const statuses = ['DNE', 'DGM', 'FINISHED', 'FINISHED'];
    const { markedRaces, total } = applyExclusions(raw, statuses, raw);

    expect(markedRaces).toEqual(['10', '9', '(8)', '1']);
    expect(total).toBe(20);
  });

  it('for equal worst scores excludes earliest race first', () => {
    const raw = ['7', '7', '2', '1'];
    const statuses = ['FINISHED', 'FINISHED', 'FINISHED', 'FINISHED'];
    const { markedRaces, total } = applyExclusions(raw, statuses, raw);

    expect(markedRaces).toEqual(['(7)', '7', '2', '1']);
    expect(total).toBe(10);
  });
});

describe('getExcludeCount — SHRS 5.4 boundaries and custom-profile edge cases', () => {
  it('applies the standard 4/8/8 thresholds when no custom profile is given', () => {
    expect(getExcludeCount(3)).toBe(0);
    expect(getExcludeCount(4)).toBe(1);
    expect(getExcludeCount(7)).toBe(1);
    expect(getExcludeCount(8)).toBe(2);
    expect(getExcludeCount(16)).toBe(3);
  });

  it('honours a custom threshold list', () => {
    const profile = JSON.stringify({ thresholds: [5, 10] });
    expect(getExcludeCount(4, profile)).toBe(0);
    expect(getExcludeCount(5, profile)).toBe(1);
    expect(getExcludeCount(9, profile)).toBe(1);
    expect(getExcludeCount(10, profile)).toBe(2);
  });

  // Renderer-side analog of discardConfig.ts's documented m6 finding
  // (src/__tests__/discardConfig.test.ts): an explicit empty thresholds list
  // ({thresholds: []}) is meant to read as "never discard" but
  // parseDiscardThresholdsFromProfile (leaderboardUtils.ts) returns [] (not
  // null), and getExcludeCount only honours thresholds when length > 0, so it
  // silently falls through to the standard 4/8/8 profile instead. Same
  // misreading, same needs-a-product-decision status — pinned here so the
  // renderer preview and the persisted discardConfig.ts logic don't silently
  // diverge if only one side gets fixed.
  it('CURRENT (surfaces m6-analog): an empty custom thresholds list silently reverts to standard 4/8/8 instead of never discarding', () => {
    const emptyProfile = JSON.stringify({ thresholds: [] });
    expect(getExcludeCount(4, emptyProfile)).toBe(1); // standard fallback, not 0
    expect(getExcludeCount(8, emptyProfile)).toBe(2); // standard fallback, not 0
  });
});

describe('processLeaderboardEntry race_points handling', () => {
  it('uses race_points for exclusion logic while preserving displayed race_positions', () => {
    const entry = {
      boat_id: 1,
      total_points_event: 7,
      race_positions: '3,2,1,4',
      race_points: '5,2,1,4',
      race_ids: '1,2,3,4',
      race_statuses: 'ZFP,FINISHED,FINISHED,FINISHED',
    };

    const processed = processLeaderboardEntry(entry);
    expect(processed.races).toEqual(['(3)', '2', '1', '4']);
    expect(processed.race_points).toEqual(['5', '2', '1', '4']);
  });
});
