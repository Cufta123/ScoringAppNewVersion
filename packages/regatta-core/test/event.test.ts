import {
  finalStandings,
  nextStep,
  overallStandings,
  qualifyingStandings,
  replay,
  scoreRace,
  type Decision,
  type EventState,
  type RaceLine,
} from '../src';

/** Boats CRO 1 … CRO n, ids "1" … "n". */
const enter = (n: number): Decision[] =>
  Array.from({ length: n }, (_v, i) => ({
    type: 'boatEntered',
    boat: { id: String(i + 1), nat: 'CRO', sail: String(i + 1) },
  }));

/** Finishers in this order. */
const finish = (...boats: string[]): RaceLine[] =>
  boats.map((boat) => ({ boat }));

function stateOf(log: Decision[]): EventState {
  const result = replay(log);
  if (!result.ok) throw new Error(`#${result.at}: ${result.reason}`);
  return result.state;
}

function refusal(log: Decision[]): string {
  const result = replay(log);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

const heatBoats = (state: EventState, round: number) =>
  state.rounds[round - 1].map((heat) => [...heat.boats].sort().join(','));

describe('one race', () => {
  const race = (lines: RaceLine[], protests = {}) => ({
    ref: { heat: 'A1', race: 1 },
    lines,
    protests,
  });

  it('RRS A7: boats level share the points of their places', () => {
    const lines = finish('a', 'b', 'c', 'd');
    lines[2].tied = true;
    expect(scoreRace(race(lines), 4).map((r) => r.points)).toEqual([
      1, 2.5, 2.5, 4,
    ]);
  });

  it('SHRS 5.2: no place is the largest heat of the series + 1', () => {
    const lines: RaceLine[] = [...finish('a'), { boat: 'b', code: 'DNF' }];
    // This heat has 2 boats, the largest heat 10.
    expect(scoreRace(race(lines), 10).map((r) => r.points)).toEqual([1, 11]);
  });

  it('RRS A6.1: a disqualification moves the boats behind up', () => {
    const scored = scoreRace(
      race(finish('a', 'b', 'c'), { a: { kind: 'DSQ' } }),
      3,
    );
    expect(scored.map((r) => [r.boat, r.points, r.code])).toEqual([
      ['a', 4, 'DSQ'],
      ['b', 1, undefined],
      ['c', 2, undefined],
    ]);
  });

  it('RRS A6.2 / A10: redress and DPI change no other boat', () => {
    const scored = scoreRace(
      race(finish('a', 'b', 'c'), {
        a: { kind: 'RDG3', points: 1.5 },
        b: { kind: 'DPI', points: 4 },
      }),
      3,
    );
    expect(scored.map((r) => r.points)).toEqual([1.5, 4, 3]);
  });

  it('a penalty keeps the place and the boats behind keep theirs', () => {
    const lines = finish('a', 'b', 'c');
    lines[0].penalty = 'ZFP';
    expect(scoreRace(race(lines), 10).map((r) => r.points)).toEqual([
      3.2, 2, 3,
    ]);
  });
});

describe('the qualifying series', () => {
  // 10 boats, 2 heats: A = 1,4,5,8,9  B = 2,3,6,7,10 (3.1(1)).
  const start: Decision[] = [
    ...enter(10),
    { type: 'heatsCreated', heatCount: 2 },
  ];
  const round1: Decision[] = [
    ...start,
    {
      type: 'raceScored',
      race: { heat: 'A1', race: 1 },
      lines: finish('9', '8', '5', '4', '1'),
    },
    {
      type: 'raceScored',
      race: { heat: 'B1', race: 1 },
      lines: finish('2', '3', '6', '7', '10'),
    },
  ];

  it('3.1(1): seeds the first round 1, 2, 2, 1, …', () => {
    expect(heatBoats(stateOf(start), 1)).toEqual(['1,4,5,8,9', '10,2,3,6,7']);
  });

  it('3.1(2): the next round follows the Heat Movement Table', () => {
    const state = stateOf([...round1, { type: 'roundCreated' }]);
    // Odd places stay, even places swap heats.
    expect(heatBoats(state, 2)).toEqual(['1,3,5,7,9', '10,2,4,6,8']);
  });

  it('3.1(3): boats with no place follow the 5.3 order', () => {
    const state = stateOf([
      ...start,
      {
        type: 'raceScored',
        race: { heat: 'A1', race: 1 },
        lines: [
          { boat: '9', code: 'DSQ' },
          { boat: '8', code: 'DNF' },
          ...finish('5', '4', '1'),
        ],
      },
      {
        type: 'raceScored',
        race: { heat: 'B1', race: 1 },
        lines: finish('2', '3', '6', '7', '10'),
      },
      { type: 'roundCreated' },
    ]);
    // A1 order: 5, 4, 1, 8 (DNF), 9 (DSQ) -> A, B, A, B, A.
    expect(state.rounds[1][0].boats).toEqual(
      expect.arrayContaining(['5', '1', '9']),
    );
    expect(state.rounds[1][1].boats).toEqual(
      expect.arrayContaining(['4', '8']),
    );
  });

  it('3.1(5): a protest decision does not change the next round', () => {
    const protest: Decision = {
      type: 'protestDecided',
      race: { heat: 'A1', race: 1 },
      boat: '9',
      outcome: { kind: 'DSQ' },
    };
    const correction: Decision = {
      type: 'raceCorrected',
      race: { heat: 'A1', race: 1 },
      lines: [{ boat: '9', code: 'DSQ' }, ...finish('8', '5', '4', '1')],
    };
    const plain = stateOf([...round1, { type: 'roundCreated' }]);
    const decided = stateOf([...round1, protest, { type: 'roundCreated' }]);
    const corrected = stateOf([
      ...round1,
      correction,
      { type: 'roundCreated' },
    ]);
    expect(heatBoats(decided, 2)).toEqual(heatBoats(plain, 2));
    expect(heatBoats(corrected, 2)).not.toEqual(heatBoats(plain, 2));
    // The decision still scores: 9 is DSQ, 8 moves up to 1st.
    const scores = qualifyingStandings(decided).standings;
    expect(scores.find((s) => s.boat === '8')!.total).toBe(1);
    expect(scores.find((s) => s.boat === '9')!.total).toBe(6);
  });

  it('SHRS 1.1: a race counts once every heat has sailed it', () => {
    const half = stateOf([
      ...start,
      {
        type: 'raceScored',
        race: { heat: 'A1', race: 1 },
        lines: finish('9', '8', '5', '4', '1'),
      },
    ]);
    const q = qualifyingStandings(half);
    expect(q.completedRaces).toBe(0);
    expect(q.standings).toEqual([]);
    expect(q.pending['9'][0].points).toBe(1);

    expect(qualifyingStandings(stateOf(round1)).completedRaces).toBe(1);
  });

  it('RRS A5.1: a boat with no heat for a race is DNC', () => {
    const late: Decision = {
      type: 'boatEntered',
      boat: { id: 'L', nat: 'ITA', sail: '1' },
    };
    const state = stateOf([
      ...round1.slice(0, -1),
      late,
      round1[round1.length - 1],
    ]);
    const scores = qualifyingStandings(state).standings;
    const lateBoat = scores.find((s) => s.boat === 'L')!;
    expect(lateBoat.scores.map((s) => [s.code, s.points])).toEqual([
      ['DNC', 6],
    ]);
  });

  it('refuses what the rules do not allow', () => {
    expect(refusal([...start, { type: 'roundCreated' }])).toMatch(
      /same races first/,
    );
    expect(
      refusal([
        ...start,
        {
          type: 'raceScored',
          race: { heat: 'A1', race: 1 },
          lines: finish('9'),
        },
      ]),
    ).toMatch(/Missing: CRO 1, CRO 4, CRO 5, CRO 8/);
    expect(
      refusal([
        ...round1,
        { type: 'roundCreated' },
        {
          type: 'raceScored',
          race: { heat: 'A1', race: 1 },
          lines: finish('9', '8', '5', '4', '1'),
        },
      ]),
    ).toMatch(/earlier round/);
    expect(
      refusal([...round1, { type: 'heatsCreated', heatCount: 2 }]),
    ).toMatch(/can no longer be redrawn/);
  });

  it('undo is taking the decision out; replay names what depended on it', () => {
    const log: Decision[] = [...round1, { type: 'roundCreated' }];
    // Undo the round: fine.
    expect(replay(log.slice(0, -1)).ok).toBe(true);
    // Undo a race the round was built from: the round is refused.
    const without = log.filter((_d, i) => i !== round1.length - 1);
    expect(refusal(without)).toMatch(/same races first/);
  });

  it('tells the race office what to do next', () => {
    expect(nextStep(stateOf([]))).toEqual({ kind: 'enterBoats' });
    expect(nextStep(stateOf(enter(3)))).toEqual({ kind: 'createHeats' });
    expect(nextStep(stateOf(start))).toEqual({
      kind: 'score',
      heat: 'A1',
      race: 1,
    });
    expect(nextStep(stateOf(round1))).toEqual({
      kind: 'createRound',
      round: 2,
      finalSeries: true,
    });
  });
});

describe('one fleet', () => {
  // 4 boats, one heat, three races in the same order: 3, 6, 9, 12.
  const log: Decision[] = [
    ...enter(4),
    { type: 'heatsCreated', heatCount: 1 },
    ...[1, 2, 3].map(
      (race): Decision => ({
        type: 'raceScored',
        race: { heat: 'A1', race },
        lines: finish('1', '2', '3', '4'),
      }),
    ),
  ];

  it('scores every race, no discards before 4', () => {
    const q = qualifyingStandings(stateOf(log));
    expect(q.standings.map((s) => [s.boat, s.total, s.place])).toEqual([
      ['1', 3, 1],
      ['2', 6, 2],
      ['3', 9, 3],
      ['4', 12, 4],
    ]);
  });

  it('has no rounds and no Final Series', () => {
    expect(refusal([...log, { type: 'roundCreated' }])).toMatch(/one heat/);
    expect(refusal([...log, { type: 'finalSeriesStarted' }])).toMatch(
      /SHRS 1.1/,
    );
  });

  it('RRS A9: RDG1 is the average of her other races, kept live', () => {
    const rdg: Decision = {
      type: 'protestDecided',
      race: { heat: 'A1', race: 1 },
      boat: '4',
      outcome: { kind: 'RDG1' },
    };
    const state = stateOf([...log, rdg]);
    const four = qualifyingStandings(state).standings.find(
      (s) => s.boat === '4',
    )!;
    expect(four.scores[0]).toMatchObject({ code: 'RDG1', points: 4 });
    // One more race, 1st: the average follows (4 + 4 + 1) / 3 = 3.
    const later = stateOf([
      ...log,
      rdg,
      {
        type: 'raceScored',
        race: { heat: 'A1', race: 4 },
        lines: finish('4', '1', '2', '3'),
      },
    ]);
    const after = qualifyingStandings(later).standings.find(
      (s) => s.boat === '4',
    )!;
    expect(after.scores[0].points).toBe(3);
  });

  it('SHRS 5.4: the fourth race brings the first discard', () => {
    const state = stateOf([
      ...log,
      {
        type: 'raceScored',
        race: { heat: 'A1', race: 4 },
        lines: finish('4', '1', '2', '3'),
      },
    ]);
    const one = qualifyingStandings(state).standings.find(
      (s) => s.boat === '1',
    )!;
    // 1 + 1 + 1 + 2, the 2 excluded.
    expect(one.total).toBe(3);
    expect(one.scores.map((s) => s.excluded)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });
});

describe('the Final Series', () => {
  // 8 boats, 2 heats, two qualifying rounds, then Gold and Silver.
  const qualifying: Decision[] = [
    ...enter(8),
    { type: 'heatsCreated', heatCount: 2 },
    {
      type: 'raceScored',
      race: { heat: 'A1', race: 1 },
      lines: finish('1', '4', '5', '8'),
    },
    {
      type: 'raceScored',
      race: { heat: 'B1', race: 1 },
      lines: finish('2', '3', '6', '7'),
    },
  ];

  it('4.2: splits by qualifying ranking, best to Gold', () => {
    const state = stateOf([...qualifying, { type: 'finalSeriesStarted' }]);
    expect(state.fleets!.map((f) => [f.id, [...f.boats].sort()])).toEqual([
      ['Gold', ['1', '2', '3', '4']],
      ['Silver', ['5', '6', '7', '8']],
    ]);
  });

  it('1.5: with no final race yet, the overall is the qualifying ranking', () => {
    const state = stateOf([...qualifying, { type: 'finalSeriesStarted' }]);
    const overall = overallStandings(state);
    const q = qualifyingStandings(state).standings;
    expect(overall.map((o) => [o.boat, o.place])).toEqual(
      q.map((s) => [s.boat, s.place]),
    );
    expect(overall[0].fleet).toBe('Gold');
  });

  it('closes the qualifying heats', () => {
    expect(
      refusal([
        ...qualifying,
        { type: 'finalSeriesStarted' },
        {
          type: 'raceScored',
          race: { heat: 'A1', race: 1 },
          lines: finish('1', '4', '5', '8'),
        },
      ]),
    ).toMatch(/qualifying heats are closed/);
  });

  it('1.5 and 5.5: ranks Gold before Silver, by qualifying until a fleet races', () => {
    const log: Decision[] = [
      ...qualifying,
      { type: 'finalSeriesStarted' },
      // Silver races; its last qualifier wins.
      {
        type: 'raceScored',
        race: { heat: 'Silver', race: 1 },
        lines: finish('8', '7', '6', '5'),
      },
    ];
    const state = stateOf(log);
    const [gold, silver] = finalStandings(state);
    expect(gold.races).toBe(0);
    expect(gold.standings.map((s) => s.boat)).toEqual(['1', '2', '3', '4']);
    expect(silver.standings.map((s) => s.boat)).toEqual(['8', '7', '6', '5']);

    const overall = overallStandings(state);
    expect(overall.map((o) => [o.boat, o.place, o.fleet])).toEqual([
      // 1 and 2 each won a qualifying heat and never met: still tied.
      ['1', 1, 'Gold'],
      ['2', 1, 'Gold'],
      ['3', 3, 'Gold'],
      ['4', 3, 'Gold'],
      ['8', 5, 'Silver'],
      ['7', 6, 'Silver'],
      ['6', 7, 'Silver'],
      ['5', 8, 'Silver'],
    ]);
    // 5.5: qualifying + final.
    expect(overall[4]).toMatchObject({ qualifying: 4, final: 1, total: 5 });
  });

  it('5.2 in the Final Series uses the largest final fleet', () => {
    const state = stateOf([
      ...qualifying,
      { type: 'finalSeriesStarted' },
      {
        type: 'raceScored',
        race: { heat: 'Gold', race: 1 },
        lines: [...finish('1', '2', '3'), { boat: '4', code: 'DNS' }],
      },
    ]);
    const gold = finalStandings(state)[0];
    expect(gold.standings.find((s) => s.boat === '4')!.total).toBe(5);
  });
});
