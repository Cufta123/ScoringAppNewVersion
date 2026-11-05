/**
 * Ported from the app's src/__tests__/nextRoundPlan.test.ts (planNextRound,
 * deleted with the old engine): building the next qualifying round.
 */
import { type Decision } from '../../src';
import { enter, heatBoats, refusal, sheet, stateOf } from './helpers';

/** Boats entered by id (sail number = the digits of the id). */
const entries = (...ids: string[]) =>
  ids.map((id) => enter(id, 'CRO', id.slice(1)));
const given = (heats: string[][]): Decision => ({
  type: 'heatsCreated',
  heatCount: heats.length,
  heats,
});
const preAssigned: Decision = {
  type: 'settingsChanged',
  settings: { qualifyingMode: 'pre-assigned' },
};

describe('SHRS 3.1(2): progressive assignment by the Heat Movement Table', () => {
  it('3 heats: 1st stays, 2nd goes one heat down, 3rd two (A -> A, C, B)', () => {
    const state = stateOf([
      ...entries('b11', 'b12', 'b13', 'b21', 'b22', 'b23', 'b31', 'b32', 'b33'),
      given([
        ['b11', 'b12', 'b13'],
        ['b21', 'b22', 'b23'],
        ['b31', 'b32', 'b33'],
      ]),
      sheet('A1', 1, 'b11', 'b12', 'b13'),
      sheet('B1', 1, 'b21', 'b22', 'b23'),
      sheet('C1', 1, 'b31', 'b32', 'b33'),
      { type: 'roundCreated' },
    ]);
    expect(state.rounds[1].map((heat) => heat.id)).toEqual(['A2', 'B2', 'C2']);
    expect(heatBoats(state, 2)).toEqual([
      ['b11', 'b22', 'b33'],
      ['b13', 'b21', 'b32'],
      ['b12', 'b23', 'b31'],
    ]);
  });

  it('2 heats of different sizes (4 and 3): odd places stay, even places swap', () => {
    const state = stateOf([
      ...entries('b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'),
      given([
        ['b1', 'b2', 'b3', 'b4'],
        ['b5', 'b6', 'b7'],
      ]),
      sheet('A1', 1, 'b1', 'b2', 'b3', 'b4'),
      sheet('B1', 1, 'b5', 'b6', 'b7'),
      { type: 'roundCreated' },
    ]);
    expect(heatBoats(state, 2)).toEqual([
      ['b1', 'b3', 'b6'],
      ['b2', 'b4', 'b5', 'b7'],
    ]);
  });

  it('refuses a next round when there are no heats yet', () => {
    expect(refusal([...entries('b1', 'b2'), { type: 'roundCreated' }])).toBe(
      'Create the heats first.',
    );
  });
});

describe('SHRS 3.2: pre-assignment keeps every boat in her heat', () => {
  it('each boat stays in the heat letter she sailed in', () => {
    const state = stateOf([
      preAssigned,
      ...entries('b1', 'b2', 'b3'),
      given([['b1', 'b2'], ['b3']]),
      sheet('A1', 1, 'b1', 'b2'),
      sheet('B1', 1, 'b3'),
      { type: 'roundCreated' },
    ]);
    expect(heatBoats(state, 2)).toEqual([['b1', 'b2'], ['b3']]);
  });

  it('the finishing order does not move anyone (it would under 3.1)', () => {
    const races: Decision[] = [
      ...entries('b1', 'b2', 'b3', 'b4'),
      given([
        ['b1', 'b2'],
        ['b3', 'b4'],
      ]),
      sheet('A1', 1, 'b2', 'b1'),
      sheet('B1', 1, 'b4', 'b3'),
      { type: 'roundCreated' },
    ];
    expect(heatBoats(stateOf([preAssigned, ...races]), 2)).toEqual([
      ['b1', 'b2'],
      ['b3', 'b4'],
    ]);
    // Progressive: the 2nd of each heat swaps.
    expect(heatBoats(stateOf(races), 2)).toEqual([
      ['b2', 'b3'],
      ['b1', 'b4'],
    ]);
  });

  it('refuses a next round when the heats have no boats left', () => {
    expect(
      refusal([
        preAssigned,
        ...entries('b1', 'b2'),
        { type: 'heatsCreated', heatCount: 2 },
        { type: 'boatRemoved', boat: 'b1' },
        { type: 'boatRemoved', boat: 'b2' },
        { type: 'roundCreated' },
      ]),
    ).toMatch(/same races first/);
  });
});
