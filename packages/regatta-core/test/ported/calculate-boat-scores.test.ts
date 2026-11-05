/**
 * Ported from the app's src/__tests__/calculateBoatScores.test.ts (the old
 * qualifying series ranking: SHRS 5.4 discards, RRS A8 / SHRS 5.7 ties).
 * The old tests fed points straight into a mocked database; here each
 * scenario is a decision log whose races give the same points.
 *
 * Already covered elsewhere, so not repeated here: no discard below 4 races
 * and one at 4 (event.test.ts, "one fleet"), the 7 / 15 race boundaries and
 * the earliest of equal worst scores (rules.test.ts, "SHRS 5.4 discards"),
 * a boat always keeping one score (rules.test.ts), plain ranking by total
 * (event.test.ts), A8.1 on the best score (decided-rules.test.ts, R8 one
 * fleet), and the higher place settled first (rules.test.ts, "ranking").
 */
import {
  qualifyingStandings,
  qualifyingTieBreak,
  type Decision,
  type DiscardProfile,
  type EventState,
} from '../../src';
import { enter, protest, sheet, stateOf } from './helpers';

/**
 * A heat's sheet with some boats on given places ("DNF" etc. for a code);
 * the other boats fill the free places in the order listed.
 */
function race(
  heat: string,
  n: number,
  boatsInHeat: string[],
  fixed: Record<string, number | string>,
): Decision {
  const coded = boatsInHeat.filter((b) => typeof fixed[b] === 'string');
  const finishers = boatsInHeat.filter((b) => typeof fixed[b] !== 'string');
  const slots: (string | undefined)[] = new Array(finishers.length);
  finishers.forEach((b) => {
    if (typeof fixed[b] === 'number') slots[(fixed[b] as number) - 1] = b;
  });
  const free = finishers.filter((b) => typeof fixed[b] !== 'number');
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === undefined) slots[i] = free.shift();
  }
  return sheet(
    heat,
    n,
    ...(slots as string[]),
    ...coded.map((b) => `${b}:${fixed[b]}`),
  );
}

const fillers = (prefix: string, n: number) =>
  Array.from({ length: n }, (_v, i) => `${prefix}${i + 1}`);

/** One heat (a single-fleet event): `places[boat]` race by race. */
function oneFleet(
  places: Record<string, (number | string)[]>,
  size: number,
  discards?: DiscardProfile,
): EventState {
  const named = Object.keys(places);
  const heat = [...named, ...fillers('f', size - named.length)];
  const races = Math.max(...named.map((b) => places[b].length));
  return stateOf([
    ...(discards
      ? [
          {
            type: 'settingsChanged',
            settings: { discards: { qualifying: discards, final: discards } },
          } as Decision,
        ]
      : []),
    ...heat.map((id, i) => enter(id, 'CRO', String(i + 1))),
    { type: 'heatsCreated', heatCount: 1 },
    ...Array.from({ length: races }, (_v, r) =>
      race(
        'A1',
        r + 1,
        heat,
        Object.fromEntries(named.map((b) => [b, places[b][r]])),
      ),
    ),
  ]);
}

/**
 * Pre-assigned heats (SHRS 3.2), the same in every round, one race per
 * round; `places[boat]` race by race, in her heat.
 */
