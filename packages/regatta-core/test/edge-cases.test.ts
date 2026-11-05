/**
 * Edge cases found by the parity inventory against the app (Nov 2026).
 * Each one was a crash or a wrong result before its fix.
 */
import { finalStandings, replay, type Decision } from '../src';

const boat = (i: number): Decision => ({
  type: 'boatEntered',
  boat: { id: `b${i}`, nat: 'CRO', sail: String(i) },
});
const sheet = (heat: string, race: number, ...boats: string[]): Decision => ({
  type: 'raceScored',
  race: { heat, race },
  lines: boats.map((id) => ({ boat: id })),
});

describe('a boat removed after the fleets are made', () => {
  // b5 entered late, never had a heat, and went into a fleet with DNCs.
  const log: Decision[] = [
    boat(1),
    boat(2),
    boat(3),
    boat(4),
    { type: 'heatsCreated', heatCount: 2 },
    boat(5),
    sheet('A1', 1, 'b1', 'b4'),
    sheet('B1', 1, 'b2', 'b3'),
    { type: 'finalSeriesStarted' },
    { type: 'boatRemoved', boat: 'b5' },
  ];

  it('leaves her fleet too', () => {
    const result = replay(log);
    expect(result.ok).toBe(true);
    expect(result.state.fleets!.flatMap((fleet) => fleet.boats)).not.toContain(
      'b5',
    );
  });

  it('is not on any final sheet and not in the largest heat', () => {
    const result = replay(log);
    const fleet = result.state.fleets!.find((f) => f.boats.length > 0)!;
    const after = replay([...log, sheet(fleet.id, 1, ...fleet.boats)]);
    expect(after.ok).toBe(true);
    const standings = finalStandings(after.state).flatMap((f) => f.standings);
    expect(standings.map((s) => s.boat)).not.toContain('b5');
  });

  it('is refused once her fleet has raced', () => {
    const before = replay(log.slice(0, -1));
    const fleet = before.state.fleets!.find((f) => f.boats.includes('b5'))!;
    const result = replay([
      ...log.slice(0, -1),
      sheet(fleet.id, 1, ...fleet.boats),
      { type: 'boatRemoved', boat: 'b5' },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('a heat left with no boats', () => {
  // Three heats, the only boat of B1 withdraws before racing.
  const start: Decision[] = [
    boat(1),
    boat(2),
    boat(3),
    { type: 'heatsCreated', heatCount: 3 },
    { type: 'boatRemoved', boat: 'b2' },
    sheet('A1', 1, 'b1'),
    sheet('C1', 1, 'b3'),
  ];

  it.each(['progressive', 'pre-assigned'] as const)(
    'does not stop the next round (%s)',
    (mode) => {
      const log: Decision[] = [
        { type: 'settingsChanged', settings: { qualifyingMode: mode } },
        ...start,
        { type: 'roundCreated' },
      ];
      const result = replay(log);
      expect(result.ok).toBe(true);
      const round2 = result.state.rounds[1];
      expect(round2.flatMap((heat) => heat.boats).sort()).toEqual(['b1', 'b3']);
    },
  );

  it('does not stop the Final Series', () => {
    const result = replay([...start, { type: 'finalSeriesStarted' }]);
    expect(result.ok).toBe(true);
  });
});

describe('a race is named, not counted', () => {
  // One fleet, three races; b2 is disqualified in race 3.
  const races: Decision[] = [
    boat(1),
    boat(2),
    { type: 'heatsCreated', heatCount: 1 },
    sheet('A1', 1, 'b1', 'b2'),
    sheet('A1', 2, 'b2', 'b1'),
    sheet('A1', 3, 'b2', 'b1'),
    {
      type: 'protestDecided',
      race: { heat: 'A1', race: 3 },
      boat: 'b2',
      outcome: { kind: 'DSQ' },
    },
  ];

  it('taking a middle race out stops at the next race, not re-pointing it', () => {
    // Without race numbers, race 3 would have become race 2 and the DSQ
    // would have landed on a race nobody decided it for.
    const withoutRace2 = races.filter((_d, i) => i !== 4);
    const result = replay(withoutRace2);
    expect(result).toMatchObject({
      ok: false,
      at: 4,
      reason: 'A1 race 3 comes after race 2, which is not scored.',
    });
  });

  it('refuses scoring a race twice', () => {
    const result = replay([...races, sheet('A1', 3, 'b1', 'b2')]);
    expect(result).toMatchObject({
      ok: false,
      reason: 'A1 race 3 is already scored; correct it instead.',
    });
  });

  it('taking the last race out leaves the rest as they were', () => {
    const result = replay(races.slice(0, 5));
    expect(result.ok).toBe(true);
    expect(result.state.rounds[0][0].races).toHaveLength(2);
  });
});

describe('fleets given as made (a converted record)', () => {
  const qualifying: Decision[] = [
    boat(1),
    boat(2),
    boat(3),
    boat(4),
    { type: 'heatsCreated', heatCount: 2 }, // A1: 1, 4; B1: 2, 3
    sheet('A1', 1, 'b1', 'b4'),
    sheet('B1', 1, 'b2', 'b3'),
  ];
  const start = (fleets: string[][]): Decision => ({
    type: 'finalSeriesStarted',
    fleets,
  });

  it('may leave out a boat entered after the split (older records)', () => {
    const result = replay([...qualifying, start([['b1', 'b2'], ['b3']])]);
    expect(result.ok).toBe(true);
  });

  it('are used as given', () => {
    const result = replay([
      ...qualifying,
      start([
        ['b4', 'b3'],
        ['b1', 'b2'],
      ]),
    ]);
    expect(result.ok).toBe(true);
    expect(result.state.fleets!.map((f) => [f.id, f.boats])).toEqual([
      ['Gold', ['b4', 'b3']],
      ['Silver', ['b1', 'b2']],
    ]);
  });

  it.each([
    [
      [
        ['b1', 'b2'],
        ['b3', 'b9'],
      ],
      /entered boats, each once/,
    ],
    [
      [
        ['b1', 'b2'],
        ['b3', 'b3', 'b4'],
      ],
      /entered boats, each once/,
    ],
    [[['b1'], ['b2', 'b3', 'b4']], /Silver cannot be larger than Gold/],
  ])('are refused when wrong: %p', (fleets, message) => {
    const result = replay([...qualifying, start(fleets)]);
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringMatching(message),
    });
  });
});

describe('heats given as made (a converted record)', () => {
  const entries: Decision[] = [boat(1), boat(2), boat(3)];
  const create = (heats: string[][]): Decision => ({
    type: 'heatsCreated',
    heatCount: heats.length,
    heats,
  });

  it('are used as given, an empty heat too', () => {
    const result = replay([...entries, create([['b3', 'b1'], [], ['b2']])]);
    expect(result.ok).toBe(true);
    expect(result.state.rounds[0].map((h) => [h.id, h.boats])).toEqual([
      ['A1', ['b3', 'b1']],
      ['B1', []],
      ['C1', ['b2']],
    ]);
  });

  it('then the round sails and moves on (the empty heat holds nothing)', () => {
    const result = replay([
      ...entries,
      create([['b3', 'b1'], [], ['b2']]),
      sheet('A1', 1, 'b1', 'b3'),
      sheet('C1', 1, 'b2'),
      { type: 'roundCreated' },
    ]);
    expect(result.ok).toBe(true);
  });

  it.each([
    [[['b1', 'b1'], ['b2']], /each once/],
    [[['b1'], ['b9']], /each once/],
  ])('are refused when wrong: %p', (heats, message) => {
    expect(replay([...entries, create(heats)])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(message),
    });
  });
});

describe('heats recorded before SHRS 2.3 was enforced', () => {
  it('keeps a recorded heat over 20 boats as it was sailed; a drawn one is still refused', () => {
    const boats = Array.from({ length: 21 }, (_, i) => `b${i + 1}`);
    const entered: Decision[] = boats.map((id, i) => ({
      type: 'boatEntered',
      boat: { id, nat: 'CRO', sail: String(i + 1) },
    }));
    const recorded = replay([
      ...entered,
      { type: 'heatsCreated', heatCount: 1, heats: [boats] },
    ]);
    expect(recorded).toMatchObject({
      ok: true,
      state: { rounds: [[{ boats }]] },
    });
    const drawn = replay([...entered, { type: 'heatsCreated', heatCount: 1 }]);
    expect(drawn.ok).toBe(false);
  });
});
