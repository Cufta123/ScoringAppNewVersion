/**
 * Rules decided after the parity inventory (docs/parity/README.md), each
 * checked against the SHRS 2026-1 text or RRS 2025-2028.
 */
import {
  qualifyingStandings,
  replay,
  scoreRace,
  type Decision,
  type RaceLine,
} from '../src';

const enter = (id: string, nat: string, sail: string): Decision => ({
  type: 'boatEntered',
  boat: { id, nat, sail },
});
const cro = (n: number) => enter(`b${n}`, 'CRO', String(n));
const sheet = (heat: string, race: number, ...boats: string[]): Decision => ({
  type: 'raceScored',
  race: { heat, race },
  lines: boats.map((boat) => ({ boat })),
});

describe('R5: the same boat entered twice', () => {
  it('"CRO 012" and "CRO 12" are two boats', () => {
    expect(replay([enter('a', 'CRO', '12'), enter('b', 'CRO', '012')]).ok).toBe(
      true,
    );
  });
  it('"CRO 12" and "cro 12 " are one boat', () => {
    const result = replay([enter('a', 'CRO', '12'), enter('b', 'cro ', '12 ')]);
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/already entered/),
    });
  });
  it('the seeding order is fixed between them', () => {
    const order = (log: Decision[]) =>
      replay([...log, { type: 'heatsCreated', heatCount: 1 }]).state
        .rounds[0][0].boats;
    expect(order([enter('a', 'CRO', '12'), enter('b', 'CRO', '012')])).toEqual(
      order([enter('b', 'CRO', '012'), enter('a', 'CRO', '12')]),
    );
  });
});

describe('R6: boats sharing a place at the fleet boundary (SHRS 4.2)', () => {
  // Heats by SHRS 3: A = CRO 1, 4, 5; B = CRO 2, 3, 6. Each heat finishes in
  // seeding order, so CRO 1/2, 3/4 and 5/6 have equal scores and never met:
  // plain A8 cannot separate them and they share places 1, 3 and 5.
  // Gold takes three boats: CRO 1, CRO 2 and one of CRO 3 / CRO 4.
  const race: Decision[] = [
    { type: 'heatsCreated', heatCount: 2 },
    sheet('A1', 1, 'b1', 'b4', 'b5'),
    sheet('B1', 1, 'b2', 'b3', 'b6'),
  ];

  it.each([
    ['in boat order', [1, 2, 3, 4, 5, 6]],
    ['in another order', [6, 4, 5, 2, 3, 1]],
  ])(
    'entered %s, CRO 3 goes to Gold (national letters, sail number)',
    (_how, order) => {
      const log = [
        ...(order as number[]).map(cro),
        ...race,
        { type: 'finalSeriesStarted' } as Decision,
      ];
      const result = replay(log);
      expect(result.ok).toBe(true);
      const { standings } = qualifyingStandings(result.state);
      expect(standings.map((s) => [s.boat, s.place])).toEqual([
        ['b1', 1],
        ['b2', 1],
        ['b3', 3],
        ['b4', 3],
        ['b5', 5],
        ['b6', 5],
      ]);
      expect(result.state.fleets![0].boats.sort()).toEqual(['b1', 'b2', 'b3']);
    },
  );
});

describe('R8: a boat with no heat in a race (SHRS 5.7(ii)(1))', () => {
  it('her DNC is not a race sailed in the same heat as anyone', () => {
    const log: Decision[] = [
      cro(1),
      cro(2),
      cro(3),
      cro(4),
      { type: 'heatsCreated', heatCount: 2 },
      cro(9), // late, no heat in round 1
      sheet('A1', 1, 'b1', 'b4'),
      sheet('B1', 1, 'b2', 'b3'),
    ];
    const { standings } = qualifyingStandings(replay(log).state);
    const late = standings.find((s) => s.boat === 'b9')!.scores[0];
    expect(late).toMatchObject({ ref: null, code: 'DNC' });
    const heatRaces = standings
      .filter((s) => s.boat !== 'b9')
      .map((s) => s.scores[0].race);
    expect(heatRaces).not.toContain(late.race);
  });

  it('a one-fleet event is still a single-heat event (5.7(i))', () => {
    // b3 enters after race 1 and never sails it; b1 and b3 tie on 4 points.
    const log: Decision[] = [
      cro(1),
      cro(2),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'b1', 'b2'),
      cro(3),
      { type: 'boatAssigned', boat: 'b3', heat: 'A1' },
      sheet('A1', 2, 'b3', 'b2', 'b1'),
    ];
    const { standings } = qualifyingStandings(replay(log).state);
    // b1: 1 + 3 = 4, b3: DNC 4 + 1 = 5, b2: 2 + 2 = 4. b1 and b2 tie on 4:
    // A8.1 [1,3] vs [2,2] -> b1 ahead.
    expect(standings.map((s) => [s.boat, s.total, s.place])).toEqual([
      ['b1', 4, 1],
      ['b2', 4, 2],
      ['b3', 5, 3],
    ]);
  });
});

describe('RRS 44.3(c) 2025-2028: a penalty on a shared place', () => {
  // Largest heat 9, so DNF is 10 and 20% of it is 2.
  const race = (lines: RaceLine[]) =>
    scoreRace({ ref: { heat: 'A1', race: 1 }, lines, protests: {} }, 9);

  it('adds the penalty to the points she shares, not to her place', () => {
    const results = race([
      { boat: 'a' },
      { boat: 'b' },
      { boat: 'c', tied: true, penalty: 'ZFP' },
    ]);
    // b and c tie for 2nd: 2.5 each. c: 2.5 + 2 = 4.5 (was 2 + 2 = 4).
    expect(results.map((r) => r.points)).toEqual([1, 2.5, 4.5]);
  });

  it('T1 is 30%, to the tenth', () => {
    // Largest heat 6: DNF 7, 30% = 2.1. Place 3 alone: 3 + 2.1 = 5.1.
    const results = scoreRace(
      {
        ref: { heat: 'A1', race: 1 },
        lines: [{ boat: 'a' }, { boat: 'b' }, { boat: 'c', penalty: 'T1' }],
        protests: {},
      },
      6,
    );
    expect(results[2].points).toBe(5.1);
  });
});
