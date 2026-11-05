/**
 * Whether the Final Series can start, and the largest heat, as the
 * Scoring page asks for them (functions/libraryEvent.ts): regatta-core's
 * eventStatus on the event's decision log, in the shape the Start Final
 * Series questions read. The scenarios of the old getFinalSeriesEligibility
 * tests, on logs.
 */
import { replay, type Decision } from 'regatta-core';

const mockLog: { current: Decision[] } = { current: [] };
// The eligibility reads nothing but the log (the heats' ids are for
// readEventStatus, tested on a real database in readEventStatus.integration).
jest.mock('../main/database/DBManager', () => ({ db: {} }));
jest.mock('../main/functions/libraryStandings', () => ({
  replayEvent: () => {
    // eslint-disable-next-line global-require
    const { replay: run } = require('regatta-core');
    return { state: run(mockLog.current).state };
  },
}));

/* eslint-disable import/first */
import {
  finalSeriesEligibility,
  largestHeat,
} from '../main/functions/libraryEvent';
/* eslint-enable import/first */

const boats = (n: number): Decision[] =>
  Array.from({ length: n }, (_v, i) => ({
    type: 'boatEntered',
    boat: { id: `b${i + 1}`, nat: 'CRO', sail: String(i + 1) },
  }));
/** A2, B2, … of a 2-heat event: every boat of the heat in entry order. */
const sail = (heat: string, race: number, ...ids: string[]): Decision => ({
  type: 'raceScored',
  race: { heat, race },
  lines: ids.map((boat) => ({ boat })),
});
/** `rounds` complete rounds of a 4-boat, 2-heat event. */
const rounds = (n: number): Decision[] => {
  const log: Decision[] = [...boats(4), { type: 'heatsCreated', heatCount: 2 }];
  for (let r = 1; r <= n; r += 1) {
    if (r > 1) log.push({ type: 'roundCreated' });
    const { state } = replay(log);
    state.rounds[r - 1].forEach((heat) =>
      log.push(sail(heat.id, 1, ...heat.boats)),
    );
  }
  return log;
};
const eligibility = (log: Decision[]) => {
  expect(replay(log).ok).toBe(true);
  mockLog.current = log;
  return finalSeriesEligibility(1);
};

it('NO_HEATS before the heats are made', () => {
  expect(eligibility(boats(4))).toMatchObject({
    ok: false,
    reason: 'NO_HEATS',
  });
});

it('SINGLE_FLEET with one heat (SHRS 1.1)', () => {
  expect(
    eligibility([...boats(4), { type: 'heatsCreated', heatCount: 1 }]),
  ).toMatchObject({ ok: false, reason: 'SINGLE_FLEET', numFinalHeats: 1 });
});

it('UNEQUAL_RACE_COUNTS while a round is being sailed', () => {
  const log: Decision[] = [
    ...boats(4),
    { type: 'heatsCreated', heatCount: 2 },
    sail('A1', 1, 'b1', 'b4'),
  ];
  expect(eligibility(log)).toMatchObject({
    ok: false,
    reason: 'UNEQUAL_RACE_COUNTS',
    raceCountBreakdown: [
      { name: 'Heat A1', count: 1 },
      { name: 'Heat B1', count: 0 },
    ],
  });
});

it('NO_RACES_COMPLETED when nothing is scored (SHRS 4.2)', () => {
  expect(
    eligibility([...boats(4), { type: 'heatsCreated', heatCount: 2 }]),
  ).toMatchObject({
    ok: false,
    reason: 'NO_RACES_COMPLETED',
    completedQualifyingRaces: 0,
    rule43Applies: false,
  });
});

it('eligible, no 4.3 below 6 completed races', () => {
  expect(eligibility(rounds(5))).toMatchObject({
    ok: true,
    reason: 'OK',
    numFinalHeats: 2,
    completedQualifyingRaces: 5,
    rule43Applies: false,
    noRacesCompleted: false,
    latestRoundUnsailed: false,
    latestRoundNumber: 5,
  });
});

it.each([6, 7])('SHRS 4.3 applies with %i completed races', (n) => {
  expect(eligibility(rounds(n))).toMatchObject({
    ok: true,
    completedQualifyingRaces: n,
    rule43Applies: true,
  });
});

it('no 4.3 from 8 completed races', () => {
  expect(eligibility(rounds(8))).toMatchObject({ rule43Applies: false });
});

it('a new round not sailed yet is refused (parity R7)', () => {
  expect(eligibility([...rounds(6), { type: 'roundCreated' }])).toMatchObject({
    ok: false,
    reason: 'LATEST_ROUND_UNSAILED',
    completedQualifyingRaces: 6,
    latestRoundUnsailed: true,
    latestRoundNumber: 7,
  });
});

it('largest heat: per series (SHRS 5.2)', () => {
  mockLog.current = [...boats(5), { type: 'heatsCreated', heatCount: 2 }];
  expect(largestHeat(1, 'Qualifying')).toBe(3);
  expect(largestHeat(1, 'Final')).toBe(0);
  expect(largestHeat(1)).toBe(3);
});
