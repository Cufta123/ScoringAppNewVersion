import { buildRaceOperations } from '../renderer/utils/leaderboardSave';
import type { UserRaceEdit } from '../renderer/utils/leaderboardEdit';
import type { LeaderboardEntry } from '../renderer/types';

// SHRS 3.1.5: the save payload says which cells the user typed in, so the main
// process can tell a protest decision / race-office correction from a boat that
// only moved because of it.

const entry = (
  boat_id: number,
  place: number,
  status = 'FINISHED',
): LeaderboardEntry => ({
  boat_id,
  races: [String(place)],
  race_points: [String(place)],
  race_ids: ['7'],
  race_statuses: [status],
  computed_total: place,
});

const original = [entry(1, 1), entry(2, 2), entry(3, 3)];
// The user gave boat 1 a DSQ; boats 2 and 3 moved up (RRS A6.1).
const edited = [entry(1, 4, 'DSQ'), entry(2, 1), entry(3, 2)];
const typed = new Map<string, UserRaceEdit>([
  ['1-0', { boatId: 1, raceIndex: 0, rawPosition: 4, status: 'DSQ' }],
]);

describe('buildRaceOperations: `edited` flags', () => {
  it('flags only the cell the user typed, not the boats that moved', () => {
    const [operation] = buildRaceOperations(edited, original, typed);
    expect(operation.raceId).toBe('7');
    expect(
      Object.fromEntries(operation.cells.map((c) => [c.boatId, c.edited])),
    ).toEqual({ 1: true, 2: false, 3: false });
  });

  it('sends the whole race, promoted boats included', () => {
    const [operation] = buildRaceOperations(edited, original, typed);
    expect(
      operation.cells.map((c) => [c.boatId, c.position, c.status]),
    ).toEqual([
      [1, 4, 'DSQ'],
      [2, 1, 'FINISHED'],
      [3, 2, 'FINISHED'],
    ]);
  });

  it('flags every cell the user typed in the same race', () => {
    const both = new Map(typed).set('3-0', {
      boatId: 3,
      raceIndex: 0,
      rawPosition: 2,
      status: 'FINISHED',
    });
    const [operation] = buildRaceOperations(edited, original, both);
    expect(
      operation.cells.filter((c) => c.edited).map((c) => c.boatId),
    ).toEqual([1, 3]);
  });
});
