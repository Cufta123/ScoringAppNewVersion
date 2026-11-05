/**
 * `eventStatus`: where the event stands and what may be done now, with the
 * reasons; and the undos it answers for (`undoLastRace`, `undoLatestRound`).
 * Every verdict must be what replay says: checked case by case and, on
 * every prefix of random events, against replay itself.
 */
import {
  eventStatus,
  replay,
  undoLastRace,
  undoLatestRound,
  undoRaceVerdict,
  type Decision,
  type EventState,
  type EventStatus,
  type Heat,
} from '../src';
import { prng, randomEvent } from './helpers/randomEvent';

const enter = (n: number): Decision[] =>
  Array.from({ length: n }, (_v, i) => ({
    type: 'boatEntered',
    boat: { id: String(i + 1), nat: 'CRO', sail: String(i + 1) },
  }));

function stateOf(log: Decision[]): EventState {
  const result = replay(log);
  if (!result.ok) throw new Error(`#${result.at}: ${result.reason}`);
  return result.state;
}

const statusOf = (log: Decision[]) => eventStatus(stateOf(log));

/** Score the next race of each named heat, boats in heat order. */
function sail(log: Decision[], ...heats: string[]): Decision[] {
  const out = [...log];
  heats.forEach((id) => {
    const state = stateOf(out);
    const heat = [...state.rounds.flat(), ...(state.fleets ?? [])].find(
      (h) => h.id === id,
    )!;
    out.push({
      type: 'raceScored',
      race: { heat: id, race: heat.races.length + 1 },
      lines: heat.boats.map((boat) => ({ boat })),
    });
  });
  return out;
}

const heat = (status: EventStatus, id: string) =>
  status.heats.find((h) => h.heat === id)!;

const start: Decision[] = [...enter(8), { type: 'heatsCreated', heatCount: 2 }];
const round1 = sail(start, 'A1', 'B1');
const round2 = [...round1, { type: 'roundCreated' } as Decision];

describe('before the heats', () => {
  it('no boats: enter them; nothing else may be done', () => {
    const status = statusOf([]);
    expect(status).toMatchObject({
      series: 'entries',
      round: null,
      heats: [],
      next: { kind: 'enterBoats' },
      createRound: {
        ok: false,
        offered: false,
        reason: 'Create the heats first.',
      },
      undoRound: {
        ok: false,
        offered: false,
        reason: expect.stringMatching(/no qualifying heats yet/),
      },
      startFinal: {
        ok: false,
        offered: false,
        check: 'NO_HEATS',
        reason: 'Create the heats first.',
      },
    });
  });

  it('boats entered: create the heats', () => {
    expect(statusOf(enter(4)).next).toEqual({ kind: 'createHeats' });
  });
});

