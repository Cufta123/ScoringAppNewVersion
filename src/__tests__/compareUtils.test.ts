import {
  getOtherTiedCount,
  getNextCompareSelection,
} from '../renderer/utils/compareUtils';
import {
  compareScoreArrays,
  getExcludedIndexes,
  getKeptScores,
  resolveTiesSequentially,
} from '../main/functions/scoringUtils';

describe('getOtherTiedCount', () => {
  it('does not count boats from different final fleets when totals match', () => {
    const allEntries = [
      { boat_id: 21, placement_group: 'Silver', total_points_combined: 12 },
      { boat_id: 32, placement_group: 'Silver', total_points_combined: 12 },
      { boat_id: 20, placement_group: 'Bronze', total_points_combined: 12 },
      { boat_id: 33, placement_group: 'Silver', total_points_combined: 9 },
    ];

    const count = getOtherTiedCount({
      allEntries,
      boatA: allEntries[0],
      boatB: allEntries[1],
      totalA: 12,
      totalB: 12,
      finalSeriesStarted: true,
      getTotal: (entry: { total_points_combined: number }) =>
        entry.total_points_combined,
    });

    expect(count).toBe(0);
  });
});

describe('getNextCompareSelection', () => {
  it('resets to clicked boat when user clicks a different final fleet', () => {
    const allEntries = [
      { boat_id: 25, placement_group: 'Gold' },
      { boat_id: 31, placement_group: 'Gold' },
      { boat_id: 33, placement_group: 'Silver' },
    ];

    const next = getNextCompareSelection({
      previousSelectedBoatIds: [25],
      clickedBoatId: 33,
      compareMode: true,
      finalSeriesStarted: true,
      allEntries,
    });

    expect(next).toEqual([33]);
  });
});