function preAssigned(
  heats: string[][],
  places: Record<string, (number | string)[]>,
): EventState {
  const named = Object.keys(places);
  const rounds = Math.max(...named.map((b) => places[b].length));
  const log: Decision[] = [
    { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
    ...heats.flat().map((id, i) => enter(id, 'CRO', String(i + 1))),
    { type: 'heatsCreated', heatCount: heats.length, heats },
  ];
  for (let r = 1; r <= rounds; r += 1) {
    if (r > 1) log.push({ type: 'roundCreated' });
    heats.forEach((boatsInHeat, h) => {
      const fixed = Object.fromEntries(
        named
          .filter((b) => boatsInHeat.includes(b))
          .map((b) => [b, places[b][r - 1]]),
      );
      log.push(race(`${'ABCDEFGH'[h]}${r}`, 1, boatsInHeat, fixed));
    });
  }
  return stateOf(log);
}

const standing = (state: EventState, boat: string) =>
  qualifyingStandings(state).standings.find((s) => s.boat === boat)!;

const order = (state: EventState, boats: string[]) =>
  qualifyingStandings(state)
    .standings.filter((s) => boats.includes(s.boat))
    .map((s) => s.boat);

describe('SHRS 5.4 discards in a series', () => {
  it('SHRS 5.4: 2 discards at 8 races', () => {
    const state = oneFleet({ x: [9, 8, 7, 6, 5, 4, 3, 2] }, 10);
    expect(standing(state, 'x').total).toBe(7 + 6 + 5 + 4 + 3 + 2);
  });

  it('SHRS 5.4: 3 discards at 16 races', () => {
    const places = Array.from({ length: 16 }, (_v, i) => 16 - i);
    const state = oneFleet({ x: places }, 16);
    // 16, 15, 14 out: 13 + 12 + … + 1.
    expect(standing(state, 'x').total).toBe(91);
  });

  it.each([
    [32, 5],
    [40, 6],
  ])(
    'SHRS 5.4: one more discard per 8 races: %i races exclude %i',
    (races, discards) => {
      // 3 boats, DNF = 4. x is DNF in 7 races and 1st in the rest.
      const x = Array.from({ length: races }, (_v, i) => (i < 7 ? 'DNF' : 1));
      const state = oneFleet({ x }, 3);
      const kept = 7 - discards;
      expect(standing(state, 'x').total).toBe(races - 7 + kept * 4);
      expect(
        standing(state, 'x').scores.filter((s) => s.excluded),
      ).toHaveLength(discards);
    },
  );

  it('SHRS 5.4: the count is the series races completed, so a late entry discards her DNC', () => {
    // b joins after race 1: DNC there (RRS A5.1, largest heat 3 -> 4 points).
    // 4 races completed: one discard for every boat, her DNC included.
    const state = stateOf([
      enter('a', 'CRO', '1'),
      enter('f', 'CRO', '2'),
      { type: 'heatsCreated', heatCount: 1 },
      enter('b', 'CRO', '3'),
      sheet('A1', 1, 'a', 'f'),
      { type: 'boatAssigned', boat: 'b', heat: 'A1' },
      sheet('A1', 2, 'b', 'a', 'f'),
      sheet('A1', 3, 'b', 'a', 'f'),
      sheet('A1', 4, 'b', 'a', 'f'),
    ]);
    const b = standing(state, 'b');
    expect(b.scores.map((s) => [s.code, s.points, s.excluded])).toEqual([
      ['DNC', 4, true],
      [undefined, 1, false],
      [undefined, 1, false],
      [undefined, 1, false],
    ]);
    expect(b.total).toBe(3);
  });

  it('RRS 90.3(b): DNE and DGM are never excluded, the next worst is', () => {
    // 4 boats, DNF = 5. x: DNE, DGM (both by the protest committee), 3, 1.
    const state = stateOf([
      ...['x', 'f1', 'f2', 'f3'].map((id, i) =>
        enter(id, 'CRO', String(i + 1)),
      ),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'x', 'f1', 'f2', 'f3'),
      sheet('A1', 2, 'x', 'f1', 'f2', 'f3'),
      sheet('A1', 3, 'f1', 'f2', 'x', 'f3'),
      sheet('A1', 4, 'x', 'f1', 'f2', 'f3'),
      protest('A1', 1, 'x', { kind: 'DNE' }),
      protest('A1', 2, 'x', { kind: 'DGM' }),
    ]);
    const x = standing(state, 'x');
    expect(x.scores.map((s) => [s.code, s.points, s.excluded])).toEqual([
      ['DNE', 5, false],
      ['DGM', 5, false],
      [undefined, 3, true],
      [undefined, 1, false],
    ]);
    expect(x.total).toBe(11);
  });

  it('SHRS 5.4 changed by the race committee: first 3, second 6, every 6 gives 2 discards at 6 races', () => {
    const state = oneFleet({ x: [9, 8, 7, 6, 5, 4] }, 10, {
      kind: 'custom',
      first: 3,
      second: 6,
      every: 6,
    });
    expect(standing(state, 'x').total).toBe(7 + 6 + 5 + 4);
  });

  it('SHRS 5.4 changed by the race committee: thresholds 3, 5, 6 give 3 discards at 6 races', () => {
    const state = oneFleet({ x: [10, 9, 8, 7, 6, 5] }, 10, {
      kind: 'thresholds',
      at: [3, 5, 6],
    });
    expect(standing(state, 'x').total).toBe(7 + 6 + 5);
  });

  it('SHRS 5.4 changed by the race committee: an empty threshold list excludes nothing', () => {
    const state = oneFleet({ x: [9, 8, 7, 6, 5, 4, 3, 2] }, 10, {
      kind: 'thresholds',
      at: [],
    });
    expect(standing(state, 'x').total).toBe(44);
    expect(standing(state, 'x').scores.some((s) => s.excluded)).toBe(false);
  });
});

