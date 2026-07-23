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

  // MEGA M-NEW-1 / SHRS 5.4: the discard count is series-wide. A boat that sailed
  // 5 races in an 8-race series must get 2 discards (getExcludeCount(8)), not 1
  // (getExcludeCount(5)).
  it('uses the series-wide race count for the discard threshold, not the boat count', () => {
    const raw = ['5', '4', '3', '2', '1'];
    const statuses = raw.map(() => 'FINISHED');

    // Per-boat (legacy): 5 races -> 1 discard -> drop the 5 -> total 10.
    const perBoat = applyExclusions(raw, statuses, raw);
    expect(perBoat.total).toBe(10);
    expect(perBoat.markedRaces).toEqual(['(5)', '4', '3', '2', '1']);

    // Series-wide 8 races -> 2 discards -> drop 5 and 4 -> total 6.
    const seriesWide = applyExclusions(raw, statuses, raw, 'standard', 8);
    expect(seriesWide.total).toBe(6);
    expect(seriesWide.markedRaces).toEqual(['(5)', '(4)', '3', '2', '1']);
  });

  // LB-11 (renderer side): a boat with fewer races than the series-wide discard
  // count must keep at least one score — never discard them all.
  it('caps discards so a single-race boat in an 8-race series keeps its score', () => {
    const raw = ['3'];
    const statuses = ['FINISHED'];

    // seriesRaceCount 8 -> getExcludeCount = 2, but only 1 race exists; the cap
    // (n-1 = 0) keeps it, so the score is NOT zeroed.
    const { markedRaces, total } = applyExclusions(
      raw,
      statuses,
      raw,
      'standard',
      8,
    );
    expect(total).toBe(3);
    expect(markedRaces).toEqual(['3']);
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

  // LB-9: computed_total comes from the locally computed net total (consistent
  // with the parenthesised markings and the current discard profile), NOT the
  // possibly-stale DB-stored total_points_event.
  it('computes computed_total locally instead of trusting a stale DB total', () => {
    const entry = {
      boat_id: 7,
      // Deliberately stale/wrong stored total.
      total_points_event: 999,
      race_positions: '5,4,3,2,1',
      race_points: '5,4,3,2,1',
      race_ids: '1,2,3,4,5',
      race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
    };

    // 5-race series -> 1 discard -> drop the 5 -> net total 10 (not 999).
    const processed = processLeaderboardEntry(entry, 'standard', 5);
    expect(processed.computed_total).toBe(10);
    expect(processed.races).toEqual(['(5)', '4', '3', '2', '1']);
  });
});
