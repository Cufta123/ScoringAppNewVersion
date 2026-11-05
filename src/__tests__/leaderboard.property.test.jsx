/** @jest-environment jsdom */
/**
 * The renderer's discard marking (rows without the library's excluded
 * flags, and the instant edit draft) keeps its invariants. Who wins a tie
 * is regatta-core's (packages/regatta-core/test).
 */
import {
  applyExclusions,
  getExcludeCount,
} from '../renderer/utils/leaderboardUtils';

function makePrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randInt(prng, min, max) {
  return Math.floor(prng() * (max - min + 1)) + min;
}

describe('Property-based: leaderboard exclusions invariants', () => {
  it('keeps exclusion and total invariants across random race/status combinations', () => {
    const prng = makePrng(20260410);
    const nonExcludable = new Set(['DNE', 'DGM']);
    const statusesPool = [
      'FINISHED',
      'DNF',
      'DNS',
      'DSQ',
      'ZFP',
      'SCP',
      'DNE',
      'DGM',
    ];

    for (let trial = 0; trial < 250; trial += 1) {
      const races = randInt(prng, 1, 20);
      const raw = [];
      const scoreValues = [];
      const statuses = [];

      for (let i = 0; i < races; i += 1) {
        const score = randInt(prng, 1, 60);
        raw.push(String(score));
        scoreValues.push(String(score));
        statuses.push(statusesPool[randInt(prng, 0, statusesPool.length - 1)]);
      }

      const { markedRaces, total } = applyExclusions(
        raw,
        statuses,
        scoreValues,
      );
      const excludeCount = getExcludeCount(races);
      const excludedIdx = markedRaces
        .map((v, idx) => (String(v).startsWith('(') ? idx : -1))
        .filter((idx) => idx !== -1);

      const excludableCount = statuses.filter(
        (s) => !nonExcludable.has(String(s).toUpperCase()),
      ).length;
      const expectedExcludedCount = Math.min(excludeCount, excludableCount);

      expect(markedRaces).toHaveLength(races);
      expect(excludedIdx).toHaveLength(expectedExcludedCount);

      excludedIdx.forEach((idx) => {
        expect(nonExcludable.has(String(statuses[idx]).toUpperCase())).toBe(
          false,
        );
      });

      const expectedTotal = scoreValues.reduce((sum, value, idx) => {
        if (excludedIdx.includes(idx)) return sum;
        return sum + parseFloat(value);
      }, 0);

      expect(total).toBe(expectedTotal);
    }
  });
});
