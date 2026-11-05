/**
 * Ported from the app's src/__tests__/SHRS_comprehensive.test.ts (deleted
 * with the old scoring engine). The old tests fed points straight into the
 * engine through SQL mocks; here every scenario is a decision log whose
 * races give the same rule situation. Where the old points could not be
 * sailed (two boats on one place in one heat, places past the heat size),
 * the races were rebuilt with ties at the finish or other places, keeping
 * the rule being tested and the outcome.
 *
 * Old scenarios already covered elsewhere in the library suite are not
 * repeated; renderer utilities (applyExclusions, parseRaceNum) are not
 * library concerns.
 */
import {
  finalStandings,
  qualifyingStandings,
  type Decision,
  type EventState,
} from '../../src';
import { enter, refusal, sheet, stateOf } from './helpers';

/** Boats with the given ids, CRO, sail number = position in the list. */
const entries = (ids: string[]): Decision[] =>
  ids.map((id, i) => enter(id, 'CRO', String(i + 1)));

/**
 * A finishing order for a heat of `all` boats: `slots` fixes who is in
 * which place (a '=' prefix ties her with the place above), `codes` are
 * no-place lines ('b:DNF') at the end; the other boats fill the free places
 * in list order.
 */
function order(
  all: readonly string[],
  slots: Record<number, string>,
  codes: string[] = [],
): string[] {
  const named = new Set(
    [...Object.values(slots), ...codes].map((s) =>
      s.replace(/^=/, '').replace(/:.*$/, ''),
    ),
  );
  const pool = all.filter((id) => !named.has(id));
  const finishers = all.length - codes.length;
  const out: string[] = [];
  for (let place = 1; place <= finishers; place += 1) {
    out.push(slots[place] ?? pool.shift()!);
  }
  return [...out, ...codes];
}

const race = (
  heat: string,
  n: number,
  all: readonly string[],
  slots: Record<number, string>,
  codes: string[] = [],
): Decision => sheet(heat, n, ...order(all, slots, codes));

const fillers = (prefix: string, n: number) =>
  Array.from({ length: n }, (_v, i) => `${prefix}${i + 1}`);

const standing = (state: EventState, boat: string) =>
  qualifyingStandings(state).standings.find((s) => s.boat === boat)!;

const places = (state: EventState) =>
  Object.fromEntries(
    qualifyingStandings(state).standings.map((s) => [s.boat, s.place]),
  );

/** The boats' places in this order, each strictly behind the one before. */
const inOrder = (state: EventState, ...ids: string[]) => {
  const p = places(state);
  ids.slice(1).forEach((id, i) => {
    expect(p[id]).toBeGreaterThan(p[ids[i]]);
  });
};

/** One heat of `ids`, then the races. */
const oneHeat = (ids: string[], races: Decision[]): Decision[] => [
  ...entries(ids),
  { type: 'heatsCreated', heatCount: 1 },
  ...races,
];

/**
 * Several heats, each round's heats as given (a converted record), one race
 * per heat per round, every round `rounds[r][h]` the finishing order of
 * heat h. Lets a scenario say exactly who met whom.
 */
function heatsByRound(
  ids: string[],
  rounds: Array<{ heats: string[][]; orders: string[][] }>,
): Decision[] {
  const log: Decision[] = [...entries(ids)];
  rounds.forEach(({ heats, orders }, r) => {
    log.push(
      r === 0
        ? { type: 'heatsCreated', heatCount: heats.length, heats }
        : { type: 'roundCreated', heats },
    );
    orders.forEach((o, h) => {
      log.push(sheet(`${String.fromCharCode(65 + h)}${r + 1}`, 1, ...o));
    });
  });
  return log;
}

describe('RRS A4: low point', () => {
  it('RRS A4: in a heat of 20 every place scores its number', () => {
    const ids = fillers('b', 20);
    const state = stateOf(oneHeat(ids, [sheet('A1', 1, ...ids)]));
    ids.forEach((id, i) => {
      expect(standing(state, id)).toMatchObject({ total: i + 1, place: i + 1 });
    });
  });
});

