/** @jest-environment node */
export {};

// RRS A5.1 (as changed by SHRS 5.2) and SHRS 5.3: every boat entered in the
// series carries a score for every race in it, and a boat that sailed in no
// heat for a round is scored DNC at (largest heat + 1).
//
// Asserted against a REAL SQLite engine (node:sqlite) rather than a
// string-matching mock, because the bug this covers was invisible at the SQL
// level: both readers issued perfectly good queries, and simply disagreed about
// a boat whose score vector was shorter than the series.
//
// better-sqlite3 is built for Electron's ABI and is not loadable in Jest's Node
// environment, so this uses Node's built-in node:sqlite, whose statement API
// matches what the handlers call.

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
}));

const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => ({
  db: {
    prepare: (...args: any[]) => mockDbHolder.current.prepare(...args),
    exec: (...args: any[]) => mockDbHolder.current.exec(...args),
    transaction: (fn: (...args: any[]) => any) => fn,
  },
}));

// eslint-disable-next-line import/first, import/order
import {
  ensureCompleteRaceScoresForEvent,
  ensureDncScoresForMissedQualifyingRaces,
} from '../main/functions/raceScoring';
// eslint-disable-next-line import/first, import/order
import buildAdjustedFleetLeaderboard from '../main/functions/fleetTotals';
// eslint-disable-next-line import/first, import/order
import { normalizeDiscardConfig } from '../shared/discardProfile';

const EVENT_ID = 1;
const ROUNDS = [1, 2, 3, 4];

/** Boats 1-4 sail every round; 99 joins at round 4; 98 is entered but never sails. */
const REGULARS = [1, 2, 3, 4];
const LATE_ENTRANT = 99;
const NEVER_SAILED = 98;

/**
 * A four-round, single-group qualifying series. Heat "A<n>" holds round n, so
 * the round a boat missed is the round whose heat never listed her — exactly
 * the shape `assignBoatToHeat` produces when a boat is added mid-event.
 */
