/**
 * Ported from the app's src/__tests__/calculateFinalBoatScores.test.ts (the
 * old Final Series scoring, deleted with the old engine). Each fleet is
 * scored on its own (SHRS 5.1), with its own discards (5.4, 4.5) and ties
 * (5.7, RRS A8).
 *
 * Already covered elsewhere: fleets are kept apart and hold only their boats
 * (event.test.ts "4.2: splits by qualifying ranking"), lowest total first
 * and an unraced fleet still listed (event.test.ts "1.5 and 5.5"), a boat
 * always keeps one score (rules.test.ts "always leaves a boat one score").
 */
import {
  finalStandings,
  type Decision,
  type DiscardProfile,
  type FleetStandings,
} from '../../src';
import { protest, sheet, stateOf } from './helpers';
import { finalEvent, named, pointsRace } from './finals';

const fleetOf = (log: Decision[], fleet: string): FleetStandings =>
  finalStandings(stateOf(log)).find((f) => f.fleet === fleet)!;

const standing = (log: Decision[], fleet: string, boat: string) =>
  fleetOf(log, fleet).standings.find((s) => s.boat === boat)!;

const finalDiscards = (final: DiscardProfile) => ({
  discards: { qualifying: { kind: 'standard' } as const, final },
});

/** `races[i]` gives the points of race i + 1 for the boats named in it. */
function raced(
  fleets: string[][],
  races: Record<string, number | 'DNF' | 'DNC'>[],
  fleet = 'Gold',
  settings = {},
): Decision[] {
  const boats = fleets[['Gold', 'Silver', 'Bronze'].indexOf(fleet)];
  return [
    ...finalEvent(fleets, settings),
    ...races.map((points, i) => pointsRace(fleet, i + 1, boats, points)),
  ];
}

describe('SHRS 5.1: each fleet scored on its own', () => {
  it('SHRS 4.1 / 5.1: Gold, Silver and Bronze each have places from 1', () => {
    const fleets = [
      ['g1', 'g2'],
      ['s1', 's2'],
      ['b1', 'b2'],
    ];
    const log = [
      ...finalEvent(fleets),
      sheet('Gold', 1, 'g2', 'g1'),
      sheet('Silver', 1, 's1', 's2'),
      sheet('Bronze', 1, 'b2', 'b1'),
    ];
    expect(
      finalStandings(stateOf(log)).map((f) => [
        f.fleet,
        f.standings.map((s) => [s.boat, s.place]),
      ]),
    ).toEqual([
      [
        'Gold',
        [
          ['g2', 1],
          ['g1', 2],
        ],
      ],
      [
        'Silver',
        [
          ['s1', 1],
          ['s2', 2],
        ],
      ],
      [
        'Bronze',
        [
          ['b2', 1],
          ['b1', 2],
        ],
      ],
    ]);
  });

  it('SHRS 1.3: no fleets, so no final standings, before the Final Series', () => {
    const log = finalEvent([['g1', 'g2']]).slice(0, -1);
    expect(finalStandings(stateOf(log))).toEqual([]);
  });

  it('a fleet of one boat: she is 1st', () => {
    const log = [
      ...finalEvent([['g1', 'g2', 'g3'], ['s1']]),
      sheet('Silver', 1, 's1'),
    ];
    expect(fleetOf(log, 'Silver').standings).toMatchObject([
      { boat: 's1', place: 1, total: 1 },
    ]);
  });
});

