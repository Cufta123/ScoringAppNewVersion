/** @jest-environment node */
export {};

// Behavioural characterisation of applyRaceResultUpdate against a REAL SQLite
// engine (node:sqlite) rather than a string-matching mock.
//
// The existing updateRaceResult suites assert on the exact SQL text issued and
// on ordered op-logs, which pins the implementation rather than the rules: any
// change to HOW the result is computed breaks them even when every score comes
// out identical. These cases assert on the resulting Scores rows instead, so
// they hold across a reimplementation and actually verify RRS A6.1, A6.2, A7,
// A10 and SHRS 5.2 / 44.3(c).
//
// better-sqlite3 is built for Electron's ABI and is not loadable in Jest's Node
// environment, so this uses Node's built-in node:sqlite, whose statement API
// (prepare/get/all/run + exec) matches what the handlers call.

// eslint-disable-next-line @typescript-eslint/no-var-requires
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
import { applyRaceResultUpdate } from '../main/functions/raceScoring';

const EVENT_ID = 1;
const HEAT_ID = 1;
const RACE_ID = 1;

interface Row {
  boat_id: number;
  position: number;
  points: number;
  status: string;
}

/**
 * Build an event with a single heat whose race already holds `rows`.
 * `heatSize` controls the SHRS 5.2 penalty score (largest heat + 1); it
 * defaults to the number of rows.
 */
function seed(rows: Row[], heatSize = rows.length) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE Events (event_id INTEGER PRIMARY KEY);
    CREATE TABLE Heats (
      heat_id INTEGER PRIMARY KEY,
      event_id INTEGER NOT NULL,
      heat_type TEXT NOT NULL
    );
    CREATE TABLE Races (
      race_id INTEGER PRIMARY KEY,
      heat_id INTEGER NOT NULL,
      race_number INTEGER NOT NULL
    );
    CREATE TABLE Heat_Boat (heat_id INTEGER NOT NULL, boat_id INTEGER NOT NULL);
    CREATE TABLE Boats (
      boat_id INTEGER PRIMARY KEY,
      country TEXT,
      sail_number TEXT
    );
    -- SHRS 3.1.5 pre-protest assignment freeze; a DSQ edit writes here.
    CREATE TABLE RaceAssignmentSnapshots (
      race_id INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      boat_id INTEGER NOT NULL,
      frozen_position INTEGER,
      frozen_status TEXT,
      PRIMARY KEY (race_id, rank)
    );
    CREATE TABLE Scores (
      score_id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL,
      boat_id INTEGER NOT NULL,
      position REAL NOT NULL,
      points REAL NOT NULL,
      status TEXT
    );
    CREATE TABLE Leaderboard (
      event_id INTEGER, boat_id INTEGER, total_points_event REAL
    );
    CREATE TABLE FinalLeaderboard (
      event_id INTEGER, boat_id INTEGER, total_points_final REAL
    );
  `);
  db.prepare('INSERT INTO Events (event_id) VALUES (?)').run(EVENT_ID);
  db.prepare(
    'INSERT INTO Heats (heat_id, event_id, heat_type) VALUES (?, ?, ?)',
  ).run(HEAT_ID, EVENT_ID, 'Qualifying');
  db.prepare(
    'INSERT INTO Races (race_id, heat_id, race_number) VALUES (?, ?, ?)',
  ).run(RACE_ID, HEAT_ID, 1);

  const addBoat = db.prepare(
    'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
  );
  // Pad the heat membership up to heatSize so getMaxHeatSize (SHRS 5.2)
  // reports the intended largest-heat size.
  const addBoatRow = db.prepare(
    'INSERT INTO Boats (boat_id, country, sail_number) VALUES (?, ?, ?)',
  );
  for (let i = 1; i <= heatSize; i += 1) {
    addBoat.run(HEAT_ID, i);
    addBoatRow.run(i, 'CRO', String(100 + i));
  }

  const addScore = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, ?)`,
  );
  rows.forEach((row) =>
    addScore.run(RACE_ID, row.boat_id, row.position, row.points, row.status),
  );

  mockDbHolder.current = db;
  return db;
}

