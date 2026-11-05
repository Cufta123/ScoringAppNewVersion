/**
 * Ported from the app's src/__tests__/finalFleetPlan.test.ts (the SHRS 4.1 /
 * 4.2 / 2.3 split of src/main/functions/finalFleetPlan.ts). Already in the
 * library suite: 11 boats in 3 fleets, 45 boats over 2 heats (adds fleets,
 * or 23/22 when oversize is allowed) and a withdrawn boat going last
 * (rules.test.ts), best boats to Gold (event.test.ts), equal totals in boat
 * order (R6, decided-rules.test.ts), one heat has no Final Series
 * (event.test.ts).
 */
import type { Decision, EventState, Settings } from '../../src';
import { boats, refusal, sheet, stateOf } from './helpers';

/** n boats, `heats` heats by SHRS 3, one race: each heat in seeded order. */
function oneRace(
  n: number,
  heats: number,
  settings: Partial<Settings> = {},
): Decision[] {
  const start: Decision[] = [
    { type: 'settingsChanged', settings },
    ...boats(n),
    { type: 'heatsCreated', heatCount: heats },
  ];
  const round = stateOf(start).rounds[0];
  return [...start, ...round.map((heat) => sheet(heat.id, 1, ...heat.boats))];
}

const fleetSizes = (state: EventState) =>
  state.fleets!.map((fleet) => fleet.boats.length);

describe('SHRS 4.1: fleets as equal as possible, the earlier ones larger', () => {
  it.each([
    [7, 2, [4, 3]],
    [8, 3, [3, 3, 2]],
    [9, 4, [3, 2, 2, 2]],
    [13, 5, [3, 3, 3, 2, 2]],
  ])('SHRS 4.1: %i boats from %i heats are fleets of %j', (n, heats, sizes) => {
    const state = stateOf([
      ...oneRace(n, heats),
      { type: 'finalSeriesStarted' },
    ]);
    expect(fleetSizes(state)).toEqual(sizes);
  });
});

describe('SHRS 4.2: withdrawn boats', () => {
  it('SHRS 4.2: withdrawn boats go after every other boat, each group in ranking order', () => {
    // A1 = b1, b4; B1 = b2, b3 (DNF = 3). b1 wins race 1 and withdraws in
    // race 2; b3 withdraws in race 1. Round 2 (Heat Movement Table):
    // A2 = b1, b3; B2 = b2, b4.
    const state = stateOf([
      ...boats(4),
      { type: 'heatsCreated', heatCount: 2 },
      sheet('A1', 1, 'b1', 'b4'),
      sheet('B1', 1, 'b2', 'b3:WTH'),
      { type: 'roundCreated' },
      sheet('A2', 1, 'b1:WTH', 'b3:WTH'),
      sheet('B2', 1, 'b4', 'b2'),
      { type: 'finalSeriesStarted' },
    ]);
    // b4 3, b2 3 (b4 beat b2 when they met, 5.7(ii)(1)); withdrawn b1 4,
    // b3 6.
    expect(state.fleets!.map((f) => f.boats)).toEqual([
      ['b4', 'b2'],
      ['b1', 'b3'],
    ]);
  });

  it('SHRS 4.1 / 4.2: when every boat has withdrawn they still get fleets', () => {
    // A1 = b1, b4, b5; B1 = b2, b3.
    const state = stateOf([
      ...boats(5),
      { type: 'heatsCreated', heatCount: 2 },
      sheet('A1', 1, 'b1:WTH', 'b4:WTH', 'b5:WTH'),
      sheet('B1', 1, 'b2:WTH', 'b3:WTH'),
      { type: 'finalSeriesStarted' },
    ]);
    expect(fleetSizes(state)).toEqual([3, 2]);
  });
});

describe('SHRS 4.1: the number of fleets', () => {
  it('SHRS 4.1: fewer fleets than heats when only 2 boats are left in 4 heats', () => {
    const state = stateOf([
      ...boats(4),
      { type: 'heatsCreated', heatCount: 4 }, // A1 b1, B1 b2, C1 b3, D1 b4
      { type: 'boatRemoved', boat: 'b3' },
      { type: 'boatRemoved', boat: 'b4' },
      sheet('A1', 1, 'b1'),
      sheet('B1', 1, 'b2'),
      { type: 'finalSeriesStarted' },
    ]);
    expect(state.fleets!.map((f) => f.boats)).toEqual([['b1'], ['b2']]);
  });

  it('SHRS 4.1: never more fleets than boats (1 boat left in 5 heats)', () => {
    const state = stateOf([
      ...boats(5),
      { type: 'heatsCreated', heatCount: 5 },
      ...['b2', 'b3', 'b4', 'b5'].map(
        (boat): Decision => ({ type: 'boatRemoved', boat }),
      ),
      sheet('A1', 1, 'b1'),
      { type: 'finalSeriesStarted' },
    ]);
    expect(state.fleets!.map((f) => f.boats)).toEqual([['b1']]);
  });
});

describe('SHRS 2.3: at most 20 boats a fleet', () => {
  it('SHRS 2.3: exactly 20 a fleet is not oversize (40 boats, 2 heats)', () => {
    const state = stateOf([...oneRace(40, 2), { type: 'finalSeriesStarted' }]);
    expect(fleetSizes(state)).toEqual([20, 20]);
  });
});

it('SHRS 4.2: no split before any qualifying race is sailed', () => {
  expect(
    refusal([
      ...boats(4),
      { type: 'heatsCreated', heatCount: 2 },
      { type: 'finalSeriesStarted' },
    ]),
  ).toMatch(/same races first/);
});