describe('SHRS 5.4 in the Final Series', () => {
  it('SHRS 5.4: no discard at 3 races, all scores kept (5 + 3 + 1 = 9)', () => {
    const log = raced([named('g', 5)], [{ g1: 5 }, { g1: 3 }, { g1: 1 }]);
    expect(standing(log, 'Gold', 'g1').total).toBe(9);
  });

  it('SHRS 5.4 changed by the race committee: thresholds 3, 5, 6 give 3 discards at 6 races', () => {
    const log = raced(
      [named('g', 10)],
      [10, 9, 8, 7, 6, 5].map((p) => ({ g1: p })),
      'Gold',
      finalDiscards({ kind: 'thresholds', at: [3, 5, 6] }),
    );
    expect(standing(log, 'Gold', 'g1').total).toBe(7 + 6 + 5);
  });

  it('SHRS 5.4 changed by the race committee: first 3, second 6, every 6 gives 2 discards at 6 races', () => {
    const log = raced(
      [named('g', 9)],
      [9, 8, 7, 6, 5, 4].map((p) => ({ g1: p })),
      'Gold',
      finalDiscards({ kind: 'custom', first: 3, second: 6, every: 6 }),
    );
    expect(standing(log, 'Gold', 'g1').total).toBe(7 + 6 + 5 + 4);
  });

  it('SHRS 5.4 / 5.1: the discard count is the fleet’s races, a boat that missed one included', () => {
    // Gold sailed 4 races: one discard for every boat. `missed` did not come
    // to race 1 (DNC 5, fleet of 4) and keeps 2 + 1 + 2 = 5.
    const log = raced(
      [['all', 'missed', 'x', 'y']],
      [
        { all: 'DNF', missed: 'DNC' },
        { all: 3, missed: 2 },
        { all: 2, missed: 1 },
        { all: 1, missed: 2 },
      ],
    );
    expect(standing(log, 'Gold', 'all').total).toBe(6);
    expect(standing(log, 'Gold', 'missed').total).toBe(5);
  });

  it('SHRS 4.5 / 5.4: each fleet on its own race count (Gold 4 races, 1 discard; Silver 3, none)', () => {
    const fleets = [named('g', 4), named('s', 4)];
    const log = [
      ...finalEvent(fleets),
      ...[4, 3, 2, 1].map((p, i) =>
        pointsRace('Gold', i + 1, fleets[0], { g1: p }),
      ),
      ...[4, 2, 1].map((p, i) =>
        pointsRace('Silver', i + 1, fleets[1], { s1: p }),
      ),
    ];
    expect(standing(log, 'Gold', 'g1').total).toBe(6);
    expect(standing(log, 'Silver', 's1').total).toBe(7);
  });

  it('RRS 90.3(b): DNE and DGM are never excluded, so the next worst is', () => {
    // Fleet of 4: DNE and DGM score 5. Four races, one discard: the 4 goes.
    const boats = named('g', 4);
    const log = [
      ...finalEvent([boats]),
      pointsRace('Gold', 1, boats, { g1: 1 }),
      protest('Gold', 1, 'g1', { kind: 'DNE' }),
      pointsRace('Gold', 2, boats, { g1: 1 }),
      protest('Gold', 2, 'g1', { kind: 'DGM' }),
      pointsRace('Gold', 3, boats, { g1: 4 }),
      pointsRace('Gold', 4, boats, { g1: 1 }),
    ];
    const g1 = standing(log, 'Gold', 'g1');
    expect(g1.scores.map((s) => [s.code, s.points, s.excluded])).toEqual([
      ['DNE', 5, false],
      ['DGM', 5, false],
      [undefined, 4, true],
      [undefined, 1, false],
    ]);
    expect(g1.total).toBe(11);
  });
});

