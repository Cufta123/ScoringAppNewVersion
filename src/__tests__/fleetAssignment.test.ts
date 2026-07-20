/* eslint-disable camelcase */
/**
 * Unit tests for src/shared/fleetAssignment.ts — the SHRS 4.1/4.2/4.3 fleet
 * assignment totals shared by the main process and the renderer. Focused on
 * the SHRS 4.3 temporary second-worst discard and the series-wide race count
 * used for SHRS 5.4 / 4.3.
 */
import {
  computeAdjustedFleetTotals,
  shouldApplyShrs43TemporarySecondDiscard,
} from '../shared/fleetAssignment';

// Standard SHRS 5.4 profile: 0 below 4, 1 at 4-7, 2 at 8-15, +1 per 8.
const standardExclude = (n: number): number => {
  if (n < 4) return 0;
  if (n < 8) return 1;
  return 2 + Math.floor((n - 8) / 8);
};

// No-discard profile: never drops a normal 5.4 score.
const noDiscard = (): number => 0;

const boat = (boat_id: number, points: number[]) => ({
  boat_id,
  race_points: points.join(','),
  race_statuses: null,
});

describe('shouldApplyShrs43TemporarySecondDiscard (SHRS 4.3 window)', () => {
  it('applies only for 6 or 7 completed races', () => {
    expect(shouldApplyShrs43TemporarySecondDiscard(5)).toBe(false);
    expect(shouldApplyShrs43TemporarySecondDiscard(6)).toBe(true);
    expect(shouldApplyShrs43TemporarySecondDiscard(7)).toBe(true);
    expect(shouldApplyShrs43TemporarySecondDiscard(8)).toBe(false);
  });
});

describe('computeAdjustedFleetTotals — SHRS 4.3 second-worst discard', () => {
  it('standard profile at 7 races drops the two worst (worst + second-worst)', () => {
    // Scores 10,8,1,1,1,1,1. Standard 5.4 drops worst (10); 4.3 adds
    // second-worst (8). Kept: 1+1+1+1+1 = 5.
    const [result] = computeAdjustedFleetTotals(
      [boat(1, [10, 8, 1, 1, 1, 1, 1])],
      { getExcludeCount: standardExclude },
    );
    expect(result.totalPoints).toBe(5);
  });

  it('no-discard profile at 7 races excludes the SECOND-worst only, keeping the worst', () => {
    // Scores 10,8,1,1,1,1,1. 5.4 drops nothing; 4.3 excludes the second-worst
    // (8) but NOT the worst (10). Kept: 10+1+1+1+1+1 = 15.
    // A "+1 to the discard count" implementation would wrongly drop the worst
    // (10) and give 8+1+1+1+1+1 = 13.
    const [result] = computeAdjustedFleetTotals(
      [boat(1, [10, 8, 1, 1, 1, 1, 1])],
      { getExcludeCount: noDiscard },
    );
    expect(result.totalPoints).toBe(15);
  });

  it('does not apply the 4.3 discard outside the 6-7 race window', () => {
    // 5 races, no-discard profile: nothing excluded. Sum = 10+8+1+1+1 = 21.
    const [result] = computeAdjustedFleetTotals([boat(1, [10, 8, 1, 1, 1])], {
      getExcludeCount: noDiscard,
    });
    expect(result.totalPoints).toBe(21);
  });
});

describe('computeAdjustedFleetTotals — series-wide race count (SHRS 5.4/4.3)', () => {
  it('uses the fleet-wide race count so a boat that missed a race is ranked the same way', () => {
    // Series has 7 completed races (boat 1 sailed all 7); boat 2 sailed 6.
    // Both must be scored under the 7-race rule: standard 5.4 drops 1, and 4.3
    // (6-7 race window) drops the second-worst too.
    const totals = computeAdjustedFleetTotals(
      [
        boat(1, [10, 8, 1, 1, 1, 1, 1]), // 7 races -> drop 10 and 8 -> 5
        boat(2, [10, 8, 1, 1, 1, 1]), // 6 races, but ranked at series count 7
      ],
      { getExcludeCount: standardExclude },
    );
    const byBoat = Object.fromEntries(
      totals.map((t) => [t.boat_id, t.totalPoints]),
    );
    expect(byBoat[1]).toBe(5); // 1+1+1+1+1
    expect(byBoat[2]).toBe(4); // drop 10 and 8 -> 1+1+1+1
  });

  it('pulls a boat INTO the 4.3 window via the series count even though its own race count is outside the window (M4)', () => {
    // Boat 1 sailed 6 races (series-wide count). Boat 2 only sailed 5 of its
    // own races (missed one) — in isolation, shouldApplyShrs43TemporarySecondDiscard(5)
    // is false, so a per-boat implementation would NOT apply 4.3 to boat 2 at
    // all. The series-wide count is 6, which IS in the (5,8) window, so boat 2
    // must also get its second-worst score excluded.
    const noDiscardTotals = computeAdjustedFleetTotals(
      [
        boat(1, [10, 8, 1, 1, 1, 1]), // 6 races
        boat(2, [10, 8, 1, 1, 1]), // 5 races of its own, ranked at series count 6
      ],
      { getExcludeCount: noDiscard },
    );
    const byBoat = Object.fromEntries(
      noDiscardTotals.map((t) => [t.boat_id, t.totalPoints]),
    );
    // no-discard profile: nothing dropped by 5.4; only 4.3 second-worst (8) is
    // excluded for boat 2. A buggy per-boat-count implementation would keep
    // all of boat 2's scores (10+8+1+1+1 = 21) since 5 races is outside its
    // own window.
    expect(byBoat[2]).toBe(13); // 10+1+1+1 (8 excluded as second-worst)
    // Boat 1 (6 races, own count matches series count): no-discard profile
    // drops nothing via 5.4; 4.3 excludes only its second-worst (8).
    expect(byBoat[1]).toBe(14); // 10+1+1+1+1 (8 excluded)
  });
});