describe('a qualifying round of several heats', () => {
  it('round 1 not sailed: each heat is to sail; no undo; no Final yet', () => {
    const status = statusOf(start);
    expect(status.series).toBe('qualifying');
    expect(status.round).toBe(1);
    expect(status.next).toEqual({ kind: 'score', heat: 'A1', race: 1 });
    expect(heat(status, 'A1')).toMatchObject({
      races: 0,
      score: { ok: true, offered: true },
      undoRace: {
        ok: false,
        offered: false,
        reason: 'Heat A1 has no scored race, so there is nothing to undo.',
      },
    });
    expect(status.createRound).toEqual({
      ok: false,
      offered: false,
      reason: 'Every heat of this round must sail the same races first.',
    });
    expect(status.undoRound).toEqual({
      ok: false,
      offered: false,
      reason:
        'There is no heat redistribution to undo — these are the first-round heats.',
    });
    expect(status.startFinal).toMatchObject({
      ok: false,
      offered: true,
      check: 'NO_RACES_COMPLETED',
      reason: expect.stringMatching(/SHRS 4\.2/),
      fleets: 2,
    });
  });

  it('one heat sailed: it is not offered again (SHRS 3.1), the other is next', () => {
    const status = statusOf(sail(start, 'A1'));
    expect(status.next).toEqual({ kind: 'score', heat: 'B1', race: 1 });
    // Replay accepts a second race (older records have them): allowed,
    // not offered.
    expect(heat(status, 'A1').score).toEqual({ ok: true, offered: false });
    expect(heat(status, 'A1').undoRace).toEqual({ ok: true, offered: true });
    expect(heat(status, 'B1').score).toEqual({ ok: true, offered: true });
    expect(status.startFinal).toMatchObject({
      ok: false,
      check: 'UNEQUAL_RACE_COUNTS',
      raceCounts: [
        { heat: 'A1', races: 1 },
        { heat: 'B1', races: 0 },
      ],
    });
  });

  it('round sailed: the next round, or the Final Series', () => {
    const status = statusOf(round1);
    expect(status.next).toEqual({
      kind: 'createRound',
      round: 2,
      finalSeries: true,
    });
    expect(status.createRound).toEqual({ ok: true, offered: true });
    expect(status.startFinal).toMatchObject({
      ok: true,
      offered: true,
      check: 'OK',
      completedRaces: 1,
      rule43: false,
    });
  });

  it('round 2 built: it can be undone; the earlier round is closed', () => {
    const status = statusOf(round2);
    expect(status.round).toBe(2);
    expect(status.heats.map((h) => h.heat)).toEqual(['A2', 'B2']);
    expect(status.undoRound).toEqual({ ok: true, offered: true });
    expect(status.startFinal).toMatchObject({
      ok: false,
      offered: true,
      check: 'LATEST_ROUND_UNSAILED',
      reason: expect.stringMatching(/^Round 2 has been built but not sailed/),
    });
    expect(undoRaceVerdict(stateOf(round2), 'A1')).toEqual({
      ok: false,
      reason:
        "The next round (Heat A2, Heat B2) was already built from this round's results, so this race cannot be undone on its own. Undo that round first, then the race.",
    });
  });

  it('round 2 with a race: the round cannot be undone', () => {
    expect(statusOf(sail(round2, 'B2')).undoRound).toEqual({
      ok: false,
      offered: true,
      reason:
        'Cannot undo heat redistribution because the latest heats already contain races. Undo the last race first.',
    });
  });

  it('a heat that sailed twice holds the round up (older records)', () => {
    const status = statusOf(sail(start, 'A1', 'A1', 'B1'));
    expect(status.next.kind).toBe('createRound');
    expect(status.createRound).toEqual({
      ok: false,
      offered: true,
      reason: 'Every heat of this round must sail the same races first.',
    });
    expect(status.startFinal.check).toBe('UNEQUAL_RACE_COUNTS');
  });

  it('a heat with no boats has nothing to sail', () => {
    const log: Decision[] = [
      ...enter(2),
      { type: 'heatsCreated', heatCount: 2 },
      { type: 'boatRemoved', boat: '2' },
    ];
    const status = statusOf(log);
    const empty = status.heats.find((h) => h.boats.length === 0)!;
    expect(empty.score.offered).toBe(false);
  });
});

describe('one heat (SHRS 1.1)', () => {
  const log = sail([...enter(4), { type: 'heatsCreated', heatCount: 1 }], 'A1');

  it('races on in the same heat; no rounds, no Final Series', () => {
    const status = statusOf(log);
    expect(status.next).toEqual({ kind: 'score', heat: 'A1', race: 2 });
    expect(heat(status, 'A1').score).toEqual({ ok: true, offered: true });
    expect(status.createRound).toEqual({
      ok: false,
      offered: false,
      reason: 'With one heat the fleet sails as one; keep scoring races in it.',
    });
    expect(status.startFinal).toMatchObject({
      ok: false,
      offered: false,
      check: 'SINGLE_FLEET',
      reason: 'With one heat there is no Final Series (SHRS 1.1).',
    });
  });
});