// Direct unit tests for the RRS A8.1/A8.2/SHRS 5.4 primitives in
// src/main/functions/scoringUtils.ts, shared by qualifying, final and
// overall tie-break comparisons.
describe('compareScoreArrays (RRS A8.1/A8.2 lexicographic compare)', () => {
  it('returns 0 for identical arrays (still tied)', () => {
    expect(compareScoreArrays([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('returns the sign of the first differing position', () => {
    expect(compareScoreArrays([1, 2, 4], [1, 2, 3])).toBeGreaterThan(0);
    expect(compareScoreArrays([1, 2, 3], [1, 2, 4])).toBeLessThan(0);
  });

  it('a difference at an earlier index wins even if a later index favours the other side', () => {
    // A is worse at position 1 (2 vs 1) but much better at position 2 (1 vs 9).
    // A8.1 must still resolve on the FIRST difference, so A loses overall.
    expect(compareScoreArrays([2, 1], [1, 9])).toBeGreaterThan(0);
  });

  it('treats a missing (shorter-array) entry as the worst possible score', () => {
    // B has no third entry -> compared as Number.MAX_SAFE_INTEGER, so A
    // (which has a real third score) wins even though A has fewer low scores.
    expect(compareScoreArrays([1, 2, 9], [1, 2])).toBeLessThan(0);
    expect(compareScoreArrays([1, 2], [1, 2, 9])).toBeGreaterThan(0);
  });
});

describe('getExcludedIndexes / getKeptScores (SHRS 5.4 discards)', () => {
  it('excludeCount <= 0 excludes nothing and preserves original order', () => {
    const entries = [{ points: 9 }, { points: 1 }, { points: 5 }];
    expect(getExcludedIndexes(entries, 0)).toEqual(new Set());
    expect(getKeptScores(entries, 0)).toEqual([9, 1, 5]);
  });

  it('excludes the single worst (highest-points) excludable score', () => {
    const entries = [
      { points: 3, race_number: 1 },
      { points: 9, race_number: 2 },
      { points: 5, race_number: 3 },
    ];
    expect(getExcludedIndexes(entries, 1)).toEqual(new Set([1]));
    expect(getKeptScores(entries, 1)).toEqual([3, 5]);
  });

  it('breaks a worst-score tie by earliest race_number, then earliest race_id', () => {
    // Two entries share the worst points (9); the earlier race (race_number 1)
    // is excluded, not the later one.
    const entries = [
      { points: 9, race_number: 1, race_id: 100 },
      { points: 2, race_number: 2, race_id: 101 },
      { points: 9, race_number: 3, race_id: 102 },
    ];
    expect(getExcludedIndexes(entries, 1)).toEqual(new Set([0]));

    // When race_number also ties, fall back to earliest race_id.
    const entriesSameRace = [
      { points: 9, race_number: 1, race_id: 200 },
      { points: 9, race_number: 1, race_id: 199 },
      { points: 2, race_number: 2, race_id: 201 },
    ];
    expect(getExcludedIndexes(entriesSameRace, 1)).toEqual(new Set([1]));
  });

  it('never excludes DNE/DGM even when they are the worst score (RRS 90.3(b))', () => {
    const entries = [
      { points: 20, status: 'DGM', race_number: 1 },
      { points: 9, status: 'FINISHED', race_number: 2 },
      { points: 5, status: 'FINISHED', race_number: 3 },
    ];
    // Worst-by-points is the DGM row (20), but it must be protected; the
    // next-worst excludable row (9) is dropped instead.
    expect(getExcludedIndexes(entries, 1)).toEqual(new Set([1]));
    expect(getKeptScores(entries, 1)).toEqual([20, 5]);
  });

  it('status match is case-insensitive for the non-excludable set', () => {
    const entries = [
      { points: 20, status: 'dne', race_number: 1 },
      { points: 9, status: 'FINISHED', race_number: 2 },
    ];
    expect(getExcludedIndexes(entries, 1)).toEqual(new Set([1]));
  });

  it('caps at the number of excludable entries when excludeCount exceeds them (all-protected series)', () => {
    const entries = [
      { points: 20, status: 'DNE', race_number: 1 },
      { points: 20, status: 'DGM', race_number: 2 },
    ];
    // Both rows are protected; excludeCount of 2 finds nothing eligible.
    expect(getExcludedIndexes(entries, 2)).toEqual(new Set());
    expect(getKeptScores(entries, 2)).toEqual([20, 20]);
  });

  it('excludes multiple worst scores in points order when excludeCount > 1', () => {
    const entries = [
      { points: 4, race_number: 1 },
      { points: 9, race_number: 2 },
      { points: 7, race_number: 3 },
      { points: 1, race_number: 4 },
    ];
    // Worst two by points: 9 (idx1), then 7 (idx2).
    expect(getExcludedIndexes(entries, 2)).toEqual(new Set([1, 2]));
    expect(getKeptScores(entries, 2)).toEqual([4, 1]);
  });
});

describe('resolveTiesSequentially (SHRS 5.7(ii)(3): resolve higher place before lower)', () => {
  it('sorts using the comparator', () => {
    const items = [
      { id: 'C', v: 3 },
      { id: 'A', v: 1 },
      { id: 'B', v: 2 },
    ];
    const resolved = resolveTiesSequentially(items, (a, b) => a.v - b.v);
    expect(resolved.map((i) => i.id)).toEqual(['A', 'B', 'C']);
  });

  it('preserves original relative order among boats that remain fully tied (comparator returns 0)', () => {
    // When the comparator can never separate two items (always 0), the
    // sequential extraction should not invent an order between them —
    // each pass re-sorts with a stable sort, so original order survives.
    const items = [{ id: 'Z' }, { id: 'A' }, { id: 'M' }];
    const resolved = resolveTiesSequentially(items, () => 0);
    expect(resolved.map((i) => i.id)).toEqual(['Z', 'A', 'M']);
  });

  it('re-evaluates the remaining boats fresh after extracting the top place (non-transitive comparator)', () => {
    // A pairwise-only comparator that depends solely on (left,right) identity,
    // not on prior extractions — models SHRS 5.7(ii)(3)'s "resolve the
    // higher-placed tie, then re-apply the tie-break on what's left".
    // A beats both B and C directly; among the remainder, C beats B.
    const order: Record<string, number> = { A: 0, C: 1, B: 2 };
    const cmp = (a: { id: string }, b: { id: string }) =>
      order[a.id] - order[b.id];
    const items = [{ id: 'B' }, { id: 'C' }, { id: 'A' }];
    const resolved = resolveTiesSequentially(items, cmp);
    expect(resolved.map((i) => i.id)).toEqual(['A', 'C', 'B']);
  });
});