describe('SHRS 5.4: discards applied to the qualifying series', () => {
  // Two boats, one heat; b1 is DNF (3 points) in the first `discards` races
  // and wins the rest, so her total is the number of races she won only if
  // exactly `discards` scores are excluded.
  const series = (races: number, dnfs: number) =>
    stateOf(
      oneHeat(
        ['b1', 'b2'],
        Array.from({ length: races }, (_v, i) =>
          i < dnfs
            ? sheet('A1', i + 1, 'b2', 'b1:DNF')
            : sheet('A1', i + 1, 'b1', 'b2'),
        ),
      ),
    );

  it.each([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [5, 1],
    [6, 1],
    [7, 1],
    [8, 2],
    [9, 2],
    [10, 2],
    [15, 2],
    [16, 3],
    [17, 3],
    [23, 3],
    [24, 4],
    [25, 4],
    [31, 4],
    [32, 5],
    [33, 5],
    [39, 5],
    [40, 6],
    [41, 6],
    [47, 6],
    [48, 7],
    [56, 8],
    [64, 9],
    [72, 10],
    [80, 11],
  ])('SHRS 5.4: %i races, %i discards', (races, discards) => {
    const b1 = standing(series(races, discards), 'b1');
    expect(b1.total).toBe(races - discards);
    expect(b1.scores.filter((s) => s.excluded)).toHaveLength(discards);
    expect(
      b1.scores.filter((s) => s.excluded).every((s) => s.code === 'DNF'),
    ).toBe(true);
  });

  it('SHRS 5.4: no race completed, no series score', () => {
    expect(
      qualifyingStandings(stateOf(oneHeat(['b1', 'b2'], []))).standings,
    ).toEqual([]);
  });

  it('SHRS 5.4: a penalty score (DNS) is excluded like any other', () => {
    const state = stateOf(
      oneHeat(
        ['b1', 'b2'],
        [
          sheet('A1', 1, 'b1', 'b2'),
          sheet('A1', 2, 'b1', 'b2'),
          sheet('A1', 3, 'b1', 'b2'),
          sheet('A1', 4, 'b2', 'b1:DNS'),
        ],
      ),
    );
    expect(standing(state, 'b1').total).toBe(3);
  });

  it('SHRS 5.4: equal scores in all 8 races, 2 of them excluded', () => {
    const ids = fillers('b', 6);
    const races = Array.from({ length: 8 }, (_v, i) =>
      race('A1', i + 1, ids, { 5: 'b1' }),
    );
    expect(standing(stateOf(oneHeat(ids, races)), 'b1').total).toBe(30);
  });
});

