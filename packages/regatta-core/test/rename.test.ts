/**
 * renameBoats: the same log with the boats given other ids (the ids another
 * database gives them), every decision that names a boat included, and
 * refused in words unless the renaming is one-to-one over the log.
 */
import {
  boatsNamed,
  renameBoats,
  replay,
  resultsOf,
  type Decision,
  type DecisionType,
} from '../src';
import { randomEvent } from './helpers/randomEvent';

/** One decision of every type, each naming boats wherever it can. */
const EVERY_TYPE: Record<DecisionType, Decision> = {
  settingsChanged: {
    type: 'settingsChanged',
    settings: { qualifyingMode: 'pre-assigned' },
  },
  boatEntered: {
    type: 'boatEntered',
    boat: { id: 'b1', nat: 'CRO', sail: '11', name: 'Ana' },
  },
  boatRemoved: { type: 'boatRemoved', boat: 'b2' },
  boatChanged: { type: 'boatChanged', boat: 'b3', sail: '33' },
  heatsCreated: {
    type: 'heatsCreated',
    heatCount: 2,
    seeding: ['b1', 'b3'],
    heats: [['b1'], ['b3']],
  },
  boatAssigned: { type: 'boatAssigned', boat: 'b4', heat: 'A1' },
  boatMoved: { type: 'boatMoved', boat: 'b1', from: 'A1', to: 'B1' },
  raceScored: {
    type: 'raceScored',
    race: { heat: 'A1', race: 1 },
    lines: [
      { boat: 'b1' },
      { boat: 'b3', tied: true, penalty: 'ZFP' },
      { boat: 'b4', code: 'DNF' },
    ],
  },
  raceCorrected: {
    type: 'raceCorrected',
    race: { heat: 'A1', race: 1 },
    lines: [{ boat: 'b3' }, { boat: 'b1' }],
  },
  protestDecided: {
    type: 'protestDecided',
    race: { heat: 'A1', race: 1 },
    boat: 'b3',
    outcome: { kind: 'RDG2', races: [{ heat: 'B1', race: 1 }] },
  },
  roundCreated: { type: 'roundCreated', heats: [['b3', 'b1'], ['b4']] },
  finalSeriesStarted: {
    type: 'finalSeriesStarted',
    rule43: false,
    fleets: [['b1'], ['b3', 'b4']],
  },
};

const NAMES = { b1: '101', b2: '102', b3: '103', b4: '104' };

