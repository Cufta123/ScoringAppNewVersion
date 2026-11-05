import {
  getOtherTiedCount,
  getNextCompareSelection,
} from '../renderer/utils/compareUtils';
import { getExcludedIndexes, getKeptScores } from '../shared/scoring/discards';

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
