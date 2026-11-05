import { discardCount, excludedScores } from '../src/rules/discards';
import {
  noPlacePoints,
  penaltyPoints,
  redressAverage,
  sum,
  toTenth,
} from '../src/rules/points';
import {
  compareBoats,
  compareRecorded,
  nextHeat,
  serpentine,
} from '../src/rules/seeding';
import {
  fleetName,
  rule43Applies,
  splitIntoFleets,
  splitTotal,
} from '../src/rules/fleets';
import { compareLists, rankByTotal } from '../src/rules/ranking';

describe('SHRS 5.4 discards', () => {
  it('counts 0 below 4 races, 1 at 4-7, 2 at 8-15, then one per 8', () => {
    const standard = { kind: 'standard' } as const;
    expect(
      [1, 3, 4, 7, 8, 15, 16, 24].map((n) => discardCount(n, standard)),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 4]);
  });

  it('follows a race committee change', () => {
    expect(discardCount(10, { kind: 'none' })).toBe(0);
    expect(discardCount(5, { kind: 'thresholds', at: [3, 6] })).toBe(1);
    expect(discardCount(6, { kind: 'thresholds', at: [3, 6] })).toBe(2);
    expect(
      discardCount(9, { kind: 'custom', first: 3, second: 5, every: 2 }),
    ).toBe(4);
  });

  it('drops the worst, earliest first on equal scores, never DNE', () => {
    const scores = [
      { points: 5, order: 1 },
      { points: 21, code: 'DNE', order: 2 },
      { points: 5, order: 3 },
      { points: 1, order: 4 },
    ];
    expect([...excludedScores(scores, 1)]).toEqual([0]);
    expect([...excludedScores(scores, 2)].sort()).toEqual([0, 2]);
  });

  it('always leaves a boat one score', () => {
    expect(excludedScores([{ points: 3, order: 1 }], 1).size).toBe(0);
  });
});

describe('points', () => {
  it('SHRS 5.2: no place scores the largest heat + 1', () => {
    expect(noPlacePoints(16)).toBe(17);
  });

  it('RRS 44.3(c): 20% of the DNF score, to the tenth, capped', () => {
    // 16-boat heat: DNF 17, 20% = 3.4.
    expect(penaltyPoints(5, 16, 'ZFP')).toBe(8.4);
    expect(penaltyPoints(5, 16, 'SCP')).toBe(8.4);
    // T1 is 30%: 5.1.
    expect(penaltyPoints(5, 16, 'T1')).toBe(10.1);
    expect(penaltyPoints(15, 16, 'ZFP')).toBe(17);
  });

  it('rounds 0.05 upward and sums tenths exactly', () => {
    expect(toTenth(2.05)).toBe(2.1);
    expect(toTenth(2.04)).toBe(2);
    expect(sum([0.1, 0.2])).toBe(0.3);
  });

  it('RRS A9: averages to the tenth, leaving out other averages', () => {
    expect(
      redressAverage([
        { points: 1, averaged: false },
        { points: 2, averaged: false },
        { points: 4, averaged: false },
        { points: 9, averaged: true },
      ]),
    ).toBe(2.3);
    expect(redressAverage([])).toBeNull();
  });
});

