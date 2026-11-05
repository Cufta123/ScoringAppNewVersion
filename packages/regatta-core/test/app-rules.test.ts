/**
 * Rules the app used to keep its own copies of, now asked of the library:
 * the code lists, SHRS 5.3 recording order, 2.1 / 2.3 heat counts, the Heat
 * Movement Table note, 4.1 / 5.5 fleet names, the step inside a round, and
 * the point arithmetic. Ported from the app's tests of those copies.
 */
import {
  COMMITTEE_CODES,
  MAX_HEATS,
  MAX_HEAT_SIZE,
  NO_PLACE_CODES,
  NOT_EXCLUDABLE,
  PENALTY_CODES,
  REDRESS_CODES,
  RESULT_CODES,
  codeRank,
  compareBoats,
  discardCount,
  exactPoints,
  excludedScores,
  fewestHeats,
  fleetIndex,
  fleetName,
  inRecordingOrder,
  movementImbalanceExpected,
  nextInRound,
  noPlacePoints,
  penaltyPoints,
  redressAverage,
  sumPoints,
  toTenth,
} from '../src';

describe('codes', () => {
  it('SHRS 5.3 lists the no-place codes in recording order, DGM last', () => {
    expect(NO_PLACE_CODES).toEqual([
      'DNF',
      'RET',
      'NSC',
      'OCS',
      'DNS',
      'DNC',
      'WTH',
      'UFD',
      'BFD',
      'DSQ',
      'DNE',
      'DGM',
    ]);
  });

  it('every result code once: penalties, no-place codes, committee scores', () => {
    expect([...PENALTY_CODES]).toEqual(['ZFP', 'SCP', 'T1']);
    expect([...COMMITTEE_CODES]).toEqual(['DPI', 'RDG1', 'RDG2', 'RDG3']);
    expect([...REDRESS_CODES]).toEqual(['RDG1', 'RDG2', 'RDG3']);
    expect(new Set(RESULT_CODES).size).toBe(RESULT_CODES.length);
    expect(RESULT_CODES).toHaveLength(19);
    // RAF is not a 2025-2028 code (A10).
    expect(RESULT_CODES).not.toContain('RAF');
  });
});

describe('SHRS 5.3 recording order', () => {
  const bySail = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true });
  const order = (boats: string[], codes: Record<string, string>) =>
    inRecordingOrder(boats, (boat) => codes[boat], bySail);

  it('keeps finishers in their given order', () => {
    expect(order(['5', '3', '9'], {})).toEqual(['5', '3', '9']);
  });

  it.each(['ZFP', 'SCP', 'T1'])('%s keeps its place', (penalty) => {
    expect(order(['5', '3'], { 3: penalty })).toEqual(['5', '3']);
  });

  it('puts the no-place codes after the finishers, DNF before DSQ', () => {
    expect(order(['1', '2', '3'], { 1: 'DSQ', 3: 'DNF' })).toEqual([
      '2',
      '3',
      '1',
    ]);
  });

  it('boats with the same code by the tie-break (9 before 10)', () => {
    expect(order(['10', '2'], { 10: 'DNF', 2: 'DNF' })).toEqual(['2', '10']);
  });

  it('DNE is displaced, not a penalty that keeps the place', () => {
    expect(order(['2', '1'], { 2: 'DNE' })).toEqual(['1', '2']);
  });

  it('walks the whole 5.3 order; codes it does not name go last', () => {
    for (let i = 0; i < NO_PLACE_CODES.length - 1; i += 1) {
      expect(codeRank(NO_PLACE_CODES[i])).toBeLessThan(
        codeRank(NO_PLACE_CODES[i + 1]),
      );
    }
    expect(codeRank('DGM')).toBeLessThan(codeRank('DPI'));
    expect(codeRank('XYZ')).toBe(codeRank('DPI'));
    expect(order(['1', '2'], { 1: 'DPI', 2: 'DGM' })).toEqual(['2', '1']);
  });
});

