/** @jest-environment node */
/**
 * The projection round trip: an event as regatta-core works it out,
 * written into the app's tables (projectEvent) and read back as a log
 * (eventToLog), replays to the same heats, races and results, with nothing
 * reported as an anomaly. Events from the library's random generator.
 */
import {
  finalStandings,
  overallStandings,
  qualifyingStandings,
  replay,
  type Decision,
  type EventState,
} from 'regatta-core';
import { randomEvent } from 'regatta-core/test/helpers/randomEvent';

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../main/database/schema');

const mockDbHolder: { current: any } = { current: null };
jest.mock('../main/database/DBManager', () => {
  // eslint-disable-next-line global-require
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

// The modules under test read the mocked database: imported after it.
/* eslint-disable import/first, import/order */
import projectEvent from '../main/functions/projectEvent';
import { checkEventLog, eventToLog } from '../main/functions/eventLog';
/* eslint-enable import/first, import/order */

const EVENT_ID = 1;
const SEEDS = Array.from(
  { length: Number(process.env.ROUNDTRIP_SEEDS ?? 80) },
  (_v, i) => i + 1,
);

/** The library generator names boats "b7"; app boats are numbered. */
const numbered = (log: Decision[]): Decision[] =>
  JSON.parse(JSON.stringify(log).replace(/"b(\d+)"/g, '"$1"'));

/** What the screens show: heats, and every boat's results and places. */
function summary(state: EventState) {
  const q = qualifyingStandings(state);
  return {
    heats: [...state.rounds.flat(), ...(state.fleets ?? [])].map((heat) => [
      heat.id,
      [...heat.boats].sort(),
      heat.races.length,
    ]),
    qualifying: q.standings.map((s) => [
      s.boat,
      s.place,
      s.total,
      s.scores.map((score) => [score.code ?? '', score.points, score.excluded]),
    ]),
    pending: q.pending,
    final: finalStandings(state).map((fleet) =>
      fleet.standings.map((s) => [
        s.boat,
        s.place,
        s.total,
        s.scores.map((score) => [score.code ?? '', score.points]),
      ]),
    ),
    overall: overallStandings(state).map((s) => [s.boat, s.place, s.total]),
  };
}

describe.each(SEEDS)('random event %i', (seed) => {
  it('projects and reads back as the same event', () => {
    const log = numbered(randomEvent(seed));
    const original = replay(log);
    expect(original.ok).toBe(true);

    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
    db.prepare(
      `INSERT INTO Events (event_id, event_name, event_location, start_date, end_date)
       VALUES (?, 'E', 'X', '2026-11-01', '2026-11-02')`,
    ).run(EVENT_ID);
    original.state.boats.forEach((boat) =>
      db
        .prepare(
          'INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (?, ?, ?, ?)',
        )
        .run(Number(boat.id), Number(boat.sail), boat.nat, 'IOM'),
    );

    projectEvent(EVENT_ID, original.state);
    const back = eventToLog(EVENT_ID);
    expect(back.anomalies).toEqual([]);
    expect(checkEventLog(EVENT_ID, back)).toEqual([]);
    const again = replay(back.decisions);
    expect(again.ok).toBe(true);
    expect(summary(again.state)).toEqual(summary(original.state));

    // Projecting the same state again changes nothing.
    const before = db.prepare('SELECT COUNT(*) AS n FROM ChangeLog').get().n;
    projectEvent(EVENT_ID, original.state);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ChangeLog').get().n).toBe(
      before,
    );
    db.close();
  });
});