describe('RRS A7 shared points in totals and ties', () => {
  it('RRS A7 / SHRS 5.4: half points add up, and the earliest equal worst 4.5 is excluded', () => {
    // x ties for 4th in races 1 and 2: 4.5 each; then 3, 2, 1.
    const heat = ['x', 'f1', 'f2', 'f3', 'f4', 'f5'];
    const state = stateOf([
      ...heat.map((id, i) => enter(id, 'CRO', String(i + 1))),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'f1', 'f2', 'f3', 'x', '=f4', 'f5'),
      sheet('A1', 2, 'f1', 'f2', 'f3', 'x', '=f4', 'f5'),
      sheet('A1', 3, 'f1', 'f2', 'x', 'f3', 'f4', 'f5'),
      sheet('A1', 4, 'f1', 'x', 'f2', 'f3', 'f4', 'f5'),
      sheet('A1', 5, 'x', 'f1', 'f2', 'f3', 'f4', 'f5'),
    ]);
    const x = standing(state, 'x');
    expect(x.scores.map((s) => [s.points, s.excluded])).toEqual([
      [4.5, true],
      [4.5, false],
      [3, false],
      [2, false],
      [1, false],
    ]);
    expect(x.total).toBe(10.5);
  });

  it('SHRS 5.7(i), RRS A8.1: compares half points as numbers (1, 2.5, 4 beats 1, 3, 3.5)', () => {
    const heat = ['a', 'b', 'f1', 'f2', 'f3', 'f4'];
    const state = stateOf([
      ...heat.map((id, i) => enter(id, 'CRO', String(i + 1))),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'f1', 'f2', 'b', 'a', 'f3', 'f4'),
      sheet('A1', 2, 'a', 'f1', 'b', '=f2', 'f3', 'f4'),
      sheet('A1', 3, 'b', 'a', '=f1', 'f2', 'f3', 'f4'),
    ]);
    expect(standing(state, 'a').total).toBe(7.5);
    expect(standing(state, 'b').total).toBe(7.5);
    expect(order(state, ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('SHRS 5.7(i): a single-heat event, RRS A8.1 then A8.2', () => {
  it('RRS A8.1: decided on the second-best score when the best are equal', () => {
    // a: 1, 2, 4; b: 3, 1, 3. Both 7: 1, 2, 4 against 1, 3, 3.
    const state = stateOf([
      ...['a', 'b', 'f1', 'f2'].map((id, i) => enter(id, 'CRO', String(i + 1))),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'a', 'f1', 'b', 'f2'),
      sheet('A1', 2, 'b', 'a', 'f1', 'f2'),
      sheet('A1', 3, 'f1', 'f2', 'b', 'a'),
    ]);
    expect(
      qualifyingStandings(state).standings.map((s) => [
        s.boat,
        s.total,
        s.place,
      ]),
    ).toEqual([
      ['f1', 6, 1],
      ['a', 7, 2],
      ['b', 7, 3],
      ['f2', 10, 4],
    ]);
  });

  it('RRS A8.2: equal scores, the last race decides', () => {
    // a: 1, 3; b: 3, 1; f: 2, 2. All 4: f loses A8.1, b wins the last race.
    const state = stateOf([
      ...['a', 'b', 'f'].map((id, i) => enter(id, 'CRO', String(i + 1))),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'a', 'f', 'b'),
      sheet('A1', 2, 'b', 'f', 'a'),
    ]);
    expect(
      qualifyingStandings(state).standings.map((s) => [s.boat, s.place]),
    ).toEqual([
      ['b', 1],
      ['a', 2],
      ['f', 3],
    ]);
  });

  it('RRS A8.2: a three-way tie with equal scores is ordered by the last race', () => {
    // a: 1, 2, 3; b: 2, 3, 1; c: 3, 1, 2.
    const state = stateOf([
      ...['a', 'b', 'c'].map((id, i) => enter(id, 'CRO', String(i + 1))),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'a', 'b', 'c'),
      sheet('A1', 2, 'c', 'a', 'b'),
      sheet('A1', 3, 'b', 'c', 'a'),
    ]);
    expect(
      qualifyingStandings(state).standings.map((s) => [
        s.boat,
        s.total,
        s.place,
      ]),
    ).toEqual([
      ['b', 6, 1],
      ['c', 6, 2],
      ['a', 6, 3],
    ]);
  });

  it('a boat alone in the event is first', () => {
    const state = oneFleet({ x: [1, 1, 1] }, 1);
    expect(qualifyingStandings(state).standings).toMatchObject([
      { boat: 'x', place: 1, total: 3 },
    ]);
  });
});

describe('SHRS 5.7(ii): several heats', () => {
  it('5.7(ii)(1): only the races sailed in the same heat count, even when the other races favour the other boat', () => {
    // Two heats of 8 (DNF 9). e and u meet in rounds 1 and 2 only.
    // e: 3, 7 | 2, 4, DNF; u: 4, 6 | 1, 5, DNF. Both 16 (DNF excluded).
    // Shared: 3, 7 against 4, 6 -> e. All kept scores would favour u (1).
    const f = fillers('f', 14);
    const together = [['e', 'u', ...f.slice(0, 6)], f.slice(6)];
    const apart = [
      ['e', ...f.slice(0, 7)],
      ['u', ...f.slice(7)],
    ];
    const log: Decision[] = [
      ...['e', 'u', ...f].map((id, i) => enter(id, 'CRO', String(i + 1))),
      { type: 'heatsCreated', heatCount: 2, heats: together },
      race('A1', 1, together[0], { e: 3, u: 4 }),
      race('B1', 1, together[1], {}),
      { type: 'roundCreated', heats: together },
      race('A2', 1, together[0], { e: 7, u: 6 }),
      race('B2', 1, together[1], {}),
    ];
    [3, 4, 5].forEach((round, i) => {
      log.push({ type: 'roundCreated', heats: apart });
      const [e, u] = [
        [2, 1],
        [4, 5],
        ['DNF', 'DNF'],
      ][i];
      log.push(race(`A${round}`, 1, apart[0], { e }));
      log.push(race(`B${round}`, 1, apart[1], { u }));
    });
    const state = stateOf(log);
    expect(standing(state, 'e').total).toBe(16);
    expect(standing(state, 'u').total).toBe(16);
    expect(qualifyingTieBreak(state)('e', 'u')).toBeLessThan(0);
    expect(standing(state, 'e').place).toBeLessThan(standing(state, 'u').place);
  });

  it('5.7(ii)(2): excluded scores count for boats that sailed every race together in a multi-heat event', () => {
    // a and b share heat A every round, c sails in heat B: a multi-heat
    // event. Heats of 8 (DNF 9), 4 races, one discard.
    // a: DNF, 3, 2, 1 = 6; b: 7, 1, 3, 2 = 6. Kept scores equal (1, 2, 3);
    // with the excluded ones 9 against 7, so b. Plain A8.2 would pick a.
    const f = fillers('f', 13);
    const heats = [
      ['a', 'b', ...f.slice(0, 6)],
      ['c', ...f.slice(6)],
    ];
    const state = preAssigned(heats, {
      a: ['DNF', 3, 2, 1],
      b: [7, 1, 3, 2],
      c: [1, 1, 1, 2],
    });
    expect(standing(state, 'a').total).toBe(6);
    expect(standing(state, 'b').total).toBe(6);
    expect(standing(state, 'c').total).toBe(3);
    expect(order(state, ['a', 'b', 'c'])).toEqual(['c', 'b', 'a']);
  });

  it('5.7(ii)(4): boats that never met are ranked by plain RRS A8.1 on kept scores', () => {
    // Heats of 8 (DNF 9), 4 races, one discard. a: 1, 2, 5, DNF = 8;
    // b: 1, 3, 4, 6 = 8. Kept 1, 2, 5 against 1, 3, 4 -> a.
    const f = fillers('f', 14);
    const heats = [
      ['a', ...f.slice(0, 7)],
      ['b', ...f.slice(7)],
    ];
    const state = preAssigned(heats, {
      a: [1, 2, 5, 'DNF'],
      b: [1, 3, 4, 6],
    });
    expect(standing(state, 'a').total).toBe(8);
    expect(standing(state, 'b').total).toBe(8);
    expect(qualifyingTieBreak(state)('a', 'b')).toBeLessThan(0);
    expect(standing(state, 'a').place).toBeLessThan(standing(state, 'b').place);
  });

  it('5.7(ii)(4): boats that never met: equal kept scores go to A8.2, excluded scores are not used in A8.1', () => {
    // Heats of 9 (DNF 10), 8 races, two discards. a: DNF, DNF, 3, 2, 2, 1, 1,
    // 1; b: 4, 4, 3, 2, 1, 1, 1, 2. Both keep 1, 1, 1, 2, 2, 3 = 10. Plain
    // A8.1 is level; A8.2, last race: 1 against 2 -> a. Using the excluded
    // scores (10, 10 against 4, 4) would wrongly pick b.
    const f = fillers('f', 16);
    const heats = [
      ['a', ...f.slice(0, 8)],
      ['b', ...f.slice(8)],
    ];
    const state = preAssigned(heats, {
      a: ['DNF', 'DNF', 3, 2, 2, 1, 1, 1],
      b: [4, 4, 3, 2, 1, 1, 1, 2],
    });
    expect(standing(state, 'a').total).toBe(10);
    expect(standing(state, 'b').total).toBe(10);
    expect(qualifyingTieBreak(state)('a', 'b')).toBeLessThan(0);
    expect(standing(state, 'a').place).toBeLessThan(standing(state, 'b').place);
  });
});