describe('SHRS 3 / 5.3: boat order', () => {
  const boat = (nat: string, sail: string) => ({
    id: `${nat}${sail}`,
    nat,
    sail,
  });

  it('national letters first, then sail number numerically', () => {
    const boats = [
      boat('GER', '1'),
      boat('CRO', '10'),
      boat('CRO', '9'),
      boat('AUS', '100'),
    ];
    expect([...boats].sort(compareBoats).map((b) => b.id)).toEqual([
      'AUS100',
      'CRO9',
      'CRO10',
      'GER1',
    ]);
  });

  it('letters are compared whatever their case', () => {
    expect(compareBoats(boat('cro', '2'), boat('GER', '1'))).toBeLessThan(0);
  });
});

describe('SHRS 2.1 / 2.3: the fewest heats', () => {
  it('one heat up to 20 boats, two from 21, three from 41', () => {
    expect(fewestHeats(12)).toBe(1);
    expect(fewestHeats(20)).toBe(1);
    expect(fewestHeats(21)).toBe(2);
    expect(fewestHeats(40)).toBe(2);
    expect(fewestHeats(41)).toBe(3);
  });

  it('never a heat over 20 boats', () => {
    for (let entries = 1; entries <= 400; entries += 1) {
      const heats = fewestHeats(entries);
      expect(Math.ceil(entries / heats)).toBeLessThanOrEqual(MAX_HEAT_SIZE);
      // One heat fewer would put a heat over 20 (2.1: as few as possible).
      const oneFewer =
        heats > 1 ? Math.ceil(entries / (heats - 1)) : Number.POSITIVE_INFINITY;
      expect(oneFewer).toBeGreaterThan(MAX_HEAT_SIZE);
    }
  });

  it('one heat for no entries; never more than A to Z', () => {
    expect(fewestHeats(0)).toBe(1);
    expect(fewestHeats(-4)).toBe(1);
    expect(fewestHeats(Number.NaN)).toBe(1);
    expect(fewestHeats(10_000)).toBe(MAX_HEATS);
    expect(MAX_HEATS).toBe(26);
  });
});

describe('the note under the Heat Movement Tables', () => {
  it.each([10, 14, 18, 22, 26, 30, 34, 38, 42])(
    'two heats of %i boats: the imbalance is expected',
    (boats) => {
      expect(movementImbalanceExpected(2, boats)).toBe(true);
    },
  );

  it.each([
    [2, 6],
    [2, 12],
    [2, 16],
    [3, 14],
    [1, 10],
  ])('%i heats of %i boats: no note', (heats, boats) => {
    expect(movementImbalanceExpected(heats, boats)).toBe(false);
  });
});

describe('SHRS 4.1 / 5.5: fleet names and precedence', () => {
  it('Gold, Silver, Bronze, Copper, then Fleet 5, Fleet 6', () => {
    expect([0, 1, 2, 3, 4, 5].map(fleetName)).toEqual([
      'Gold',
      'Silver',
      'Bronze',
      'Copper',
      'Fleet 5',
      'Fleet 6',
    ]);
  });

  it('a fleet name back to its place in precedence', () => {
    for (let i = 0; i < 12; i += 1) expect(fleetIndex(fleetName(i))).toBe(i);
    expect(fleetIndex(' fleet 7 ')).toBe(6);
    expect(fleetIndex('Fleet 6')).toBeGreaterThan(fleetIndex('Fleet 5'));
  });

  it('-1 for a name 4.1 does not give', () => {
    expect(fleetIndex('General')).toBe(-1);
    expect(fleetIndex('')).toBe(-1);
  });
});