describe('computeAdjustedFleetTotals — boundary race counts for the 4.3 window (5/6/7/8)', () => {
  const points7 = [10, 8, 1, 1, 1, 1, 1];

  it('5 races: window closed, standard 5.4 drops only the worst score', () => {
    const [result] = computeAdjustedFleetTotals([boat(1, [10, 8, 1, 1, 1])], {
      getExcludeCount: standardExclude,
    });
    // 5 races -> standard exclude count 1 (worst = 10 dropped). No 4.3.
    expect(result.totalPoints).toBe(8 + 1 + 1 + 1);
  });

  it('6 races: window open, standard 5.4 drops the worst AND 4.3 drops the second-worst', () => {
    const [result] = computeAdjustedFleetTotals(
      [boat(1, [10, 8, 1, 1, 1, 1])],
      { getExcludeCount: standardExclude },
    );
    // 5.4 drops 10; 4.3 additionally drops 8. Kept: 1+1+1+1 = 4.
    expect(result.totalPoints).toBe(4);
  });

  it('7 races: window open (upper edge), same two-score exclusion as 6 races', () => {
    const [result] = computeAdjustedFleetTotals([boat(1, points7)], {
      getExcludeCount: standardExclude,
    });
    expect(result.totalPoints).toBe(5); // 1+1+1+1+1
  });

  it('8 races: window closed again, standard 5.4 alone drops the two worst (no extra 4.3 discard)', () => {
    const [result] = computeAdjustedFleetTotals(
      [boat(1, [10, 9, 8, 1, 1, 1, 1, 1])],
      { getExcludeCount: standardExclude },
    );
    // Standard exclude count at 8 races = 2 (drops 10 and 9). 4.3 does NOT
    // apply at 8 races, so 8 is kept.
    expect(result.totalPoints).toBe(8 + 1 + 1 + 1 + 1 + 1);
  });
});

describe('computeAdjustedFleetTotals — DNE/DGM are never excluded (RRS 90.3(b))', () => {
  it('skips a non-excludable DNE score even when it is numerically the worst, and finds the next-worst for both 5.4 and 4.3', () => {
    // 6 races, in the 4.3 window. Race 0 is DNE with the highest points (20) —
    // it can NEVER be dropped, so both the 5.4 worst-drop and the 4.3
    // second-worst-drop must fall on the next worst EXCLUDABLE scores (10, 8).
    const entry = {
      boat_id: 1,
      race_points: '20,10,8,1,1,1',
      race_statuses: 'DNE,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
    };
    const [result] = computeAdjustedFleetTotals([entry], {
      getExcludeCount: standardExclude,
    });
    // Kept: 20 (DNE, non-excludable) + 1+1+1 = 23. (10 and 8 excluded.)
    expect(result.totalPoints).toBe(23);
  });

  it('does not double-exclude or crash when only one excludable score exists in the 4.3 window', () => {
    // 6 races, 5 of them DNE (non-excludable), only 1 excludable score.
    // excludableCandidates.length === 1, so the 4.3 "second worst" guard
    // (candidates.length >= 2) must skip adding anything further.
    const entry = {
      boat_id: 1,
      race_points: '20,20,20,20,20,5',
      race_statuses: 'DNE,DNE,DNE,DNE,DNE,FINISHED',
    };
    const [result] = computeAdjustedFleetTotals([entry], {
      getExcludeCount: standardExclude,
    });
    // 5.4 drops the only excludable score (5). 4.3 has nothing left to add.
    expect(result.totalPoints).toBe(20 * 5);
  });
});

describe('computeAdjustedFleetTotals — boat with no qualifying scores yet (4.1 shrinking / withdrawal edge)', () => {
  it('scores a boat with null race_points as 0 without affecting other boats, and still uses the series race count', () => {
    // A boat that entered but has not sailed any qualifying race yet (e.g. a
    // late/never-scored entry ahead of a withdrawal decision) has no
    // race_points/race_statuses rows at all. It must not crash the totals
    // computation and must not itself set the series race count.
    const totals = computeAdjustedFleetTotals(
      [
        { boat_id: 1, race_points: null, race_statuses: null },
        boat(2, [10, 8, 1, 1, 1, 1, 1]), // 7 races -> drives seriesRaceCount
      ],
      { getExcludeCount: standardExclude },
    );
    const byBoat = Object.fromEntries(
      totals.map((t) => [t.boat_id, t.totalPoints]),
    );
    expect(byBoat[1]).toBe(0);
    expect(byBoat[2]).toBe(5); // unaffected: 7-race window still applies
  });
});

describe('computeAdjustedFleetTotals — applyShs43TemporarySecondDiscard opt-out', () => {
  it('does not apply the second-worst exclusion inside the 6-7 window when explicitly disabled', () => {
    const [result] = computeAdjustedFleetTotals(
      [boat(1, [10, 8, 1, 1, 1, 1, 1])],
      {
        getExcludeCount: standardExclude,
        applyShs43TemporarySecondDiscard: false,
      },
    );
    // Only the standard 5.4 exclusion (worst = 10) applies; 4.3 is suppressed.
    expect(result.totalPoints).toBe(8 + 1 + 1 + 1 + 1 + 1);
  });
});