describe('the Final Series', () => {
  const final = sail(
    [...round1, { type: 'finalSeriesStarted' } as Decision],
    'Gold',
  );

  it('the fleets sail on; the qualifying series is closed', () => {
    const status = statusOf(final);
    expect(status.series).toBe('final');
    expect(status.round).toBeNull();
    expect(status.heats.map((h) => h.heat)).toEqual(['Gold', 'Silver']);
    expect(status.next).toEqual({ kind: 'score', heat: 'Silver', race: 1 });
    expect(heat(status, 'Gold').score).toEqual({ ok: true, offered: true });
    expect(heat(status, 'Gold').undoRace).toEqual({ ok: true, offered: true });
    expect(status.createRound).toEqual({
      ok: false,
      offered: false,
      reason: 'The Final Series has started.',
    });
    expect(status.undoRound).toMatchObject({ ok: false, offered: false });
    expect(status.startFinal).toMatchObject({
      ok: false,
      offered: false,
      check: 'STARTED',
      reason: 'The Final Series has already started.',
    });
    expect(undoRaceVerdict(stateOf(final), 'A1')).toEqual({
      ok: false,
      reason: 'The Final Series has started: qualifying heats are closed.',
    });
  });

  it('SHRS 4.3 is reported for 6 or 7 completed races', () => {
    let log = round1;
    for (let round = 2; round <= 6; round += 1) {
      log = sail([...log, { type: 'roundCreated' }], `A${round}`, `B${round}`);
    }
    expect(statusOf(log).startFinal).toMatchObject({
      ok: true,
      completedRaces: 6,
      rule43: true,
    });
  });
});

describe('the undos build the new log', () => {
  it('a race leaves with its corrections and protests; RDG2 keeps its other races', () => {
    const log: Decision[] = [
      ...sail([...enter(4), { type: 'heatsCreated', heatCount: 1 }], 'A1'),
    ];
    const withRace2 = sail(log, 'A1');
    const full: Decision[] = [
      ...withRace2,
      {
        type: 'raceCorrected',
        race: { heat: 'A1', race: 2 },
        lines: ['2', '1', '3', '4'].map((boat) => ({ boat })),
      },
      {
        type: 'protestDecided',
        race: { heat: 'A1', race: 2 },
        boat: '3',
        outcome: { kind: 'DSQ' },
      },
    ];
    const withRdg2 = sail(full, 'A1');
    withRdg2.push({
      type: 'protestDecided',
      race: { heat: 'A1', race: 3 },
      boat: '4',
      outcome: {
        kind: 'RDG2',
        races: [
          { heat: 'A1', race: 1 },
          { heat: 'A1', race: 2 },
        ],
      },
    });
    // Race 3 leaves with its RDG2; race 2 with its correction and DSQ.
    const undone3 = undoLastRace(withRdg2, 'A1');
    expect(undone3.ok).toBe(true);
    if (!undone3.ok) return;
    expect(undone3.state.rounds[0][0].races).toHaveLength(2);
    const undone2 = undoLastRace(undone3.log, 'A1');
    expect(undone2.ok && undone2.log).toEqual(log);
  });

  it('a race named by an RDG2 of another heat is taken out of that average', () => {
    const log = sail(start, 'A1', 'B1');
    const b1 = stateOf(log).rounds[0][1].boats[0];
    const withRdg2: Decision[] = [
      ...log,
      {
        type: 'protestDecided',
        race: { heat: 'B1', race: 1 },
        boat: b1,
        outcome: { kind: 'RDG2', races: [{ heat: 'A1', race: 1 }] },
      },
    ];
    const undone = undoLastRace(withRdg2, 'A1');
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const rdg2 = undone.log.find((d) => d.type === 'protestDecided');
    expect(rdg2).toMatchObject({ outcome: { kind: 'RDG2', races: [] } });
  });

  it('refuses in the status’s words', () => {
    expect(undoLastRace(start, 'A1')).toEqual({
      ok: false,
      reason: 'Heat A1 has no scored race, so there is nothing to undo.',
    });
    expect(undoLastRace(round2, 'A1')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^The next round \(Heat A2, Heat B2\)/),
    });
    expect(undoLastRace(start, 'Z9')).toEqual({
      ok: false,
      reason: 'There is no heat Z9.',
    });
    expect(undoLatestRound(round1)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/first-round heats/),
    });
  });

  it('a round leaves with the late entries assigned to it', () => {
    const late: Decision[] = [
      ...round2,
      { type: 'boatEntered', boat: { id: 'L', nat: 'ITA', sail: '7' } },
      { type: 'boatAssigned', boat: 'L', heat: 'B2' },
    ];
    const undone = undoLatestRound(late);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.log).toEqual([...round1, late[late.length - 2]]);
    expect(undone.state.rounds).toHaveLength(1);
  });
});

/** Every heat of the event, current or not. */
const allHeats = (state: EventState): Heat[] => [
  ...state.rounds.flat(),
  ...(state.fleets ?? []),
];

const accepted = (log: Decision[], decision: Decision) =>
  replay([...log, decision]).ok;