describe('the next step inside a round', () => {
  const heat = (id: string, races: number, boats = 5) => ({
    heat: id,
    races,
    boats,
  });

  it('nothing without heats', () => {
    expect(nextInRound([], 'qualifying')).toBeNull();
  });

  it('several qualifying heats: the first still to sail', () => {
    expect(
      nextInRound([heat('A2', 1), heat('B2', 0), heat('C2', 0)], 'qualifying'),
    ).toEqual({ kind: 'score', heat: 'B2', race: 1 });
  });

  it('a heat with no boats has nothing to sail', () => {
    expect(
      nextInRound([heat('A2', 1), heat('B2', 0, 0)], 'qualifying'),
    ).toEqual({ kind: 'roundComplete' });
  });

  it('every heat sailed: the round is complete', () => {
    expect(
      nextInRound([heat('A1', 1), heat('B1', 1), heat('C1', 1)], 'qualifying'),
    ).toEqual({ kind: 'roundComplete' });
  });

  it('the Final Series: the fleet behind goes next', () => {
    expect(
      nextInRound(
        [heat('Gold', 2), heat('Silver', 1), heat('Bronze', 2)],
        'final',
      ),
    ).toEqual({ kind: 'score', heat: 'Silver', race: 2 });
  });

  it('one heat races on', () => {
    expect(nextInRound([heat('A1', 3)], 'qualifying')).toEqual({
      kind: 'score',
      heat: 'A1',
      race: 4,
    });
  });

  it('keeps the caller’s heat as it was given', () => {
    const mine = { name: 'Heat B2' };
    expect(
      nextInRound(
        [
          { heat: { name: 'Heat A2' }, races: 1, boats: 4 },
          { heat: mine, races: 0, boats: 4 },
        ],
        'qualifying',
      ),
    ).toEqual({ kind: 'score', heat: mine, race: 1 });
  });
});

describe('point arithmetic', () => {
  it('totals compare exactly (no floating-point noise)', () => {
    expect(sumPoints([0.1, 0.2])).toBe(0.3);
    expect(sumPoints([25.3, 30.5, 31.3])).toBe(87.1);
    expect(exactPoints(0.1 + 0.2)).toBe(0.3);
  });

  it('tenths round 0.05 upward (RRS 44.3(c), A9)', () => {
    expect(toTenth(2.05)).toBe(2.1);
    expect(toTenth(2.04)).toBe(2);
    expect(toTenth(10 / 3)).toBe(3.3);
  });

  it('SHRS 5.2: no place scores the largest heat + 1', () => {
    expect(noPlacePoints(16)).toBe(17);
  });

  it('RRS 44.3(c): 20% / 30% of the DNF score to the tenth, capped', () => {
    // 16-boat heat: DNF 17, 20% = 3.4 (the 2021-2024 rules rounded to 3).
    expect(penaltyPoints(5, 16, 'ZFP')).toBe(8.4);
    expect(penaltyPoints(5, 16, 'SCP')).toBe(8.4);
    expect(penaltyPoints(5, 16, 'T1')).toBe(10.1);
    expect(penaltyPoints(16, 16, 'ZFP')).toBe(17);
  });

  it('RRS A9: an average to the tenth, average redress left out', () => {
    expect(
      redressAverage([
        { points: 1, averaged: false },
        { points: 2, averaged: false },
        { points: 9, averaged: true },
      ]),
    ).toBe(1.5);
    expect(redressAverage([{ points: 4, averaged: true }])).toBeNull();
    expect(redressAverage([])).toBeNull();
  });
});

describe('SHRS 5.4 discards', () => {
  it('standard: one after 4 races, two after 8, one more per 8', () => {
    const standard = { kind: 'standard' as const };
    expect(
      [3, 4, 7, 8, 15, 16, 24].map((n) => discardCount(n, standard)),
    ).toEqual([0, 1, 1, 2, 2, 3, 4]);
  });

  it('a race committee profile, thresholds, or none', () => {
    expect(
      discardCount(6, { kind: 'custom', first: 3, second: 6, every: 3 }),
    ).toBe(2);
    expect(discardCount(5, { kind: 'thresholds', at: [2, 5, 9] })).toBe(2);
    expect(discardCount(40, { kind: 'none' })).toBe(0);
  });

  it('the worst scores, the earliest of equal worst, never DNE / DGM', () => {
    const scores = [
      { points: 5, order: 1 },
      { points: 9, order: 2 },
      { points: 9, order: 3 },
      { points: 11, code: 'DNE', order: 4 },
    ];
    expect(excludedScores(scores, 1)).toEqual(new Set([1]));
    expect(excludedScores(scores, 2)).toEqual(new Set([1, 2]));
    expect([...NOT_EXCLUDABLE].sort()).toEqual(['DGM', 'DNE']);
  });

  it('a boat always keeps one score', () => {
    expect(excludedScores([{ points: 3, order: 1 }], 1)).toEqual(new Set());
    expect(
      excludedScores(
        [
          { points: 3, order: 1 },
          { points: 4, order: 2 },
        ],
        5,
      ),
    ).toEqual(new Set([1]));
  });
});