describe('SHRS 5.4: the Final Series counts its own races', () => {
  // Two heats of two boats, pre-assigned, 8 qualifying races (2 discards
  // there). Gold is b1 and b2; b1 is DNF (3 points) in the first
  // `discards` Gold races and wins the rest.
  const qualifying: Decision[] = [
    { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
    ...entries(['b1', 'b2', 'b3', 'b4']),
    {
      type: 'heatsCreated',
      heatCount: 2,
      heats: [
        ['b1', 'b3'],
        ['b2', 'b4'],
      ],
    },
    ...Array.from({ length: 8 }, (_v, r): Decision[] => [
      ...(r > 0 ? [{ type: 'roundCreated' } as Decision] : []),
      sheet(`A${r + 1}`, 1, 'b1', 'b3'),
      sheet(`B${r + 1}`, 1, 'b2', 'b4'),
    ]).flat(),
    { type: 'finalSeriesStarted' },
  ];

  it('the split puts b1 and b2 in Gold', () => {
    const state = stateOf(qualifying);
    expect(qualifyingStandings(state).completedRaces).toBe(8);
    expect([...state.fleets![0].boats].sort()).toEqual(['b1', 'b2']);
  });

  it.each([
    [3, 0],
    [4, 1],
    [8, 2],
    [16, 3],
  ])(
    'SHRS 5.4: %i final races, %i discards, whatever the qualifying had',
    (races, discards) => {
      const state = stateOf([
        ...qualifying,
        ...Array.from({ length: races }, (_v, i) =>
          i < discards
            ? sheet('Gold', i + 1, 'b2', 'b1:DNF')
            : sheet('Gold', i + 1, 'b1', 'b2'),
        ),
      ]);
      const b1 = finalStandings(state)[0].standings.find(
        (s) => s.boat === 'b1',
      )!;
      expect(b1.total).toBe(races - discards);
      expect(b1.scores.filter((s) => s.excluded)).toHaveLength(discards);
    },
  );
});

describe('SHRS 5.2 / RRS A8: boats with the same no-place score', () => {
  it('RRS A8: three DSQs on the same points share 3rd', () => {
    const state = stateOf(
      oneHeat(
        ['f1', 'f2', 'd1', 'd2', 'd3'],
        [sheet('A1', 1, 'f1', 'f2', 'd1:DSQ', 'd2:DSQ', 'd3:DSQ')],
      ),
    );
    expect(standing(state, 'd1').total).toBe(6);
    expect(places(state)).toEqual({ f1: 1, f2: 2, d1: 3, d2: 3, d3: 3 });
  });

  it('SHRS 5.3: the recording order of DNF, DNS, DSQ does not split a series tie', () => {
    const state = stateOf(
      oneHeat(
        ['fin1', 'fin2', 'dnf', 'dsq', 'dns'],
        [sheet('A1', 1, 'fin1', 'fin2', 'dnf:DNF', 'dsq:DSQ', 'dns:DNS')],
      ),
    );
    expect(places(state)).toEqual({
      fin1: 1,
      fin2: 2,
      dnf: 3,
      dsq: 3,
      dns: 3,
    });
  });

  it('SHRS 5.2: every boat DNF in a race, the other race decides', () => {
    const state = stateOf(
      oneHeat(
        ['b1', 'b2', 'b3'],
        [
          sheet('A1', 1, 'b1', 'b2', 'b3'),
          sheet('A1', 2, 'b1:DNF', 'b2:DNF', 'b3:DNF'),
        ],
      ),
    );
    expect(
      qualifyingStandings(state).standings.map((s) => [
        s.boat,
        s.total,
        s.place,
      ]),
    ).toEqual([
      ['b1', 5, 1],
      ['b2', 6, 2],
      ['b3', 7, 3],
    ]);
  });
});

describe('SHRS 5.7(i): a single-heat event, RRS A8.1 then A8.2', () => {
  const six = fillers('x', 4);

  it('RRS A8.1: the better best score wins (a 1, 4 against b 2, 3)', () => {
    const ids = ['a', 'b', ...six];
    const state = stateOf(
      oneHeat(ids, [
        race('A1', 1, ids, { 4: 'a', 3: 'b' }),
        race('A1', 2, ids, { 1: 'a', 2: 'b' }),
      ]),
    );
    expect(standing(state, 'a').total).toBe(5);
    expect(standing(state, 'b').total).toBe(5);
    inOrder(state, 'a', 'b');
  });

  // Assertions are in inOrder.
  // eslint-disable-next-line jest/expect-expect
  it('RRS A8.1: equal best scores, the second-best decides', () => {
    // a 1, 2, 4 against b 1, 3, 3.
    const ids = ['a', 'b', ...six];
    const state = stateOf(
      oneHeat(ids, [
        race('A1', 1, ids, { 1: 'a', 3: 'b' }),
        race('A1', 2, ids, { 2: 'a', 1: 'b' }),
        race('A1', 3, ids, { 4: 'a', 3: 'b' }),
      ]),
    );
    inOrder(state, 'a', 'b');
  });

  it('RRS A8.1: a three-way tie (2, 3, 4 / 1, 3, 5 / 1, 2, 6) is ranked c, b, a', () => {
    const ids = ['a', 'b', 'c', ...six];
    const state = stateOf(
      oneHeat(ids, [
        race('A1', 1, ids, { 4: 'a', 1: 'b', 2: 'c' }),
        race('A1', 2, ids, { 3: 'a', 5: 'b', 1: 'c' }),
        race('A1', 3, ids, { 2: 'a', 3: 'b', 6: 'c' }),
      ]),
    );
    expect(['a', 'b', 'c'].map((id) => standing(state, id).total)).toEqual([
      9, 9, 9,
    ]);
    inOrder(state, 'c', 'b', 'a');
  });

  // Assertions are in inOrder.
  // eslint-disable-next-line jest/expect-expect
  it('RRS A8.1: 2, 3, 6 against 1, 5, 5, the 1 wins', () => {
    const ids = ['a', 'b', ...six];
    const state = stateOf(
      oneHeat(ids, [
        race('A1', 1, ids, { 2: 'a', 1: 'b' }),
        race('A1', 2, ids, { 3: 'a', 5: 'b' }),
        race('A1', 3, ids, { 6: 'a', 5: 'b' }),
      ]),
    );
    inOrder(state, 'b', 'a');
  });

  // Assertions are in inOrder.
  // eslint-disable-next-line jest/expect-expect
  it('RRS A8.2: the same scores, the better last race wins', () => {
    const ids = ['a', 'b', 'c'];
    const state = stateOf(
      oneHeat(ids, [
        sheet('A1', 1, 'a', 'c', 'b'),
        sheet('A1', 2, 'b', 'c', 'a'),
      ]),
    );
    inOrder(state, 'b', 'a');
  });

  it('RRS A8.2: level in the last race, the race before decides', () => {
    // a 1, 2, 1.5 and b 2, 1, 1.5 (tied for 1st in the last race).
    const state = stateOf(
      oneHeat(
        ['a', 'b'],
        [
          sheet('A1', 1, 'a', 'b'),
          sheet('A1', 2, 'b', 'a'),
          sheet('A1', 3, 'a', '=b'),
        ],
      ),
    );
    expect(places(state)).toEqual({ b: 1, a: 2 });
  });

  it('RRS A8.2: a three-way tie is walked back race by race', () => {
    // Every boat 1, 2.5, 2.5 (ties at the finish). Last race: c 1, a and b
    // 2.5; the race before: b 1, a 2.5. So c, b, a.
    const state = stateOf(
      oneHeat(
        ['a', 'b', 'c'],
        [
          sheet('A1', 1, 'a', 'b', '=c'),
          sheet('A1', 2, 'b', 'a', '=c'),
          sheet('A1', 3, 'c', 'a', '=b'),
        ],
      ),
    );
    expect(['a', 'b', 'c'].map((id) => standing(state, id).total)).toEqual([
      6, 6, 6,
    ]);
    expect(places(state)).toEqual({ c: 1, b: 2, a: 3 });
  });

  it('RRS A8.1: excluded scores are left out (4 races, 1 discard), so A8.2 decides', () => {
    // a 6, 2, 1, 3.5 and b 5, 1, 2, 3.5 (tied for 3rd in race 4): both
    // keep 1, 2, 3.5. A8.2: race 4 level, race 3 a 1 against b 2, so a.
    // Counting the excluded 6 and 5 in A8.1 would have put b ahead.
    const ids = ['a', 'b', ...six];
    const state = stateOf(
      oneHeat(ids, [
        race('A1', 1, ids, { 5: 'b', 6: 'a' }),
        race('A1', 2, ids, { 1: 'b', 2: 'a' }),
        race('A1', 3, ids, { 1: 'a', 2: 'b' }),
        race('A1', 4, ids, { 3: 'a', 4: '=b' }),
      ]),
    );
    expect(standing(state, 'a').total).toBe(6.5);
    expect(standing(state, 'b').total).toBe(6.5);
    inOrder(state, 'a', 'b');
  });

  it('RRS A8.1 then A8.2 (8 races, 2 discards): excluded scores only in A8.2', () => {
    // a 10, 9, then 1.5 six times (tied 1st with b); b 8, 11, then 1.5.
    // Kept scores equal; A8.2 reaches race 2: a 9 against b 11, so a.
    // Counting the excluded scores in A8.1 would have put b ahead (8 < 9).
    const ids = ['a', 'b', ...fillers('x', 10)];
    const state = stateOf(
      oneHeat(ids, [
        race('A1', 1, ids, { 10: 'a', 8: 'b' }),
        race('A1', 2, ids, { 9: 'a', 11: 'b' }),
        ...[3, 4, 5, 6, 7, 8].map((n) =>
          race('A1', n, ids, { 1: 'a', 2: '=b' }),
        ),
      ]),
    );
    expect(standing(state, 'a').total).toBe(9);
    expect(standing(state, 'b').total).toBe(9);
    inOrder(state, 'a', 'b');
  });

  it('RRS A8: two boats level at every finish share the place', () => {
    const state = stateOf(
      oneHeat(
        ['a', 'b', 'c', 'd'],
        [
          sheet('A1', 1, 'a', '=b', 'c', 'd'),
          sheet('A1', 2, 'a', '=b', 'c', 'd'),
        ],
      ),
    );
    expect(places(state)).toEqual({ a: 1, b: 1, c: 3, d: 4 });
  });

  it('RRS A8.2: 20 boats, 8 races, a tie on kept scores; every place distinct', () => {
    // b1..b18 finish in their number every race (6 x n kept). b19 and b20
    // alternate 19th/20th: both keep 4 x 19 + 2 x 20 = 116; in the last
    // race b20 was 19th, so b20 is ahead.
    const ids = fillers('b', 20);
    const races = Array.from({ length: 8 }, (_v, i) =>
      i % 2 === 0
        ? sheet('A1', i + 1, ...ids)
        : sheet('A1', i + 1, ...ids.slice(0, 18), 'b20', 'b19'),
    );
    const state = stateOf(oneHeat(ids, races));
    const q = qualifyingStandings(state).standings;
    expect(q.map((s) => s.place)).toEqual(ids.map((_id, i) => i + 1));
    expect(standing(state, 'b19').total).toBe(116);
    expect(standing(state, 'b20').total).toBe(116);
    expect(places(state)).toMatchObject({ b20: 19, b19: 20 });
  });

  it('a single boat is 1st with every score counted', () => {
    const state = stateOf(
      oneHeat(
        ['solo'],
        [
          sheet('A1', 1, 'solo'),
          sheet('A1', 2, 'solo'),
          sheet('A1', 3, 'solo'),
        ],
      ),
    );
    expect(standing(state, 'solo')).toMatchObject({ place: 1, total: 3 });
  });
});

describe('SHRS 5.7(ii): several heats', () => {
  it('SHRS 5.7(ii)(2): boats that met are compared with their excluded scores', () => {
    // 8 rounds, two heats of 10; a and b always in heat A (DNF 11).
    //   a: 8, DNF, 6, 5.5 x4, 4   (excludes 11, 8) = 32
    //   b: 7, DNF, 4, 5.5 x4, 6   (excludes 11, 7) = 32
    // Kept scores are equal and the last race favours a, so plain A8 would
    // put a ahead; with every score (5.7(ii)(2)) b's 7 beats a's 8.
    const heatA = ['a', 'b', ...fillers('p', 8)];
    const heatB = fillers('q', 10);
    const slots: Array<Record<number, string>> = [
      { 8: 'a', 7: 'b' },
      {},
      { 6: 'a', 4: 'b' },
      { 5: 'a', 6: '=b' },
      { 5: 'a', 6: '=b' },
      { 5: 'a', 6: '=b' },
      { 5: 'a', 6: '=b' },
      { 4: 'a', 6: 'b' },
    ];
    const log = heatsByRound(
      [...heatA, ...heatB],
      slots.map((s, r) => ({
        heats: [heatA, heatB],
        orders: [
          r === 1 ? order(heatA, {}, ['a:DNF', 'b:DNF']) : order(heatA, s),
          heatB,
        ],
      })),
    );
    const state = stateOf(log);
    expect(standing(state, 'a').total).toBe(32);
    expect(standing(state, 'b').total).toBe(32);
    expect(places(state).b).toBeLessThan(places(state).a);
  });

  it('SHRS 5.7(i) for contrast: the same races in a single-heat event go to a', () => {
    const ids = ['a', 'b', ...fillers('p', 8)];
    const slots: Array<Record<number, string>> = [
      { 8: 'a', 7: 'b' },
      {},
      { 6: 'a', 4: 'b' },
      { 5: 'a', 6: '=b' },
      { 5: 'a', 6: '=b' },
      { 5: 'a', 6: '=b' },
      { 5: 'a', 6: '=b' },
      { 4: 'a', 6: 'b' },
    ];
    const state = stateOf(
      oneHeat(
        ids,
        slots.map((s, r) =>
          r === 1
            ? sheet('A1', 2, ...order(ids, {}, ['a:DNF', 'b:DNF']))
            : race('A1', r + 1, ids, s),
        ),
      ),
    );
    expect(standing(state, 'a').total).toBe(32);
    expect(places(state).a).toBeLessThan(places(state).b);
  });

  it('SHRS 5.7(ii)(1): only the races they sailed in the same heat count', () => {
    // Two heats of 8 (DNF 9). Rounds 1-2 a and b in heat A; rounds 3-5 apart.
    //   a: 3, 7 together; 2, 4, DNF apart (DNF excluded) = 16
    //   b: 4, 6 together; 1, 5, DNF apart (DNF excluded) = 16
    // Together: a 3, 7 against b 4, 6, so a. All races (A8.1 on kept
    // scores) would have given b, with her 1.
    const f = fillers('f', 14);
    const together = [['a', 'b', ...f.slice(0, 6)], f.slice(6, 14)];
    const apart = [
      ['a', ...f.slice(0, 7)],
      ['b', ...f.slice(7, 14)],
    ];
    const log = heatsByRound(
      ['a', 'b', ...f],
      [
        {
          heats: together,
          orders: [order(together[0], { 3: 'a', 4: 'b' }), together[1]],
        },
        {
          heats: together,
          orders: [order(together[0], { 7: 'a', 6: 'b' }), together[1]],
        },
        {
          heats: apart,
          orders: [order(apart[0], { 2: 'a' }), order(apart[1], { 1: 'b' })],
        },
        {
          heats: apart,
          orders: [order(apart[0], { 4: 'a' }), order(apart[1], { 5: 'b' })],
        },
        {
          heats: apart,
          orders: [
            order(apart[0], {}, ['a:DNF']),
            order(apart[1], {}, ['b:DNF']),
          ],
        },
      ],
    );
    const state = stateOf(log);
    expect(standing(state, 'a').total).toBe(16);
    expect(standing(state, 'b').total).toBe(16);
    expect(places(state).a).toBeLessThan(places(state).b);
  });

  it('SHRS 5.7(ii)(4): boats that never met, plain A8: excluded scores left out', () => {
    // Pre-assigned heats of 9, a in A, b in B, 4 races (1 discard).
    //   a: 7, 1, 2, 3 (7 out) = 6;  b: 9, 1, 3, 2 (9 out) = 6.
    // Plain A8.1: kept 1, 2, 3 each; A8.2 last race b 2 against a 3, so b.
    // With the excluded scores (5.7(ii)(2), only for boats that met) a's 7
    // would have beaten b's 9.
    const heatA = ['a', ...fillers('p', 8)];
    const heatB = ['b', ...fillers('q', 8)];
    const slotsA: Array<Record<number, string>> = [
      { 7: 'a' },
      { 1: 'a' },
      { 2: 'a' },
      { 3: 'a' },
    ];
    const slotsB: Array<Record<number, string>> = [
      { 9: 'b' },
      { 1: 'b' },
      { 3: 'b' },
      { 2: 'b' },
    ];
    const log: Decision[] = [
      { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
      ...entries([...heatA, ...heatB]),
      { type: 'heatsCreated', heatCount: 2, heats: [heatA, heatB] },
      ...[0, 1, 2, 3].flatMap((r): Decision[] => [
        ...(r > 0 ? [{ type: 'roundCreated' } as Decision] : []),
        race(`A${r + 1}`, 1, heatA, slotsA[r]),
        race(`B${r + 1}`, 1, heatB, slotsB[r]),
      ]),
    ];
    const state = stateOf(log);
    expect(standing(state, 'a').total).toBe(6);
    expect(standing(state, 'b').total).toBe(6);
    expect(places(state).b).toBeLessThan(places(state).a);
  });

  it('SHRS 5.7(ii)(4): never met, one DNF excluded each way; the last race decides', () => {
    // good wins heat A four times; penalty wins heat B three times and is
    // DNF in the last (3 points, excluded). Both 3; A8.2: 1 against 3.
    const log: Decision[] = [
      { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
      ...entries(['good', 'x', 'penalty', 'y']),
      {
        type: 'heatsCreated',
        heatCount: 2,
        heats: [
          ['good', 'x'],
          ['penalty', 'y'],
        ],
      },
      ...[0, 1, 2, 3].flatMap((r): Decision[] => [
        ...(r > 0 ? [{ type: 'roundCreated' } as Decision] : []),
        sheet(`A${r + 1}`, 1, 'good', 'x'),
        r < 3
          ? sheet(`B${r + 1}`, 1, 'penalty', 'y')
          : sheet(`B${r + 1}`, 1, 'y', 'penalty:DNF'),
      ]),
    ];
    const state = stateOf(log);
    expect(standing(state, 'good').total).toBe(3);
    expect(standing(state, 'penalty').total).toBe(3);
    expect(places(state).good).toBeLessThan(places(state).penalty);
  });
});

describe('SHRS 5.1: each final fleet scored on its own', () => {
  // Six boats, two heats; the fleets as made: Gold four, Silver two.
  const gold = ['g1', 'g2', 'g3', 'g4'];
  const start: Decision[] = [
    ...entries([...gold, 's1', 's2']),
    { type: 'heatsCreated', heatCount: 2 },
    sheet('A1', 1, 'g1', 'g4', 's1'),
    sheet('B1', 1, 'g2', 'g3', 's2'),
    {
      type: 'finalSeriesStarted',
      fleets: [gold, ['s1', 's2']],
    },
  ];
  const goldOf = (state: EventState) =>
    Object.fromEntries(
      finalStandings(state)[0].standings.map((s) => [s.boat, s]),
    );

  it('SHRS 5.1: ranks a fleet by its own totals', () => {
    // g1 4, 3, 4 = 11; g2 1, 1, 2 = 4; g3 2, 2, 3 = 7.
    const state = stateOf([
      ...start,
      race('Gold', 1, gold, { 1: 'g2', 2: 'g3', 4: 'g1' }),
      race('Gold', 2, gold, { 1: 'g2', 2: 'g3', 3: 'g1' }),
      race('Gold', 3, gold, { 2: 'g2', 3: 'g3', 4: 'g1' }),
    ]);
    const g = goldOf(state);
    // g4 fills the free places: 3, 4, 1 = 8.
    expect([g.g2.total, g.g3.total, g.g4.total, g.g1.total]).toEqual([
      4, 7, 8, 11,
    ]);
    expect([g.g2.place, g.g3.place, g.g4.place, g.g1.place]).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('SHRS 5.7(ii)(2) / RRS A8.1 in a fleet: 1, 4 beats 2, 3', () => {
    const state = stateOf([
      ...start,
      race('Gold', 1, gold, { 4: 'g1', 3: 'g2' }),
      race('Gold', 2, gold, { 1: 'g1', 2: 'g2' }),
    ]);
    const g = goldOf(state);
    expect([g.g1.total, g.g2.total]).toEqual([5, 5]);
    expect(g.g1.place).toBeLessThan(g.g2.place);
  });

  it('RRS A8.2 in a fleet: the same scores, the last race decides', () => {
    // Silver, a fleet of two: s1 1, 2 and s2 2, 1.
    const state = stateOf([
      ...start,
      sheet('Silver', 1, 's1', 's2'),
      sheet('Silver', 2, 's2', 's1'),
    ]);
    const silver = finalStandings(state)[1].standings;
    expect(silver.map((s) => [s.boat, s.total, s.place])).toEqual([
      ['s2', 3, 1],
      ['s1', 3, 2],
    ]);
  });

  it('a fleet of one boat: she is 1st', () => {
    // Three boats, two heats: Gold two, Silver one (SHRS 4.1).
    const split: Decision[] = [
      ...entries(['b1', 'b2', 'b3']),
      { type: 'heatsCreated', heatCount: 2 },
      sheet('A1', 1, 'b1'),
      sheet('B1', 1, 'b2', 'b3'),
      { type: 'finalSeriesStarted' },
    ];
    const silver = stateOf(split).fleets![1];
    expect(silver.boats).toHaveLength(1);
    const after = stateOf([
      ...split,
      sheet('Silver', 1, ...silver.boats),
      sheet('Silver', 2, ...silver.boats),
    ]);
    expect(finalStandings(after)[1].standings).toEqual([
      expect.objectContaining({ boat: silver.boats[0], place: 1, total: 2 }),
    ]);
  });

  it('no Final Series yet: no fleet standings', () => {
    expect(finalStandings(stateOf(start.slice(0, -1)))).toEqual([]);
  });

  it('SHRS 2.3: three oversize fleets of 25, each ranked 1 to 25', () => {
    // 75 boats need 4 qualifying heats (20 at most); the race committee
    // allows oversize fleets and the fleets are recorded as 3 x 25.
    const ids = fillers('b', 75);
    const log: Decision[] = [
      {
        type: 'settingsChanged',
        settings: { finalOverflow: 'allow-oversize' },
      },
      ...entries(ids),
      { type: 'heatsCreated', heatCount: 4 },
    ];
    const heats = stateOf(log).rounds[0];
    heats.forEach((heat) => log.push(sheet(heat.id, 1, ...heat.boats)));
    const fleets = [ids.slice(0, 25), ids.slice(25, 50), ids.slice(50)];
    log.push({ type: 'finalSeriesStarted', fleets });
    ['Gold', 'Silver', 'Bronze'].forEach((fleet, f) => {
      log.push(sheet(fleet, 1, ...fleets[f]));
      log.push(
        sheet(
          fleet,
          2,
          ...[...fleets[f]].reverse().slice(0, 1),
          ...fleets[f].slice(0, 24),
        ),
      );
    });
    const standings = finalStandings(stateOf(log));
    expect(standings.map((f) => f.fleet)).toEqual(['Gold', 'Silver', 'Bronze']);
    standings.forEach((fleet) => {
      expect(fleet.standings.map((s) => s.place).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 25 }, (_v, i) => i + 1),
      );
    });
  });
});

describe('SHRS 3.1(1) and 2.2: the first round', () => {
  const sizes = (boatCount: number, heatCount: number) =>
    stateOf([
      ...entries(fillers('b', boatCount)),
      { type: 'heatsCreated', heatCount },
    ]).rounds[0].map((heat) => heat.boats.length);

  it('SHRS 3.1(1): 5 boats in 2 heats, the extra boat in heat A', () => {
    expect(sizes(5, 2)).toEqual([3, 2]);
  });

  it('SHRS 3.1(1): 16 boats in 4 heats, 4 each', () => {
    expect(sizes(16, 4)).toEqual([4, 4, 4, 4]);
  });

  it('SHRS 2.2: heats never more than one boat apart (2-5 heats, up to 60 boats)', () => {
    for (let heats = 2; heats <= 5; heats += 1) {
      for (let n = heats; n <= Math.min(60, heats * 20); n += 1) {
        const counts = sizes(n, heats);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  it('SHRS 2.3: 60 boats in 2 heats is refused (more than 20 to a heat)', () => {
    // The old test also ran 21-60 boats in 2 heats; SHRS 2.3 caps a heat at 20.
    expect(
      refusal([
        ...entries(fillers('b', 60)),
        { type: 'heatsCreated', heatCount: 2 },
      ]),
    ).toMatch(/SHRS 2.3/);
  });
});

describe('SHRS 3.1(2): Heat Movement Table, 3 heats', () => {
  it('Table 2: places 1-6 of heats A, B and C go to the listed heats', () => {
    // 18 boats, 3 heats of 6; each heat finishes in its listed order.
    const log: Decision[] = [
      ...entries(fillers('b', 18)),
      { type: 'heatsCreated', heatCount: 3 },
    ];
    const round1 = stateOf(log).rounds[0];
    round1.forEach((heat) => log.push(sheet(heat.id, 1, ...heat.boats)));
    log.push({ type: 'roundCreated' });
    const round2 = stateOf(log).rounds[1];
    const heatOf = (boat: string) =>
      round2.find((heat) => heat.boats.includes(boat))!.id[0];
    // SHRS Table 2, 3 heats: rows are places 1, 2, 3 (then repeating),
    // columns the last race's heat A, B, C.
    const table = [
      ['A', 'B', 'C'],
      ['C', 'A', 'B'],
      ['B', 'C', 'A'],
    ];
    round1.forEach((heat, h) => {
      heat.boats.forEach((boat, i) => {
        expect([heat.id, i + 1, heatOf(boat)]).toEqual([
          heat.id,
          i + 1,
          table[i % 3][h],
        ]);
      });
    });
  });
});

describe('SHRS 4.3: the second-worst score left out for the split', () => {
  // Three pre-assigned heats of three, six races (DNF 4), so 5.4 drops one
  // score and 4.3 one more, for the split only.
  //   x: 1, 1, 1, 1, DNF, DNF   series 8, for the split 4
  //   y, b (heat B) and z, c (heat C): three 1s and three 2s each, series 7,
  //   for the split 5.
  // Gold takes three: without 4.3 x (8) is behind all four 7s; with it she
  // is first.
  const heatA = ['x', 'a1', 'a2'];
  const heatB = ['y', 'b1', 'b2'];
  const heatC = ['z', 'c1', 'c2'];
  const qualifying: Decision[] = [
    { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
    ...entries([...heatA, ...heatB, ...heatC]),
    { type: 'heatsCreated', heatCount: 3, heats: [heatA, heatB, heatC] },
    ...[0, 1, 2, 3, 4, 5].flatMap((r): Decision[] => [
      ...(r > 0 ? [{ type: 'roundCreated' } as Decision] : []),
      r < 4
        ? sheet(`A${r + 1}`, 1, 'x', 'a1', 'a2')
        : sheet(`A${r + 1}`, 1, 'a1', 'a2', 'x:DNF'),
      r < 3
        ? sheet(`B${r + 1}`, 1, 'b1', 'y', 'b2')
        : sheet(`B${r + 1}`, 1, 'y', 'b1', 'b2'),
      r < 3
        ? sheet(`C${r + 1}`, 1, 'c1', 'z', 'c2')
        : sheet(`C${r + 1}`, 1, 'z', 'c1', 'c2'),
    ]),
  ];

  it('the qualifying series as described', () => {
    const state = stateOf(qualifying);
    expect(qualifyingStandings(state).completedRaces).toBe(6);
    expect(
      ['x', 'y', 'b1', 'z', 'c1'].map((id) => standing(state, id).total),
    ).toEqual([8, 7, 7, 7, 7]);
  });

  it('SHRS 4.3: with 6 races x goes to Gold on her split total', () => {
    const state = stateOf([...qualifying, { type: 'finalSeriesStarted' }]);
    expect(state.fleets![0].boats).toContain('x');
    // Her series score is unchanged: 4.3 is for the split only.
    expect(standing(state, 'x').total).toBe(8);
  });

  it('SHRS 4.3 not applied (sailing instructions): x stays out of Gold', () => {
    const state = stateOf([
      ...qualifying,
      { type: 'finalSeriesStarted', rule43: false },
    ]);
    expect(state.fleets![0].boats).not.toContain('x');
  });
});
