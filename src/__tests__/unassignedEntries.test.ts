import {
  findUnassignedEntries,
  suggestHeat,
} from '../renderer/utils/unassignedEntries';

const heat = (
  heat_id: number,
  heat_name: string,
  boatIds: number[],
  raceNumber = 0,
  heat_type = 'Qualifying',
) => ({
  heat_id,
  heat_name,
  heat_type,
  raceNumber,
  boats: boatIds.map((boat_id) => ({ boat_id })),
});

const entries = [1, 2, 3, 4, 5].map((boat_id) => ({ boat_id }));

describe('entered boats missing from the current round', () => {
  it('finds a boat in no heat of the current round', () => {
    const result = findUnassignedEntries(
      entries,
      [
        heat(1, 'Heat A1', [1, 2], 1),
        heat(2, 'Heat B1', [3, 4], 1),
        heat(3, 'Heat A2', [1, 3]),
        heat(4, 'Heat B2', [2, 4]),
      ],
      false,
    );
    expect(result.unassigned).toEqual([{ boat_id: 5 }]);
    // Only round 2 counts, and both of its heats are still open.
    expect(result.openHeats.map((h) => h.heat_name)).toEqual([
      'Heat A2',
      'Heat B2',
    ]);
  });

  it('only offers heats that have not raced', () => {
    const result = findUnassignedEntries(
      entries,
      [heat(1, 'Heat A1', [1, 2], 1), heat(2, 'Heat B1', [3, 4], 0)],
      false,
    );
    expect(result.openHeats.map((h) => h.heat_name)).toEqual(['Heat B1']);
  });

  it('is silent once the Final Series has started (fleets are fixed)', () => {
    expect(
      findUnassignedEntries(entries, [heat(1, 'Heat A1', [1, 2], 1)], true)
        .unassigned,
    ).toEqual([]);
  });

  it('suggests the smallest open heat (SHRS 2.2)', () => {
    expect(
      suggestHeat([heat(1, 'Heat A2', [1, 2, 3]), heat(2, 'Heat B2', [4, 5])]),
    ).toBe(2);
    expect(suggestHeat([])).toBeNull();
  });
});
