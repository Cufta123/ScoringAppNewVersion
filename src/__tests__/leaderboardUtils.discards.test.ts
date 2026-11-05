/**
 * The renderer's discard helpers (SHRS 5.4), kept from SHRS_comprehensive
 * when the old scoring engine was removed. They only give the leaderboard's
 * instant edit draft and rows without the library's excluded flags; the
 * standings themselves are regatta-core's (packages/regatta-core/test).
 */
import {
  getExcludeCount,
  applyExclusions,
  parseRaceNum,
} from '../renderer/utils/leaderboardUtils';

describe('SHRS 5.4 – Discard thresholds (getExcludeCount)', () => {
  // Exhaustive boundary-value analysis
  const cases: [number, number][] = [
    // [numberOfRaces, expectedExclusions]
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [5, 1],
    [6, 1],
    [7, 1],
    [8, 2],
    [9, 2],
    [10, 2],
    [15, 2],
    [16, 3],
    [17, 3],
    [23, 3],
    [24, 4],
    [25, 4],
    [31, 4],
    [32, 5],
    [33, 5],
    [39, 5],
    [40, 6],
    [41, 6],
    [47, 6],
    [48, 7],
    [56, 8],
    [64, 9],
    [72, 10],
    [80, 11],
  ];

  it.each(cases)('%i races → %i exclusions', (numRaces, expectedExclusions) => {
    expect(getExcludeCount(numRaces)).toBe(expectedExclusions);
  });
});

describe('applyExclusions – renderer utility', () => {
  it('marks worst scores with parentheses', () => {
    // 4 races → 1 exclusion. Scores: [1, 2, 3, 10]
    const { markedRaces, total } = applyExclusions(['1', '2', '3', '10']);
    expect(total).toBe(6); // 1+2+3
    expect(markedRaces).toContain('(10)');
    expect(markedRaces.filter((r: string) => r.startsWith('('))).toHaveLength(
      1,
    );
  });

  it('excludes 2 worst with 8 races', () => {
    const scores = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const { markedRaces, total } = applyExclusions(scores);
    // Exclude worst 2: 8 and 7
    expect(total).toBe(1 + 2 + 3 + 4 + 5 + 6); // 21
    const excluded = markedRaces.filter((r: string) => r.startsWith('('));
    expect(excluded).toHaveLength(2);
  });

  it('no exclusions with < 4 races', () => {
    const { markedRaces, total } = applyExclusions(['5', '3', '2']);
    expect(total).toBe(10);
    expect(markedRaces.every((r: string) => !r.startsWith('('))).toBe(true);
  });

  it('handles penalty score strings correctly', () => {
    // 4 races: [1, 2, 3, 15] where 15 is a DNF penalty
    const { markedRaces, total } = applyExclusions(['1', '2', '3', '15']);
    expect(total).toBe(6); // exclude 15
    expect(markedRaces[3]).toBe('(15)');
  });

  it('excludes earliest race when multiple identical worst scores', () => {
    // 4 races: [10, 5, 3, 10] → exclude 1 worst (10).
    // Per A2.1, if equal worst scores the one from earliest race is excluded.
    const { markedRaces, total } = applyExclusions(['10', '5', '3', '10']);
    // One 10 should be marked; total = 10+5+3 = 18
    expect(total).toBe(18);
    const excludedCount = markedRaces.filter((r: string) =>
      r.startsWith('('),
    ).length;
    expect(excludedCount).toBe(1);
  });
});

describe('parseRaceNum utility', () => {
  it('strips parentheses and returns number', () => {
    expect(parseRaceNum('(10)')).toBe(10);
    expect(parseRaceNum('5')).toBe(5);
    expect(parseRaceNum('3.4')).toBeCloseTo(3.4);
  });

  it('returns 0 for non-numeric values', () => {
    expect(parseRaceNum('DNF')).toBe(0);
    expect(parseRaceNum('')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: COMPLEX REAL-WORLD SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════
