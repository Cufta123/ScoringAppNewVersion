/**
 * A boat entered late: redress for the races she had no heat in (R12),
 * corrections of races sailed before she joined, and corrected details.
 */
import { qualifyingStandings, replay, type Decision } from '../src';

const boat = (i: number): Decision => ({
  type: 'boatEntered',
  boat: { id: `b${i}`, nat: 'CRO', sail: String(i) },
});
const scored = (heat: string, race: number, ...boats: string[]): Decision => ({
  type: 'raceScored',
  race: { heat, race },
  lines: boats.map((id) => ({ boat: id })),
});
const reason = (log: Decision[]) => {
  const result = replay(log);
  return result.ok ? null : result.reason;
};
const scoresOf = (log: Decision[], id: string) =>
  qualifyingStandings(replay(log).state).standings.find((s) => s.boat === id)!
    .scores;

// Two heats. b5 enters after the heats are made: no heat in round 1.
// Round 2 puts her in A2.
const log: Decision[] = [
  boat(1),
  boat(2),
  boat(3),
  boat(4),
  { type: 'heatsCreated', heatCount: 2 },
  boat(5),
  scored('A1', 1, 'b1', 'b4'),
  scored('B1', 1, 'b2', 'b3'),
  { type: 'roundCreated' },
  { type: 'boatAssigned', boat: 'b5', heat: 'A2' },
  scored('A2', 1, 'b5', 'b1', 'b3'),
  scored('B2', 1, 'b2', 'b4'),
];
const redress = (outcome: unknown, heat = 'A1'): Decision =>
  ({
    type: 'protestDecided',
    race: { heat, race: 1 },
    boat: 'b5',
    outcome,
  }) as Decision;

describe('R12: redress for a race she had no heat in', () => {
  it('without it she is DNC (largest heat 3, so 4 points)', () => {
    expect(scoresOf(log, 'b5')[0]).toMatchObject({
      ref: null,
      code: 'DNC',
      points: 4,
    });
  });

  it('RDG1: the average of her other races', () => {
    // Her only other race: 1st in A2.
    expect(
      scoresOf([...log, redress({ kind: 'RDG1' })], 'b5')[0],
    ).toMatchObject({ code: 'RDG1', points: 1 });
  });

  it('RDG3: the points the committee set, filed under any heat of the round', () => {
    expect(
      scoresOf([...log, redress({ kind: 'RDG3', points: 2.5 }, 'B1')], 'b5')[0],
    ).toMatchObject({ code: 'RDG3', points: 2.5 });
  });

  it('RDG2: the races the committee chose', () => {
    const decision = redress({
      kind: 'RDG2',
      races: [{ heat: 'A2', race: 1 }],
    });
    expect(scoresOf([...log, decision], 'b5')[0]).toMatchObject({
      code: 'RDG2',
      points: 1,
    });
  });

  it('cleared: back to DNC', () => {
    expect(
      scoresOf(
        [...log, redress({ kind: 'RDG1' }), redress({ kind: 'cleared' })],
        'b5',
      )[0],
    ).toMatchObject({ code: 'DNC', points: 4 });
  });

  it('a penalty for a race she did not sail is refused', () => {
    expect(reason([...log, redress({ kind: 'DSQ' })])).toMatch(
      /had no heat in this race: only redress/,
    );
  });

  it('a boat that sailed in another heat is not "no heat"', () => {
    const forB2 = {
      type: 'protestDecided',
      race: { heat: 'A1', race: 1 },
      boat: 'b2',
      outcome: { kind: 'RDG1' },
    } as Decision;
    expect(reason([...log, forB2])).toMatch(/CRO 2 did not sail this race/);
  });
});

describe('a correction of a race sailed before a boat joined the heat', () => {
  // One fleet: b3 joins A1 after race 1 (R3).
  const fleet: Decision[] = [
    boat(1),
    boat(2),
    { type: 'heatsCreated', heatCount: 1 },
    scored('A1', 1, 'b1', 'b2'),
    boat(3),
    { type: 'boatAssigned', boat: 'b3', heat: 'A1' },
    scored('A1', 2, 'b3', 'b1', 'b2'),
  ];
  const correct = (...boats: string[]): Decision => ({
    type: 'raceCorrected',
    race: { heat: 'A1', race: 1 },
    lines: boats.map((id) => ({ boat: id })),
  });

  it('lists the boats that sailed it, not her', () => {
    expect(reason([...fleet, correct('b2', 'b1')])).toBeNull();
  });

  it('cannot add her to it', () => {
    expect(reason([...fleet, correct('b2', 'b1', 'b3')])).toMatch(
      /CRO 3 is not in A1/,
    );
  });
});

describe('boatChanged', () => {
  it('corrects the sail number, and the seeding follows', () => {
    const result = replay([
      boat(1),
      boat(2),
      { type: 'boatChanged', boat: 'b1', sail: '30' },
      { type: 'heatsCreated', heatCount: 1 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.state.boats[0]).toMatchObject({ id: 'b1', sail: '30' });
    expect(result.state.rounds[0][0].boats).toEqual(['b2', 'b1']);
  });

  it('refuses a number another boat has', () => {
    expect(
      reason([
        boat(1),
        boat(2),
        { type: 'boatChanged', boat: 'b1', sail: '2' },
      ]),
    ).toMatch(/CRO 2 is already entered/);
  });

  it('refuses empty details and an unknown boat', () => {
    expect(
      reason([boat(1), { type: 'boatChanged', boat: 'b1', nat: ' ' }]),
    ).toMatch(/needs national letters/);
    expect(reason([{ type: 'boatChanged', boat: 'b9', sail: '1' }])).toMatch(
      /b9 is not entered/,
    );
  });
});
