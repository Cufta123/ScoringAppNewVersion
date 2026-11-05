/**
 * Ported from the app's src/__tests__/scoringCore.overall.test.ts (the old
 * overall standings core: SHRS 5.5 fleet order and Q + F totals, 5.7(ii)
 * across both series, shared ranks).
 *
 * Already covered elsewhere: A8.2 reads the last final race first
 * (overall.test.ts "A8.2 reads the last race of the event"), 5.5 fleet order
 * and equal points across fleets (overall.test.ts "5.5: equal overall points
 * across fleets are not a tie", final-leaderboard-order.test.ts "SHRS 5.5"),
 * a tie broken by 5.7(ii) (overall.test.ts "A8.2 reads the last race"),
 * shared overall places (event.test.ts "1.5 and 5.5": 1, 1, 3, 3). Boats of
 * different fleets that "never met" are never tied overall (5.5), so the old
 * packet scenario for them has no counterpart; plain A8.1 without excluded
 * scores in the overall is in overall-tie-break.test.ts.
 */
import {
  explainTie,
  overallStandings,
  overallTieBreak,
  type Decision,
} from '../../src';
import { boats, sheet, stateOf } from './helpers';

// A1 = CRO 1, 4; B1 = CRO 2, 3.
const qualifying = (...a1: string[]): Decision[] => [
  ...boats(4),
  { type: 'heatsCreated', heatCount: 2 },
  sheet('A1', 1, ...a1),
  sheet('B1', 1, 'b2', 'b3'),
];

it('SHRS 5.7(ii)(1): boats that met only in the final compare on the final races only', () => {
  // CRO 4 (2nd in A1, 2 points) and CRO 2 (won B1, 1 point) never met in
  // qualifying. Gold: CRO 4 scores 1, 3; CRO 2 scores 3, 2. Both 6 overall.
  // On their shared races CRO 4 has 1, 3 against 2, 3: CRO 4 ahead. Plain
  // A8 over every race (1, 2, 3 each; last race 3 against 2) would put CRO 2
  // ahead.
  const state = stateOf([
    ...qualifying('b1', 'b4'),
    { type: 'finalSeriesStarted', fleets: [['b1', 'b2', 'b3', 'b4']] },
    sheet('Gold', 1, 'b4', 'b1', 'b2', 'b3'),
    sheet('Gold', 2, 'b1', 'b2', 'b4', 'b3'),
  ]);
  expect(
    overallStandings(state).map((s) => [s.boat, s.total, s.place]),
  ).toEqual([
    ['b1', 4, 1],
    ['b4', 6, 2],
    ['b2', 6, 3],
    ['b3', 10, 4],
  ]);
  expect(overallTieBreak(state)('b4', 'b2')).toBeLessThan(0);
  expect(explainTie(state, 'b4', 'b2', 'overall').steps[0].rule).toBe(
    'SHRS 5.7(ii)(1)-(2), RRS A8.1',
  );
});

it('SHRS 5.7: a tie no rule can break stays a tie (shared overall place)', () => {
  // CRO 1 and CRO 2 won their heats (never met) and tie at the finish of the
  // only Gold race (RRS A7, 1.5 each): 2.5 each, the same scores everywhere.
  const state = stateOf([
    ...qualifying('b1', 'b4'),
    { type: 'finalSeriesStarted' },
    sheet('Gold', 1, 'b1', '=b2'),
  ]);
  const gold = overallStandings(state).filter((s) => s.fleet === 'Gold');
  expect(gold.map((s) => [s.boat, s.total, s.place])).toEqual([
    ['b1', 2.5, 1],
    ['b2', 2.5, 1],
  ]);
  expect(overallTieBreak(state)('b1', 'b2')).toBe(0);
  expect(overallTieBreak(state)('b2', 'b1')).toBe(0);
});
