import {
  getOtherTiedCount,
  getNextCompareSelection,
} from '../renderer/utils/compareUtils';

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