describe('SHRS 5.7 / RRS A8 in a final fleet', () => {
  const four = [['a', 'b', 'c', 'd']];

  it('RRS A8.1: equal totals, the better best score is ahead (1, 4 against 2, 3)', () => {
    const log = raced(four, [
      { a: 4, b: 3 },
      { a: 1, b: 2 },
    ]);
    expect(standing(log, 'Gold', 'a').total).toBe(5);
    expect(standing(log, 'Gold', 'b').total).toBe(5);
    expect(standing(log, 'Gold', 'a').place).toBeLessThan(
      standing(log, 'Gold', 'b').place,
    );
  });

  it('RRS A8.2: A8.1 level, the last race decides', () => {
    const log = raced(four, [
      { a: 1, b: 3 },
      { a: 3, b: 1 },
    ]);
    expect(standing(log, 'Gold', 'b').place).toBeLessThan(
      standing(log, 'Gold', 'a').place,
    );
  });

  it('no rule separates them: they share the place, listed in SHRS 5.3 boat order', () => {
    // Tied at the finish in both races (RRS A7): 1.5 each, every time. The
    // old engine listed them in input order; the library lists boats no rule
    // separates by national letters and sail number (docs/parity README).
    const log = [
      ...finalEvent([['boatZ', 'boatA']]),
      sheet('Gold', 1, 'boatA', '=boatZ'),
      sheet('Gold', 2, 'boatZ', '=boatA'),
    ];
    expect(
      fleetOf(log, 'Gold').standings.map((s) => [s.boat, s.total, s.place]),
    ).toEqual([
      ['boatZ', 3, 1],
      ['boatA', 3, 1],
    ]);
  });

  // Kept scores are equal and plain A8.2 (last race: a 1 against b 2) would
  // put `a` ahead; with the excluded scores (5.7(ii)(2)) `b` is ahead.
  it.each([
    ['10, 10', [10, 10], [4, 4]],
    ['8, 7', [8, 7], [6, 5]],
  ])(
    'SHRS 5.7(ii)(2): excluded scores (%s against less) break a tie on kept scores at 8 races',
    (_label, aWorst, bWorst) => {
      const a = [aWorst[0], aWorst[1], 3, 2, 2, 1, 1, 1];
      const b = [bWorst[0], bWorst[1], 1, 1, 1, 3, 2, 2];
      const log = raced(
        [named('x', 8).concat(['a', 'b'])],
        a.map((p, i) => ({ a: p, b: b[i] })),
      );
      const sa = standing(log, 'Gold', 'a');
      const sb = standing(log, 'Gold', 'b');
      expect(sa.total).toBe(10);
      expect(sb.total).toBe(10);
      expect(sa.scores.filter((s) => s.excluded)).toHaveLength(2);
      expect(sb.place).toBeLessThan(sa.place);
    },
  );

  it('RRS A8.2: three boats on equal points and equal scores are placed by the last race', () => {
    const log = raced(
      [['tA', 'tB', 'tC']],
      [
        { tA: 3, tB: 1, tC: 2 },
        { tA: 2, tB: 3, tC: 1 },
        { tA: 1, tB: 2, tC: 3 },
      ],
    );
    expect(
      fleetOf(log, 'Gold').standings.map((s) => [s.boat, s.total, s.place]),
    ).toEqual([
      ['tA', 6, 1],
      ['tB', 6, 2],
      ['tC', 6, 3],
    ]);
  });
});

describe('SHRS 2.3 oversize fleets (the race committee allows more than 20)', () => {
  const oversize = { finalOverflow: 'allow-oversize' } as const;

  it('three fleets of 25: every place 1 to 25, totals in order', () => {
    const fleets = ['g', 's', 'b'].map((p) => named(p, 25));
    const log = [
      ...finalEvent(fleets, oversize),
      ...['Gold', 'Silver', 'Bronze'].map((fleet, i) =>
        sheet(fleet, 1, ...[...fleets[i]].reverse()),
      ),
    ];
    finalStandings(stateOf(log)).forEach((fleet) => {
      expect(fleet.standings.map((s) => s.place)).toEqual(
        Array.from({ length: 25 }, (_v, i) => i + 1),
      );
      fleet.standings.slice(1).forEach((s, i) => {
        expect(fleet.standings[i].total).toBeLessThanOrEqual(s.total);
      });
    });
  });

  it('RRS A8.2 in a 24-boat Gold: two boats on 14 with 4 and 10 each, the last race decides', () => {
    const boats = named('gold', 22).concat(['tieA', 'tieB']);
    const log = raced(
      [boats, named('s', 2)],
      [
        { tieA: 10, tieB: 4 },
        { tieA: 4, tieB: 10 },
      ],
      'Gold',
      oversize,
    );
    const gold = fleetOf(log, 'Gold');
    const a = gold.standings.find((s) => s.boat === 'tieA')!;
    const b = gold.standings.find((s) => s.boat === 'tieB')!;
    expect([a.total, b.total]).toEqual([14, 14]);
    expect(a.place).toBeLessThan(b.place);
    expect(gold.standings.map((s) => s.place)).toEqual(
      Array.from({ length: 24 }, (_v, i) => i + 1),
    );
  });
});
