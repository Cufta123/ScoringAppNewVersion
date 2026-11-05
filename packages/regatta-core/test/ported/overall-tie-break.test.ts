/**
 * Ported from the app's src/__tests__/overallTieBreak.test.ts (the old
 * overall tie-break between two boats of one fleet: SHRS 5.7(ii) across the
 * Qualifying and Final Series).
 *
 * Already covered elsewhere: shared races decide by A8.1 with excluded
 * scores (overall.test.ts "5.7(ii)(2): excluded scores count"), shared
 * races then A8.2 (overall.test.ts "A8.2 reads the last race of the event"),
 * a shared-race tie nothing breaks stays a tie (scoring-core-overall.test.ts
 * "a tie no rule can break stays a tie").
 */
import {
  overallStandings,
  overallTieBreak,
  type Decision,
  type EventState,
} from '../../src';
import { boats, sheet, stateOf } from './helpers';
import { pointsRace } from './finals';

describe('SHRS 5.7(ii)(4) in the overall: boats that never sailed in the same heat', () => {
  // Pre-assigned heats (SHRS 3.2): A = CRO 1, 4, 5, 8, 9; B = CRO 2, 3, 6, 7,
  // 10 for every round, so CRO 1 (x) and CRO 2 (y) never meet. They go to
  // Silver, which has not raced while Gold has: the overall ranks Silver by
  // the qualifying series (1.5 per fleet), tie-break 5.7(ii)(4).
  const A = ['b1', 'b4', 'b5', 'b8', 'b9'];
  const B = ['b2', 'b3', 'b6', 'b7', 'b10'];

  function event(x: number[], y: number[]): EventState {
    const log: Decision[] = [
      { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
      ...boats(10),
      { type: 'heatsCreated', heatCount: 2 },
    ];
    x.forEach((points, i) => {
      if (i > 0) log.push({ type: 'roundCreated' });
      log.push(pointsRace(`A${i + 1}`, 1, A, { b1: points }));
      log.push(pointsRace(`B${i + 1}`, 1, B, { b2: y[i] }));
    });
    const gold = ['b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
    log.push(
      {
        type: 'finalSeriesStarted',
        fleets: [gold, ['b1', 'b2', 'b9', 'b10']],
      },
      sheet('Gold', 1, ...gold),
    );
    return stateOf(log);
  }
  const placeOf = (state: EventState, boat: string) =>
    overallStandings(state).find((s) => s.boat === boat)!;

  it('RRS A8.1 unchanged: x 1, 2, 4 against y 1, 1, 5, y is ahead', () => {
    // A8.2 (last race 4 against 5) would have put x ahead.
    const state = event([1, 2, 4], [1, 1, 5]);
    expect(placeOf(state, 'b1').total).toBe(7);
    expect(placeOf(state, 'b2').total).toBe(7);
    expect(overallTieBreak(state)('b1', 'b2')).toBeGreaterThan(0);
    expect(placeOf(state, 'b2').place).toBeLessThan(placeOf(state, 'b1').place);
  });

  it('RRS A8.2 unchanged when A8.1 is level: the last race decides', () => {
    // x: 1, 2, 4 in that order; y: 4, 2, 1. y won the last race.
    const state = event([1, 2, 4], [4, 2, 1]);
    expect(overallTieBreak(state)('b1', 'b2')).toBeGreaterThan(0);
    expect(placeOf(state, 'b2').place).toBeLessThan(placeOf(state, 'b1').place);
  });

  it('A8.1 and A8.2 both level: they stay tied, no order invented', () => {
    const state = event([3, 2, 1], [3, 2, 1]);
    expect(overallTieBreak(state)('b1', 'b2')).toBe(0);
    expect(overallTieBreak(state)('b2', 'b1')).toBe(0);
    expect(placeOf(state, 'b1').place).toBe(placeOf(state, 'b2').place);
  });

  it('RRS A8.1 leaves excluded scores out (5.7(ii)(2) is for boats that met)', () => {
    // 4 races, 1 discard. x: 5, 2, 2, 1 (5 out); y: 3, 1, 2, 2 (3 out). Kept
    // 1, 2, 2 each, so A8.1 is level and A8.2 decides: last race 1 against
    // 2, x ahead. Counting the excluded scores (5 against 3) would put y
    // ahead.
    const state = event([5, 2, 2, 1], [3, 1, 2, 2]);
    expect(placeOf(state, 'b1').total).toBe(5);
    expect(placeOf(state, 'b2').total).toBe(5);
    expect(overallTieBreak(state)('b1', 'b2')).toBeLessThan(0);
    expect(placeOf(state, 'b1').place).toBeLessThan(placeOf(state, 'b2').place);
  });
});

it('RRS A8.2 across both series: a shared final race is later than any shared qualifying race', () => {
  // A1 = CRO 1, 4: CRO 1 wins (1), CRO 4 2nd (2). Recorded fleets put both in
  // Gold, where CRO 4 wins (1) and CRO 1 is 2nd (2): 3 each overall, A8.1 on
  // the shared races level (1, 2), A8.2 from the Gold race: CRO 4.
  const state = stateOf([
    ...boats(4),
    { type: 'heatsCreated', heatCount: 2 },
    sheet('A1', 1, 'b1', 'b4'),
    sheet('B1', 1, 'b2', 'b3'),
    {
      type: 'finalSeriesStarted',
      fleets: [
        ['b1', 'b4'],
        ['b2', 'b3'],
      ],
    },
    sheet('Gold', 1, 'b4', 'b1'),
  ]);
  const gold = overallStandings(state).filter((s) => s.fleet === 'Gold');
  expect(gold.map((s) => [s.boat, s.total, s.place])).toEqual([
    ['b4', 3, 1],
    ['b1', 3, 2],
  ]);
  expect(overallTieBreak(state)('b4', 'b1')).toBeLessThan(0);
});

it('SHRS 5.7(ii)(3): three boats tied overall, the top place first, then the other two again', () => {
  // 3 heats (A1 = CRO 1, 6, 7; B1 = CRO 2, 5, 8; C1 = CRO 3, 4, 9); CRO 1, 2
  // and 3 win (1 point each, never met). Gold (5 boats, no discards) sails 4
  // races: CRO 1 scores 1, 1, 4, 4; CRO 2 2, 3, 2, 3; CRO 3 3, 2, 3, 2. All
  // 11 overall. CRO 1 beats both on A8.1 (1, 1, 4, 4 against 2, 2, 3, 3);
  // then CRO 2 and 3 are level on A8.1 and CRO 3 wins the last race (A8.2).
  const start: Decision[] = [
    {
      type: 'settingsChanged',
      settings: {
        discards: { qualifying: { kind: 'standard' }, final: { kind: 'none' } },
      },
    },
    ...boats(9),
    { type: 'heatsCreated', heatCount: 3 },
  ];
  const gold = ['b1', 'b2', 'b3', 'b4', 'b5'];
  const log: Decision[] = [
    ...start,
    ...stateOf(start).rounds[0].map((heat) => sheet(heat.id, 1, ...heat.boats)),
    {
      type: 'finalSeriesStarted',
      fleets: [gold, ['b6', 'b7', 'b8', 'b9']],
    },
    pointsRace('Gold', 1, gold, { b1: 1, b2: 2, b3: 3, b4: 4, b5: 5 }),
    pointsRace('Gold', 2, gold, { b1: 1, b3: 2, b2: 3, b4: 4, b5: 5 }),
    pointsRace('Gold', 3, gold, { b4: 1, b2: 2, b3: 3, b1: 4, b5: 5 }),
    pointsRace('Gold', 4, gold, { b5: 1, b3: 2, b2: 3, b1: 4, b4: 5 }),
  ];
  const state = stateOf(log);
  expect(
    overallStandings(state)
      .slice(0, 3)
      .map((s) => [s.boat, s.total, s.place]),
  ).toEqual([
    ['b1', 11, 1],
    ['b3', 11, 2],
    ['b2', 11, 3],
  ]);
});
