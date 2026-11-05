/**
 * Overall ties (SHRS 5.5, 5.7(ii)) across both series. Scenarios carried
 * over from the app's readOverallLeaderboard tests when that read moved to
 * this library.
 */
import { explainTie, overallStandings, replay, type Decision } from '../src';

const boat = (i: number): Decision => ({
  type: 'boatEntered',
  boat: { id: `b${i}`, nat: 'CRO', sail: String(i) },
});
const sheet = (heat: string, race: number, ...boats: string[]): Decision => ({
  type: 'raceScored',
  race: { heat, race },
  lines: boats.map((id) => ({ boat: id })),
});

// Heats by SHRS 3: A1 = b1, b4; B1 = b2, b3. b1 and b2 win their heats
// (1 point each, never met) and go to Gold with b3/b4 in Silver.
const qualifying: Decision[] = [
  boat(1),
  boat(2),
  boat(3),
  boat(4),
  { type: 'heatsCreated', heatCount: 2 },
  sheet('A1', 1, 'b1', 'b4'),
  sheet('B1', 1, 'b2', 'b3'),
  { type: 'finalSeriesStarted' },
];

/** Gold races from finishing orders of b1 and b2. */
const gold = (...orders: string[][]) =>
  orders.map((order, i) => sheet('Gold', i + 1, ...order));

it('splits as the scenarios assume', () => {
  const { state } = replay(qualifying);
  expect(state.fleets!.map((f) => [f.id, [...f.boats].sort()])).toEqual([
    ['Gold', ['b1', 'b2']],
    ['Silver', ['b3', 'b4']],
  ]);
});

it('A8.2 reads the last race of the event: the last final race', () => {
  // b1: 1, 2; b2: 2, 1. Overall 1 + 3 = 4 each; they met only in Gold.
  const { state } = replay([
    ...qualifying,
    ...gold(['b1', 'b2'], ['b2', 'b1']),
  ]);
  expect(
    overallStandings(state).map((s) => [s.boat, s.total, s.place]),
  ).toEqual(
    [
      ['b2', 4, 1],
      ['b1', 4, 2],
    ].concat(
      overallStandings(state)
        .filter((s) => s.fleet === 'Silver')
        .map((s) => [s.boat, s.total, s.place]),
    ),
  );
  const tie = explainTie(state, 'b1', 'b2', 'overall');
  expect(tie.ahead).toBe('b2');
  expect(tie.steps.at(-1)!.rule).toBe('SHRS 5.7(ii)(1), RRS A8.2');
});

it('5.7(ii)(2): excluded scores count, which changes the winner here', () => {
  // Four Gold races (DNF = 3 in a fleet of 2), one score excluded (5.4).
  // b1: 3, 1, 2, 1 (3 out) = 4; b2: 1, 2, 1, 2 (the earlier 2 out) = 4.
  // Overall 5 each. With excluded scores (5.7(ii)(2)): b1 1,1,2,3 against
  // b2 1,1,2,2, so b2. Plain A8 (kept scores level, then the last race,
  // 1 against 2) would have put b1 ahead.
  const { state } = replay([
    ...qualifying,
    {
      type: 'raceScored',
      race: { heat: 'Gold', race: 1 },
      lines: [{ boat: 'b2' }, { boat: 'b1', code: 'DNF' }],
    },
    sheet('Gold', 2, 'b1', 'b2'),
    sheet('Gold', 3, 'b2', 'b1'),
    sheet('Gold', 4, 'b1', 'b2'),
  ]);
  const gold4 = overallStandings(state).filter((s) => s.fleet === 'Gold');
  expect(gold4.map((s) => [s.boat, s.final, s.total, s.place])).toEqual([
    ['b2', 4, 5, 1],
    ['b1', 4, 5, 2],
  ]);
  expect(explainTie(state, 'b1', 'b2', 'overall').steps[0].rule).toBe(
    'SHRS 5.7(ii)(1)-(2), RRS A8.1',
  );
});

it('5.5: equal overall points across fleets are not a tie', () => {
  // Gold: b1 last in both races; Silver: b3 first in both.
  const { state } = replay([
    ...qualifying,
    ...gold(['b2', 'b1'], ['b2', 'b1']),
    sheet('Silver', 1, 'b3', 'b4'),
    sheet('Silver', 2, 'b3', 'b4'),
  ]);
  const overall = overallStandings(state);
  expect(overall.map((s) => [s.boat, s.fleet])).toEqual([
    ['b2', 'Gold'],
    ['b1', 'Gold'],
    ['b3', 'Silver'],
    ['b4', 'Silver'],
  ]);
  const tie = explainTie(state, 'b1', 'b3', 'overall');
  expect(tie.ahead).toBe('b1');
  expect(tie.steps[0].rule).toBe('SHRS 5.5');
});