function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE Events (event_id INTEGER PRIMARY KEY);
    CREATE TABLE Boat_Event (
      boat_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER,
      event_id INTEGER
    );
    CREATE TABLE Heats (
      heat_id INTEGER PRIMARY KEY,
      event_id INTEGER NOT NULL,
      heat_name TEXT NOT NULL,
      heat_type TEXT NOT NULL
    );
    CREATE TABLE Races (
      race_id INTEGER PRIMARY KEY,
      heat_id INTEGER NOT NULL,
      race_number INTEGER NOT NULL
    );
    CREATE TABLE Heat_Boat (heat_id INTEGER NOT NULL, boat_id INTEGER NOT NULL);
    CREATE TABLE Scores (
      score_id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL,
      boat_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      points REAL NOT NULL,
      status TEXT NOT NULL
    );
  `);
  db.exec(`INSERT INTO Events (event_id) VALUES (${EVENT_ID});`);

  [...REGULARS, LATE_ENTRANT, NEVER_SAILED].forEach((boat) => {
    db.exec(
      `INSERT INTO Boat_Event (boat_id, event_id) VALUES (${boat}, ${EVENT_ID});`,
    );
  });

  ROUNDS.forEach((round) => {
    db.exec(
      `INSERT INTO Heats (heat_id, event_id, heat_name, heat_type)
       VALUES (${round}, ${EVENT_ID}, 'Heat A${round}', 'Qualifying');`,
    );
    db.exec(
      `INSERT INTO Races (race_id, heat_id, race_number) VALUES (${round}, ${round}, ${round});`,
    );

    // The late entrant appears in the final round's heat only.
    const sailing = round === 4 ? [...REGULARS, LATE_ENTRANT] : [...REGULARS];
    sailing.forEach((boat, index) => {
      const place = index + 1;
      db.exec(
        `INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (${round}, ${boat});`,
      );
      db.exec(
        `INSERT INTO Scores (race_id, boat_id, position, points, status)
         VALUES (${round}, ${boat}, ${place}, ${place}, 'FINISHED');`,
      );
    });
  });

  mockDbHolder.current = db;
  return db;
}

/** The `race_points` / `race_statuses` CSVs the fleet-assignment read builds. */
function fleetLeaderboardRows(db: any) {
  return db
    .prepare(
      `SELECT be.boat_id AS boat_id,
              GROUP_CONCAT(sc.points ORDER BY r.race_number, r.race_id) AS race_points,
              GROUP_CONCAT(sc.status ORDER BY r.race_number, r.race_id) AS race_statuses
       FROM Boat_Event be
       JOIN Scores sc ON sc.boat_id = be.boat_id
       JOIN Races r ON r.race_id = sc.race_id
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE be.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying'
       GROUP BY be.boat_id`,
    )
    .all(EVENT_ID, EVENT_ID);
}

function scoresFor(db: any, boat_id: number) {
  return db
    .prepare(
      `SELECT r.race_number AS race_number, s.points AS points, s.status AS status
       FROM Scores s
       JOIN Races r ON r.race_id = s.race_id
       WHERE s.boat_id = ?
       ORDER BY r.race_number`,
    )
    .all(boat_id);
}

describe('DNC backfill for races a boat missed (RRS A5.1 / SHRS 5.3)', () => {
  let db: any;

  beforeEach(() => {
    db = seed();
  });

  afterEach(() => {
    db.close();
  });

  it('scores a mid-event entrant DNC for the rounds before she joined', () => {
    ensureDncScoresForMissedQualifyingRaces(EVENT_ID);

    // Largest heat is round 4's five boats, so SHRS 5.2 puts DNC at 5 + 1.
    expect(scoresFor(db, LATE_ENTRANT)).toEqual([
      { race_number: 1, points: 6, status: 'DNC' },
      { race_number: 2, points: 6, status: 'DNC' },
      { race_number: 3, points: 6, status: 'DNC' },
      { race_number: 4, points: 5, status: 'FINISHED' },
    ]);
  });

  it('scores a boat that is entered but never sailed DNC for every round', () => {
    ensureDncScoresForMissedQualifyingRaces(EVENT_ID);

    expect(scoresFor(db, NEVER_SAILED)).toEqual([
      { race_number: 1, points: 6, status: 'DNC' },
      { race_number: 2, points: 6, status: 'DNC' },
      { race_number: 3, points: 6, status: 'DNC' },
      { race_number: 4, points: 6, status: 'DNC' },
    ]);
  });

  it('leaves boats that sailed every round untouched', () => {
    ensureDncScoresForMissedQualifyingRaces(EVENT_ID);

    expect(scoresFor(db, 1)).toEqual([
      { race_number: 1, points: 1, status: 'FINISHED' },
      { race_number: 2, points: 1, status: 'FINISHED' },
      { race_number: 3, points: 1, status: 'FINISHED' },
      { race_number: 4, points: 1, status: 'FINISHED' },
    ]);
  });

  it('is idempotent — a second pass backfills nothing', () => {
    const first = ensureDncScoresForMissedQualifyingRaces(EVENT_ID);
    const second = ensureDncScoresForMissedQualifyingRaces(EVENT_ID);

    expect(first).toBe(7); // 3 rounds missed + 4 never sailed
    expect(second).toBe(0);
  });

  it('runs as part of the qualifying data-integrity repair', () => {
    expect(ensureCompleteRaceScoresForEvent(EVENT_ID, 'Qualifying')).toBe(7);
    expect(scoresFor(db, LATE_ENTRANT)).toHaveLength(4);
  });

  it('does not backfill the Final Series (SHRS 4.1/4.5: one fleet per boat)', () => {
    ensureCompleteRaceScoresForEvent(EVENT_ID, 'Final');

    expect(scoresFor(db, LATE_ENTRANT)).toHaveLength(1);
  });

  describe('SHRS 4.2 fleet assignment', () => {
    const totalsByBoat = () => {
      const totals = buildAdjustedFleetLeaderboard(
        fleetLeaderboardRows(db) as any,
        normalizeDiscardConfig('standard'),
      );
      return new Map(totals.map((row) => [row.boat_id, row.totalPoints]));
    };

    it('ranked a mid-event entrant FIRST into Gold before the backfill', () => {
      // The bug: her only score IS her worst, SHRS 5.4 discards it at 4
      // completed races, and nothing is left. Ranking is by ascending total,
      // so 0 puts her ahead of a boat that won every race.
      const totals = totalsByBoat();

      expect(totals.get(LATE_ENTRANT)).toBe(0);
      expect(totals.get(1)).toBe(3);
    });

    it('ranks her last once her missed races are scored DNC', () => {
      ensureDncScoresForMissedQualifyingRaces(EVENT_ID);
      const totals = totalsByBoat();

      // 6 + 6 + 6 + 5, worst (a 6) discarded under SHRS 5.4.
      expect(totals.get(LATE_ENTRANT)).toBe(17);
      // Four DNCs, one discarded.
      expect(totals.get(NEVER_SAILED)).toBe(18);
      // Unchanged: 1,1,1,1 with one discarded.
      expect(totals.get(1)).toBe(3);

      const ranked = [...totals.entries()]
        .sort((left, right) => left[1] - right[1])
        .map(([boat_id]) => boat_id);
      expect(ranked[0]).toBe(1);
      expect(ranked[ranked.length - 1]).toBe(NEVER_SAILED);
    });
  });
});