describe('random events: the status says what replay says', () => {
  const seeds = Number(process.env.STATUS_SEEDS ?? 40);
  const counts = { allowed: 0, refused: 0 };

  it.each(Array.from({ length: seeds }, (_v, i) => i + 1))(
    'seed %i, every prefix',
    (seed) => {
      const full = randomEvent(seed);
      const rnd = prng(seed * 7919);
      // Some prefixes with a round taken back or a race undone, too.
      const logs: Decision[][] = [];
      for (let n = 0; n <= full.length; n += 1) {
        const log = full.slice(0, n);
        logs.push(log);
        if (rnd() < 0.1) {
          const undone = undoLatestRound(log);
          if (undone.ok) logs.push(undone.log);
        }
      }
      const wrong: string[] = [];
      const say = (when: boolean, what: string) => {
        if (when) wrong.push(what);
      };
      logs.forEach((log, at) => {
        const state = stateOf(log);
        const status = eventStatus(state);
        const verdicts: [string, boolean, boolean][] = [];

        status.heats.forEach((h) => {
          const real = allHeats(state).find((x) => x.id === h.heat)!;
          verdicts.push([
            `score ${h.heat}`,
            h.score.ok,
            accepted(log, {
              type: 'raceScored',
              race: { heat: h.heat, race: h.races + 1 },
              lines: real.boats.map((boat) => ({ boat })),
            }),
          ]);
          verdicts.push([
            `undo ${h.heat}`,
            h.undoRace.ok,
            undoLastRace(log, h.heat).ok,
          ]);
          // A heat being sailed is offered only what it may do.
          say(h.score.offered && !h.score.ok, `score ${h.heat} offered`);
          say(h.undoRace.offered && !h.undoRace.ok, `undo ${h.heat} offered`);
        });
        // Heats of earlier rounds: closed, as replay says.
        allHeats(state)
          .filter((x) => !status.heats.some((h) => h.heat === x.id))
          .forEach((x) => {
            verdicts.push([
              `undo ${x.id} (earlier)`,
              undoRaceVerdict(state, x.id).ok,
              undoLastRace(log, x.id).ok,
            ]);
            say(
              accepted(log, {
                type: 'raceScored',
                race: { heat: x.id, race: x.races.length + 1 },
                lines: x.boats.map((boat) => ({ boat })),
              }),
              `score ${x.id} (earlier) accepted`,
            );
          });
        verdicts.push([
          'create round',
          status.createRound.ok,
          accepted(log, { type: 'roundCreated' }),
        ]);
        verdicts.push([
          'undo round',
          status.undoRound.ok,
          undoLatestRound(log).ok,
        ]);
        verdicts.push([
          'start final',
          status.startFinal.ok,
          accepted(log, { type: 'finalSeriesStarted' }),
        ]);
        // The eligibility code agrees with the verdict.
        say(
          (status.startFinal.check === 'OK') !== status.startFinal.ok,
          `final check ${status.startFinal.check}`,
        );

        verdicts.forEach(([what, said, real]) => {
          say(said !== real, `#${at} ${what}: status ${said}, replay ${real}`);
          counts[said ? 'allowed' : 'refused'] += 1;
        });

        // The next step is one the status allows and offers.
        const { next } = status;
        if (next.kind === 'score') {
          const { score, races } = heat(status, next.heat);
          say(!score.ok || !score.offered, `#${at} next ${next.heat}`);
          say(next.race !== races + 1, `#${at} next race ${next.race}`);
        }
        if (next.kind === 'createRound') {
          say(!status.createRound.offered, `#${at} create round offered`);
          say(
            next.finalSeries !== status.startFinal.ok,
            `#${at} next finalSeries`,
          );
        }
        // Every refusal is worded.
        [
          ...status.heats.flatMap((h) => [h.score, h.undoRace]),
          status.createRound,
          status.undoRound,
          status.startFinal,
        ].forEach((verdict) => {
          say(!verdict.ok && verdict.reason.length < 10, `#${at} unworded`);
        });
      });
      expect(wrong).toEqual([]);
    },
  );

  it('both answers came up often (the check is not vacuous)', () => {
    expect(counts.allowed).toBeGreaterThan(seeds * 10);
    expect(counts.refused).toBeGreaterThan(seeds * 10);
  });
});
