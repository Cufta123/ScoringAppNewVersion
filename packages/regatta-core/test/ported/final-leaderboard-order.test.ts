/**
 * Ported from the app's src/__tests__/finalLeaderboardOrder.test.ts (the old
 * final leaderboard order: SHRS 4.1 fleet names, 5.5 fleet precedence, 1.5).
 *
 * Already covered elsewhere: fleet names (rules.test.ts "names Gold, Silver,
 * Bronze, Copper, then Fleet 5"), no final race means the qualifying ranking
 * (event.test.ts "1.5: with no final race yet, the overall is the qualifying
 * ranking"), a fleet that has not raced ranks by qualifying while another has
 * (event.test.ts "1.5 and 5.5"), a fleet that has raced ranks on its final
 * points (event.test.ts "1.5 and 5.5", Silver). Not ported: the old row
 * helpers (race id strings, unknown fleet labels, a race scored for only some
 * boats; a library sheet always lists every boat of the fleet).
 */
import { finalStandings, overallStandings, type Decision } from '../../src';
import { boats, sheet, stateOf } from './helpers';

describe('SHRS 5.5 with six fleets', () => {
  // 12 boats, 6 heats of 2 (A1 = CRO 1, 12; B1 = CRO 2, 11; …); the first
  // boat of each heat wins. Six fleets of two, Gold … Copper, Fleet 5, Fleet 6.
  const start: Decision[] = [
    ...boats(12),
    { type: 'heatsCreated', heatCount: 6 },
  ];
  const qualifying: Decision[] = [
    ...start,
    ...stateOf(start).rounds[0].map((heat) => sheet(heat.id, 1, ...heat.boats)),
    { type: 'finalSeriesStarted' },
  ];
  const fleets = stateOf(qualifying).fleets!;
  const race = (fleet: string, n: number) => {
    const { boats: crew } = fleets.find((f) => f.id === fleet)!;
    return sheet(fleet, n, ...crew);
  };

  it('splits into Gold, Silver, Bronze, Copper, Fleet 5, Fleet 6', () => {
    expect(fleets.map((f) => [f.id, f.boats.length])).toEqual([
      ['Gold', 2],
      ['Silver', 2],
      ['Bronze', 2],
      ['Copper', 2],
      ['Fleet 5', 2],
      ['Fleet 6', 2],
    ]);
  });

  it('SHRS 5.5: every fleet ranks before the next whatever the points, Fleet 5 before Fleet 6', () => {
    // Fleets may sail different numbers of races (4.5): Gold sails 3, Fleet 5
    // sails 2, Fleet 6 sails 1, so Gold's last boat has the most points and
    // Fleet 6's winner the fewest.
    const state = stateOf([
      ...qualifying,
      race('Gold', 1),
      race('Gold', 2),
      race('Gold', 3),
      race('Fleet 5', 1),
      race('Fleet 5', 2),
      race('Fleet 6', 1),
    ]);
    const overall = overallStandings(state);
    expect(overall.map((s) => s.fleet)).toEqual(
      ['Gold', 'Silver', 'Bronze', 'Copper', 'Fleet 5', 'Fleet 6'].flatMap(
        (f) => [f, f],
      ),
    );
    const lastGold = overall[1];
    const fleet5 = overall.filter((s) => s.fleet === 'Fleet 5');
    const fleet6Winner = overall.find((s) => s.fleet === 'Fleet 6')!;
    expect(lastGold.total).toBe(7);
    expect(fleet6Winner.total).toBe(3);
    expect(fleet5.every((s) => s.total > fleet6Winner.total)).toBe(true);
    expect(fleet5.every((s) => s.place < fleet6Winner.place)).toBe(true);
    expect(lastGold.place).toBeLessThan(fleet5[0].place);
    // Places run 1 … 12 in fleet order (Silver to Copper share theirs:
    // their boats won different heats and have not raced since).
    expect(overall.map((s) => s.place)).toEqual([
      1, 2, 3, 3, 5, 5, 7, 7, 9, 10, 11, 12,
    ]);
  });
});

describe('SHRS 1.5: no final race completed', () => {
  // A1 = CRO 1, 4; B1 = CRO 2, 3. CRO 1 and 2 win (1 point), 3 and 4 are 2nd.
  // The fleets as recorded put the two 2nds in Gold (a converted record; the
  // same can follow from a 4.3 split or a withdrawal).
  const log: Decision[] = [
    ...boats(4),
    { type: 'heatsCreated', heatCount: 2 },
    sheet('A1', 1, 'b1', 'b4'),
    sheet('B1', 1, 'b2', 'b3'),
    {
      type: 'finalSeriesStarted',
      fleets: [
        ['b3', 'b4'],
        ['b1', 'b2'],
      ],
    },
  ];

  it('SHRS 1.5: ranks by the qualifying score, not by fleet; the fleets are listed Gold first', () => {
    // The old engine put Gold before Silver here (5.5). 1.5 says that with no
    // Final Series race completed boats are ranked by their Qualifying Series
    // score, so the Silver boats that scored 1 are ahead.
    const state = stateOf(log);
    expect(
      overallStandings(state).map((s) => [s.boat, s.place, s.fleet]),
    ).toEqual([
      ['b1', 1, 'Silver'],
      ['b2', 1, 'Silver'],
      ['b3', 3, 'Gold'],
      ['b4', 3, 'Gold'],
    ]);
    expect(finalStandings(state).map((f) => f.fleet)).toEqual([
      'Gold',
      'Silver',
    ]);
  });

  it('SHRS 5.5: once a final race is completed, Gold ranks before Silver', () => {
    const state = stateOf([...log, sheet('Gold', 1, 'b3', 'b4')]);
    expect(overallStandings(state).map((s) => [s.boat, s.fleet])).toEqual([
      ['b3', 'Gold'],
      ['b4', 'Gold'],
      ['b1', 'Silver'],
      ['b2', 'Silver'],
    ]);
  });
});