/** The race's rows, ordered by boat, as { boat: [position, points, status] }. */
function readRace(db: any): Record<number, [number, number, string]> {
  const rows = db
    .prepare(
      'SELECT boat_id, position, points, status FROM Scores WHERE race_id = ? ORDER BY boat_id',
    )
    .all(RACE_ID) as Row[];
  return Object.fromEntries(
    rows.map((r) => [r.boat_id, [r.position, r.points, r.status]]),
  );
}

const finishers = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    boat_id: i + 1,
    position: i + 1,
    points: i + 1,
    status: 'FINISHED',
  }));

describe('applyRaceResultUpdate (real sqlite)', () => {
  let db: any;
  afterEach(() => {
    db?.close();
    mockDbHolder.current = null;
  });

  describe('RRS A6.1 — disqualification promotes the boats behind', () => {
    it('moves every boat behind a DSQ up one place, with shift OFF', () => {
      db = seed(finishers(4));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 2, false, 'DSQ');
      const race = readRace(db);
      // The promotion is mandatory, so it happens even though shift is off.
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
      expect(race[4]).toEqual([3, 3, 'FINISHED']);
      // SHRS 5.2: the DSQ is scored at largest heat + 1.
      expect(race[2]).toEqual([5, 5, 'DSQ']);
    });

    it('promotes identically with shift ON', () => {
      db = seed(finishers(4));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 2, true, 'DSQ');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
      expect(race[4]).toEqual([3, 3, 'FINISHED']);
    });

    it.each(['RET', 'DNE', 'DGM'])('applies to %s as well as DSQ', (status) => {
      db = seed(finishers(3));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 1, false, status);
      const race = readRace(db);
      expect(race[2]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
    });

    it('does not promote when the boat never finished', () => {
      // A boat already DNS has no finishing place to vacate.
      db = seed([
        { boat_id: 1, position: 1, points: 1, status: 'FINISHED' },
        { boat_id: 2, position: 4, points: 4, status: 'DNS' },
        { boat_id: 3, position: 2, points: 2, status: 'FINISHED' },
      ]);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 0, false, 'DSQ');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
    });

    it('carries a position-keeping penalty up with the finishers', () => {
      // RRS 44.3(c): ZFP holds a real place, so it is promoted too, and its
      // points are recomputed from the new place rather than tracking it.
      db = seed([
        { boat_id: 1, position: 1, points: 1, status: 'FINISHED' },
        { boat_id: 2, position: 2, points: 2, status: 'FINISHED' },
        { boat_id: 3, position: 3, points: 3.8, status: 'ZFP' },
      ]);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 1, false, 'DSQ');
      const race = readRace(db);
      expect(race[2]).toEqual([1, 1, 'FINISHED']);
      expect(race[3][0]).toBe(2);
      expect(race[3][2]).toBe('ZFP');
    });
  });

  describe('RRS A6.2 / A10 — redress and DPI never move anyone', () => {
    it('leaves every other boat untouched for RDG1', () => {
      db = seed(finishers(4));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 2.5, true, 'RDG1');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([3, 3, 'FINISHED']);
      expect(race[4]).toEqual([4, 4, 'FINISHED']);
      // The PC-set value is kept verbatim, fractional included.
      expect(race[2]).toEqual([2.5, 2.5, 'RDG1']);
    });

    it('keeps the provided value for DPI without displacing', () => {
      db = seed(finishers(3));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 1.5, true, 'DPI');
      const race = readRace(db);
      expect(race[1]).toEqual([1.5, 1.5, 'DPI']);
      expect(race[2]).toEqual([2, 2, 'FINISHED']);
      expect(race[3]).toEqual([3, 3, 'FINISHED']);
    });
  });

  describe('manual place move — the shift toggle', () => {
    it('ripples the boats between old and new place when shift is ON', () => {
      db = seed(finishers(4));
      // Move the 4th boat up to 2nd: the boats it passes drop one place.
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 4, 2, true, 'FINISHED');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[4]).toEqual([2, 2, 'FINISHED']);
      expect(race[2]).toEqual([3, 3, 'FINISHED']);
      expect(race[3]).toEqual([4, 4, 'FINISHED']);
    });

    it('ripples downward moves too', () => {
      db = seed(finishers(4));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 3, true, 'FINISHED');
      const race = readRace(db);
      expect(race[2]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
      expect(race[1]).toEqual([3, 3, 'FINISHED']);
      expect(race[4]).toEqual([4, 4, 'FINISHED']);
    });

    it('moves only the edited boat when shift is OFF, leaving a tie', () => {
      db = seed(finishers(4));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 4, 2, false, 'FINISHED');
      const race = readRace(db);
      // Deliberate manual override: boat 2 keeps place 2 and the tie stands.
      expect(race[2]).toEqual([2, 2, 'FINISHED']);
      expect(race[4]).toEqual([2, 2, 'FINISHED']);
      expect(race[3]).toEqual([3, 3, 'FINISHED']);
    });

    it('carries position-keeping penalties along the ripple', () => {
      // LB-7: a ZFP occupies a place, so a ripple past it must move it, or the
      // A7 re-average would read its stale place as a shared one.
      db = seed([
        { boat_id: 1, position: 1, points: 1, status: 'FINISHED' },
        { boat_id: 2, position: 2, points: 2.4, status: 'ZFP' },
        { boat_id: 3, position: 3, points: 3, status: 'FINISHED' },
      ]);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 3, 2, true, 'FINISHED');
      const race = readRace(db);
      expect(race[3][0]).toBe(2);
      expect(race[2][0]).toBe(3);
      expect(race[2][2]).toBe('ZFP');
    });
  });

  describe('RRS A7 — shared places split the points', () => {
    it('averages a tie created by a promotion', () => {
      db = seed([
        { boat_id: 1, position: 1, points: 1, status: 'FINISHED' },
        { boat_id: 2, position: 2, points: 2, status: 'FINISHED' },
        { boat_id: 3, position: 2, points: 2, status: 'FINISHED' },
        { boat_id: 4, position: 4, points: 4, status: 'FINISHED' },
      ]);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 1, false, 'DSQ');
      const race = readRace(db);
      // The tied pair takes places 1 and 2 => 1.5 each; the next boat is 3rd.
      expect(race[2]).toEqual([1, 1.5, 'FINISHED']);
      expect(race[3]).toEqual([1, 1.5, 'FINISHED']);
      expect(race[4]).toEqual([3, 3, 'FINISHED']);
    });

    it('re-averages after a shift-on move onto an occupied place', () => {
      db = seed(finishers(3));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 3, 1, true, 'FINISHED');
      const race = readRace(db);
      expect(race[3]).toEqual([1, 1, 'FINISHED']);
      expect(race[1]).toEqual([2, 2, 'FINISHED']);
      expect(race[2]).toEqual([3, 3, 'FINISHED']);
    });
  });

  describe('SHRS 5.2 — non-finishers score largest heat + 1', () => {
    it('uses the largest heat size, not the number of scored boats', () => {
      // Three boats scored, but the heat holds 10 — the DNF scores 11.
      db = seed(finishers(3), 10);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 3, 0, false, 'DNF');
      expect(readRace(db)[3]).toEqual([11, 11, 'DNF']);
    });

    it('discards the provided position for a non-scoring penalty', () => {
      // A legacy caller may send 0 or a stale place; it must not be written.
      db = seed(finishers(3));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 99, false, 'DNS');
      expect(readRace(db)[2]).toEqual([4, 4, 'DNS']);
    });
  });

  describe('RRS 44.3(c) / T1 — position-keeping penalty points', () => {
    it('scores ZFP from its finishing place, capped at the DNF score', () => {
      db = seed(finishers(5));
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 2, false, 'ZFP');
      const [position, points, status] = readRace(db)[2];
      expect(position).toBe(2);
      expect(status).toBe('ZFP');
      // 20% of the DNF score (6) added to the place, capped at 6.
      expect(points).toBeGreaterThan(2);
      expect(points).toBeLessThanOrEqual(6);
    });
  });

  describe('RRS 44.3(c) / T1 — exact penalty points and the cap', () => {
    // Ported from the SQL-asserting updateRaceResult suite, which checked the
    // arguments of an UPDATE statement that no longer exists.
    it('scores ZFP as place + 20% of the DNF score', () => {
      // largest heat 10 => DNF score 11 => 20% = 2 places => 3 + 2 = 5
      db = seed(finishers(3), 10);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 3, 3, false, 'ZFP');
      expect(readRace(db)[3]).toEqual([3, 5, 'ZFP']);
    });

    it('caps SCP at the DNF score', () => {
      // largest heat 5 => 20% = 1 place => 5 + 1 = 6, which is the cap.
      db = seed(finishers(5), 5);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 5, 5, false, 'SCP');
      expect(readRace(db)[5]).toEqual([5, 6, 'SCP']);
    });

    it('applies no artificial minimum in a small heat', () => {
      // largest heat 5 => 20% = 1 place (not floored to 2) => 2 + 1 = 3
      db = seed(finishers(5), 5);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 2, false, 'ZFP');
      expect(readRace(db)[2]).toEqual([2, 3, 'ZFP']);
    });

    it('scores T1 as place + 30% of the DNF score', () => {
      // largest heat 10 => 30% = 3 places => 4 + 3 = 7
      db = seed(finishers(5), 10);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 4, 4, false, 'T1');
      expect(readRace(db)[4]).toEqual([4, 7, 'T1']);
    });
  });

  describe('status normalization and validation', () => {
    it('normalizes RAF to RET', () => {
      db = seed(finishers(3), 10);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 2, 2, false, 'RAF');
      expect(readRace(db)[2]).toEqual([11, 11, 'RET']);
    });

    it('rejects an unsupported status', () => {
      db = seed(finishers(3));
      expect(() =>
        applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 3, false, 'FOO'),
      ).toThrow('Unsupported score status: FOO');
    });

    it.each([0, Number.NaN])(
      'rejects %p as a finishing position instead of writing it (BK-6)',
      (position) => {
        db = seed(finishers(3));
        expect(() =>
          applyRaceResultUpdate(
            EVENT_ID,
            RACE_ID,
            1,
            position,
            false,
            'FINISHED',
          ),
        ).toThrow(/must be a positive integer/);
      },
    );

    it.each([
      ['RDG2', 0],
      ['DPI', -1],
    ])(
      'rejects %s with a non-positive value (BK-6 / CMP C-23)',
      (status, value) => {
        db = seed(finishers(3));
        expect(() =>
          applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, value, false, status),
        ).toThrow(/must be a positive number/);
      },
    );

    it('leaves the race untouched when an edit is rejected', () => {
      db = seed(finishers(3));
      const before = readRace(db);
      expect(() =>
        applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 0, false, 'FINISHED'),
      ).toThrow();
      expect(readRace(db)).toEqual(before);
    });
  });

  describe('RRS A6.1 — displacement happens for exactly four statuses', () => {
    // Replaces the property-based test that asserted on generated SQL.
    const DISPLACING = ['DSQ', 'RET', 'DNE', 'DGM'];
    const NON_DISPLACING = ['DNF', 'DNS', 'OCS', 'BFD', 'UFD', 'DNC', 'NSC'];

    it.each(DISPLACING)('%s promotes the boat behind', (status) => {
      db = seed(finishers(3), 10);
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 1, false, status);
      expect(readRace(db)[2][0]).toBe(1);
      expect(readRace(db)[3][0]).toBe(2);
    });

    it.each(NON_DISPLACING)(
      '%s leaves the boats behind where they are',
      (status) => {
        db = seed(finishers(3), 10);
        applyRaceResultUpdate(EVENT_ID, RACE_ID, 1, 1, false, status);
        expect(readRace(db)[2][0]).toBe(2);
        expect(readRace(db)[3][0]).toBe(3);
      },
    );
  });

  it('rejects an edit for a boat with no result in the race', () => {
    db = seed(finishers(2));
    expect(() =>
      applyRaceResultUpdate(EVENT_ID, RACE_ID, 99, 1, false, 'FINISHED'),
    ).toThrow(/not found/i);
  });
});