describe('renameBoats', () => {
  it('renames the boat in every decision type that names one', () => {
    const log = Object.values(EVERY_TYPE);
    const result = renameBoats(log, NAMES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byType = Object.fromEntries(result.log.map((d) => [d.type, d]));
    expect(byType).toEqual({
      settingsChanged: EVERY_TYPE.settingsChanged,
      boatEntered: {
        type: 'boatEntered',
        boat: { id: '101', nat: 'CRO', sail: '11', name: 'Ana' },
      },
      boatRemoved: { type: 'boatRemoved', boat: '102' },
      boatChanged: { type: 'boatChanged', boat: '103', sail: '33' },
      heatsCreated: {
        type: 'heatsCreated',
        heatCount: 2,
        seeding: ['101', '103'],
        heats: [['101'], ['103']],
      },
      boatAssigned: { type: 'boatAssigned', boat: '104', heat: 'A1' },
      boatMoved: { type: 'boatMoved', boat: '101', from: 'A1', to: 'B1' },
      raceScored: {
        type: 'raceScored',
        race: { heat: 'A1', race: 1 },
        lines: [
          { boat: '101' },
          { boat: '103', tied: true, penalty: 'ZFP' },
          { boat: '104', code: 'DNF' },
        ],
      },
      raceCorrected: {
        type: 'raceCorrected',
        race: { heat: 'A1', race: 1 },
        lines: [{ boat: '103' }, { boat: '101' }],
      },
      protestDecided: {
        type: 'protestDecided',
        race: { heat: 'A1', race: 1 },
        boat: '103',
        outcome: { kind: 'RDG2', races: [{ heat: 'B1', race: 1 }] },
      },
      roundCreated: { type: 'roundCreated', heats: [['103', '101'], ['104']] },
      finalSeriesStarted: {
        type: 'finalSeriesStarted',
        rule43: false,
        fleets: [['101'], ['103', '104']],
      },
    });
  });

  it('keeps the optional fields a decision does not have absent', () => {
    const log: Decision[] = [
      { type: 'heatsCreated', heatCount: 1 },
      { type: 'roundCreated' },
      { type: 'finalSeriesStarted' },
    ];
    expect(renameBoats(log, {})).toEqual({ ok: true, log });
  });

  it('leaves the log it was given as it was', () => {
    const log = Object.values(EVERY_TYPE);
    const before = JSON.parse(JSON.stringify(log));
    renameBoats(log, NAMES);
    expect(log).toEqual(before);
  });

  it('lists every boat the log names, in order', () => {
    expect(boatsNamed(Object.values(EVERY_TYPE))).toEqual([
      'b1',
      'b2',
      'b3',
      'b4',
    ]);
  });

  describe('refuses a renaming that is not one-to-one', () => {
    it('a boat with no new id, named by her sail number', () => {
      const { b3: _b3, ...names } = NAMES;
      const log: Decision[] = [
        ...Object.values(EVERY_TYPE),
        {
          type: 'boatEntered',
          boat: { id: 'b3', nat: 'ITA', sail: '33' },
        },
      ];
      expect(renameBoats(log, names)).toEqual({
        ok: false,
        reason: 'Boat ITA 33 has no new id, so the boats were not renamed.',
      });
    });

    it('a boat named only in a race (never entered) by her id', () => {
      const log: Decision[] = [
        {
          type: 'raceScored',
          race: { heat: 'A1', race: 1 },
          lines: [{ boat: 'b1' }, { boat: 'ghost' }],
        },
      ];
      const result = renameBoats(log, NAMES);
      expect(result).toEqual({
        ok: false,
        reason: 'Boat “ghost” has no new id, so the boats were not renamed.',
      });
    });

    it('two boats given the same id', () => {
      const log: Decision[] = [
        { type: 'boatEntered', boat: { id: 'b1', nat: 'CRO', sail: '11' } },
        { type: 'boatEntered', boat: { id: 'b2', nat: 'CRO', sail: '22' } },
      ];
      expect(renameBoats(log, { b1: '7', b2: '7' })).toEqual({
        ok: false,
        reason:
          'Boats CRO 11 and CRO 22 would both be “7”, so the boats were not renamed.',
      });
    });

    it('two ids for one boat in the renaming, even one the log does not name', () => {
      const log: Decision[] = [
        { type: 'boatEntered', boat: { id: 'b1', nat: 'CRO', sail: '11' } },
      ];
      expect(renameBoats(log, { b1: '7', b9: '7' }).ok).toBe(false);
    });
  });

  describe('a renamed event is the same event', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

    it.each(seeds)(
      'seed %i: same results, and renamed back is the log',
      (seed) => {
        const log = randomEvent(seed);
        const boats = boatsNamed(log);
        // Reversed and of another shape, so nothing can lean on the old ids'
        // order.
        const names = Object.fromEntries(
          boats.map((id, i) => [id, `x${boats.length - i}`]),
        );
        const renamed = renameBoats(log, names);
        expect(renamed.ok).toBe(true);
        if (!renamed.ok) return;

        const before = replay(log);
        const after = replay(renamed.log);
        expect(before.ok && after.ok).toBe(true);
        if (!before.ok || !after.ok) return;
        const expected = JSON.parse(
          JSON.stringify(resultsOf(before.state)).replace(
            /"(b\d+)"/g,
            (_, id: string) => `"${names[id]}"`,
          ),
        );
        expect(resultsOf(after.state)).toEqual(expected);

        const back = renameBoats(
          renamed.log,
          Object.fromEntries(Object.entries(names).map(([a, b]) => [b, a])),
        );
        expect(back).toEqual({ ok: true, log });
      },
    );
  });
});