describe('SHRS 3 seeding and the Heat Movement Table', () => {
  const boat = (nat: string, sail: string) => ({ id: sail, nat, sail });

  it('orders by national letters, then sail number numerically', () => {
    const boats = [boat('ITA', '7'), boat('CRO', '10'), boat('CRO', '9')];
    expect(boats.sort(compareBoats).map((b) => `${b.nat}${b.sail}`)).toEqual([
      'CRO9',
      'CRO10',
      'ITA7',
    ]);
  });

  it('3.1(1): seeds 1, 2, 3, 3, 2, 1, 1, …', () => {
    expect(serpentine(10, 3)).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2, 2]);
    expect(serpentine(4, 1)).toEqual([0, 0, 0, 0]);
  });

  it('matches the worked examples for boats from heat B', () => {
    const fromB = (heats: number) =>
      [1, 2, 3, 4, 5]
        .map((place) => 'ABCDE'[nextHeat(1, place, heats)])
        .join('');
    expect(fromB(2)).toBe('BABAB');
    expect(fromB(3)).toBe('BACBA');
    expect(fromB(4)).toBe('BADCB');
    expect(fromB(5)).toBe('BAEDC');
  });

  it('5.3: finishers, then DNF, RET, …, DSQ; ties by sail', () => {
    const rows = [
      { boat: boat('CRO', '3'), code: 'DSQ' as const },
      { boat: boat('CRO', '2'), code: 'DNF' as const },
      { boat: boat('CRO', '5'), slot: 2 },
      { boat: boat('CRO', '4'), slot: 1 },
      { boat: boat('CRO', '1'), code: 'DNF' as const },
    ];
    expect(rows.sort(compareRecorded).map((r) => r.boat.sail)).toEqual([
      '4',
      '5',
      '1',
      '2',
      '3',
    ]);
  });
});

describe('SHRS 4 fleets', () => {
  it('names Gold, Silver, Bronze, Copper, then Fleet 5', () => {
    expect([0, 1, 2, 3, 4].map(fleetName)).toEqual([
      'Gold',
      'Silver',
      'Bronze',
      'Copper',
      'Fleet 5',
    ]);
  });

  it('4.1: as equal as possible, earlier fleets take the extra boats', () => {
    const boats = Array.from({ length: 11 }, (_v, i) => i);
    const split = splitIntoFleets(boats, () => false, 3, 'add-fleets');
    expect(split.ok && split.fleets.map((f) => f.length)).toEqual([4, 4, 3]);
  });

  it('4.2: withdrawn boats go to the lowest fleet', () => {
    const split = splitIntoFleets(
      [1, 2, 3, 4],
      (b) => b === 1,
      2,
      'add-fleets',
    );
    expect(split.ok && split.fleets).toEqual([
      [2, 3],
      [4, 1],
    ]);
  });

  it('2.3: adds fleets past 20 boats, unless oversize is allowed', () => {
    const boats = Array.from({ length: 45 }, (_v, i) => i);
    const added = splitIntoFleets(boats, () => false, 2, 'add-fleets');
    expect(added.ok && added.fleets.map((f) => f.length)).toEqual([15, 15, 15]);
    const kept = splitIntoFleets(boats, () => false, 2, 'allow-oversize');
    expect(kept.ok && kept.fleets.map((f) => f.length)).toEqual([23, 22]);
  });

  it('4.3: only for 6 or 7 races; drops the second-worst too', () => {
    expect([5, 6, 7, 8].map(rule43Applies)).toEqual([false, true, true, false]);
    const scores = [1, 9, 4, 7, 2, 3].map((points) => ({ points }));
    // 5.4 drops the 9, 4.3 the 7.
    expect(splitTotal(scores, 1, true)).toBe(10);
    // No 5.4 discard: the 9 stays, only the 7 goes.
    expect(splitTotal(scores, 0, true)).toBe(19);
  });
});

describe('ranking', () => {
  it('compares lists, a missing entry being the worst', () => {
    expect(compareLists([1, 2], [1, 3])).toBeLessThan(0);
    expect(compareLists([1], [1, 2])).toBeGreaterThan(0);
  });

  it('shares a place no tie-break can split: 1, 2, 2, 4', () => {
    const ranked = rankByTotal(
      [
        { id: 'a', total: 3 },
        { id: 'b', total: 5 },
        { id: 'c', total: 5 },
        { id: 'd', total: 9 },
      ],
      (x) => x.total,
      () => 0,
    );
    expect(ranked.map((r) => r.place)).toEqual([1, 2, 2, 4]);
  });
});
