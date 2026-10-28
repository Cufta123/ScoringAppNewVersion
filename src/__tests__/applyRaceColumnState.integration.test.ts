/** @jest-environment node */
export {};

// Behavioural characterisation of what the leaderboard's Save stores, against
// a REAL SQLite engine (node:sqlite) rather than a string-matching mock.
//
// Save sends every touched race whole. The edit screen builds that race with
// shared/raceColumnEdit (the RRS A6.1 promotion, the place ripple) and the
// main process stores it with applyRaceColumnState, scoring it again from the
// rules (RRS A7, 44.3(c)/T1, SHRS 5.2). These cases run the same two steps and
// assert on the resulting Scores rows, so RRS A6.1, A6.2, A7, A10 and
// SHRS 5.2 / 44.3(c) are pinned end to end. They replaced the suites of the
// removed per-boat `updateRaceResult` channel.
//
// better-sqlite3 is built for Electron's ABI and is not loadable in Jest's Node
// environment, so this uses Node's built-in node:sqlite, whose statement API
// (prepare/get/all/run + exec) matches what the handlers call.

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

/* eslint-disable import/first, import/order */
import {
  applyRaceColumnState,
  getMaxHeatSize,
} from '../main/functions/raceScoring';
import { raceAssignmentSnapshots } from '../main/functions/raceAssignmentSnapshot';
import applyRaceColumnEdit from '../shared/raceColumnEdit';
/* eslint-enable import/first, import/order */

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

/**
 * Correct one boat's result the way the leaderboard does: the shared edit
 * rules build the whole race, which is then stored. `position` is the new
 * place, or the points for RDG/DPI.
 */
function correct(db: any, boatId: number, position: number, status: string) {
  const rows = db
    .prepare(
      'SELECT boat_id, position, points, status FROM Scores WHERE race_id = ? ORDER BY score_id',
    )
    .all(RACE_ID) as Row[];
  const index = rows.findIndex((row) => row.boat_id === boatId);
  const cells = applyRaceColumnEdit(
    rows.map((row) => ({
      position: row.position,
      points: row.points,
      status: row.status,
    })),
    {
      index,
      previousPosition: rows[index].position,
      previousStatus: rows[index].status,
      newPosition: position,
      newPoints: position,
      newStatus: status,
      maxBoats: getMaxHeatSize(EVENT_ID, 'Qualifying'),
    },
  );
  applyRaceColumnState(
    EVENT_ID,
    RACE_ID,
    cells.map((cell, i) => ({
      boatId: rows[i].boat_id,
      position: cell.position,
      status: cell.status,
    })),
  );
}

/** Send cells as they are, without the edit rules (a hand-made request). */
const send = (
  cells: Array<{
    boatId: number;
    position: number;
    status: string;
    edited?: boolean;
  }>,
) => applyRaceColumnState(EVENT_ID, RACE_ID, cells);

const finishers = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    boat_id: i + 1,
    position: i + 1,
    points: i + 1,
    status: 'FINISHED',
  }));

describe('applyRaceColumnState (real sqlite)', () => {
  let db: any;
  afterEach(() => {
    db?.close();
    mockDbHolder.current = null;
  });

  describe('RRS A6.1 — disqualification promotes the boats behind', () => {
    it('moves every boat behind a DSQ up one place', () => {
      db = seed(finishers(4));
      correct(db, 2, 2, 'DSQ');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
      expect(race[4]).toEqual([3, 3, 'FINISHED']);
      // SHRS 5.2: the DSQ is scored at largest heat + 1.
      expect(race[2]).toEqual([5, 5, 'DSQ']);
    });

    it.each(['RET', 'DNE', 'DGM'])('applies to %s as well as DSQ', (status) => {
      db = seed(finishers(3));
      correct(db, 1, 1, status);
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
      correct(db, 2, 0, 'DSQ');
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
      correct(db, 1, 1, 'DSQ');
      const race = readRace(db);
      expect(race[2]).toEqual([1, 1, 'FINISHED']);
      expect(race[3][0]).toBe(2);
      expect(race[3][2]).toBe('ZFP');
    });
  });

  describe('RRS A6.2 / A10 — redress and DPI never move anyone', () => {
    it('leaves every other boat untouched for RDG1', () => {
      db = seed(finishers(4));
      correct(db, 2, 2.5, 'RDG1');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([3, 3, 'FINISHED']);
      expect(race[4]).toEqual([4, 4, 'FINISHED']);
      // The PC-set value is kept verbatim, fractional included.
      expect(race[2]).toEqual([2.5, 2.5, 'RDG1']);
    });

    it('keeps the provided value for DPI without displacing', () => {
      db = seed(finishers(3));
      correct(db, 1, 1.5, 'DPI');
      const race = readRace(db);
      expect(race[1]).toEqual([1.5, 1.5, 'DPI']);
      expect(race[2]).toEqual([2, 2, 'FINISHED']);
      expect(race[3]).toEqual([3, 3, 'FINISHED']);
    });
  });

  describe('a new place moves the boat; the boats in between make room', () => {
    it('ripples the boats between old and new place', () => {
      db = seed(finishers(4));
      // Move the 4th boat up to 2nd: the boats it passes drop one place.
      correct(db, 4, 2, 'FINISHED');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[4]).toEqual([2, 2, 'FINISHED']);
      expect(race[2]).toEqual([3, 3, 'FINISHED']);
      expect(race[3]).toEqual([4, 4, 'FINISHED']);
    });

    it('ripples downward moves too', () => {
      db = seed(finishers(4));
      correct(db, 1, 3, 'FINISHED');
      const race = readRace(db);
      expect(race[2]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
      expect(race[1]).toEqual([3, 3, 'FINISHED']);
      expect(race[4]).toEqual([4, 4, 'FINISHED']);
    });

    it('puts a boat that had no place into the order; the rest move down', () => {
      db = seed(
        [
          { boat_id: 1, position: 1, points: 1, status: 'FINISHED' },
          { boat_id: 2, position: 2, points: 2, status: 'FINISHED' },
          { boat_id: 3, position: 3, points: 3, status: 'FINISHED' },
          { boat_id: 4, position: 11, points: 11, status: 'DNF' },
        ],
        10,
      );
      // Found to have finished 2nd after all.
      correct(db, 4, 2, 'FINISHED');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[4]).toEqual([2, 2, 'FINISHED']);
      expect(race[2]).toEqual([3, 3, 'FINISHED']);
      expect(race[3]).toEqual([4, 4, 'FINISHED']);
    });

    it('giving a redressed boat a place back never puts a boat past the last', () => {
      // Found by the chaos test: 3 boats, the 2nd given redress (her slot left
      // free), then given 3rd place again pushed the 3rd boat to 4th of 3.
      db = seed(
        [
          { boat_id: 1, position: 1, points: 1, status: 'FINISHED' },
          { boat_id: 2, position: 5, points: 5, status: 'RDG3' },
          { boat_id: 3, position: 3, points: 3, status: 'FINISHED' },
        ],
        10,
      );
      correct(db, 2, 3, 'FINISHED');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1, 'FINISHED']);
      expect(race[3]).toEqual([2, 2, 'FINISHED']);
      expect(race[2]).toEqual([3, 3, 'FINISHED']);
    });

    it('keeps a dead heat when a tied boat only gets a ZFP', () => {
      db = seed(
        [
          { boat_id: 1, position: 1, points: 1.5, status: 'FINISHED' },
          { boat_id: 2, position: 1, points: 1.5, status: 'FINISHED' },
          { boat_id: 3, position: 3, points: 3, status: 'FINISHED' },
        ],
        10,
      );
      correct(db, 2, 1, 'ZFP');
      const race = readRace(db);
      expect(race[1]).toEqual([1, 1.5, 'FINISHED']);
      expect(race[2]).toEqual([1, 3.2, 'ZFP']);
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
      correct(db, 3, 2, 'FINISHED');
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
      correct(db, 1, 1, 'DSQ');
      const race = readRace(db);
      // The tied pair takes places 1 and 2 => 1.5 each; the next boat is 3rd.
      expect(race[2]).toEqual([1, 1.5, 'FINISHED']);
      expect(race[3]).toEqual([1, 1.5, 'FINISHED']);
      expect(race[4]).toEqual([3, 3, 'FINISHED']);
    });

    it('re-averages after a move onto an occupied place', () => {
      db = seed(finishers(3));
      correct(db, 3, 1, 'FINISHED');
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
      correct(db, 3, 0, 'DNF');
      expect(readRace(db)[3]).toEqual([11, 11, 'DNF']);
    });

    it('discards the provided position for a non-scoring penalty', () => {
      // A legacy caller may send 0 or a stale place; it must not be written.
      db = seed(finishers(3));
      correct(db, 2, 99, 'DNS');
      expect(readRace(db)[2]).toEqual([4, 4, 'DNS']);
    });
  });

  describe('RRS 44.3(c) / T1 — position-keeping penalty points', () => {
    it('scores ZFP from its finishing place, capped at the DNF score', () => {
      db = seed(finishers(5));
      correct(db, 2, 2, 'ZFP');
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
      // largest heat 10 => DNF score 11 => 20% = 2.2 => 3 + 2.2 = 5.2
      db = seed(finishers(3), 10);
      correct(db, 3, 3, 'ZFP');
      expect(readRace(db)[3]).toEqual([3, 5.2, 'ZFP']);
    });

    it('caps SCP at the DNF score', () => {
      // largest heat 5 => 20% of 6 = 1.2 => 5 + 1.2 = 6.2, capped at 6.
      db = seed(finishers(5), 5);
      correct(db, 5, 5, 'SCP');
      expect(readRace(db)[5]).toEqual([5, 6, 'SCP']);
    });

    it('applies no artificial minimum in a small heat', () => {
      // largest heat 5 => 20% of 6 = 1.2 (no minimum) => 2 + 1.2 = 3.2
      db = seed(finishers(5), 5);
      correct(db, 2, 2, 'ZFP');
      expect(readRace(db)[2]).toEqual([2, 3.2, 'ZFP']);
    });

    it('scores T1 as place + 30% of the DNF score', () => {
      // largest heat 10 => 30% of 11 = 3.3 => 4 + 3.3 = 7.3
      db = seed(finishers(5), 10);
      correct(db, 4, 4, 'T1');
      expect(readRace(db)[4]).toEqual([4, 7.3, 'T1']);
    });
  });

  describe('status normalization and validation', () => {
    it('normalizes RAF to RET', () => {
      db = seed(finishers(3), 10);
      correct(db, 2, 2, 'RAF');
      expect(readRace(db)[2]).toEqual([11, 11, 'RET']);
    });

    it('rejects an unsupported status', () => {
      db = seed(finishers(3));
      expect(() => send([{ boatId: 1, position: 3, status: 'FOO' }])).toThrow(
        '"FOO" is not a result code this app knows.',
      );
    });

    it.each([0, Number.NaN])(
      'rejects %p as a finishing position instead of writing it (BK-6)',
      (position) => {
        db = seed(finishers(3));
        expect(() =>
          send([{ boatId: 1, position, status: 'FINISHED' }]),
        ).toThrow(/must be a whole number of 1 or more/);
      },
    );

    it('rejects a fractional finishing position', () => {
      db = seed(finishers(3));
      expect(() =>
        send([{ boatId: 1, position: 2.5, status: 'FINISHED' }]),
      ).toThrow(/must be a whole number of 1 or more/);
    });

    it.each([
      ['RDG2', 0],
      ['DPI', -1],
    ])(
      'rejects %s with a non-positive value (BK-6 / CMP C-23)',
      (status, value) => {
        db = seed(finishers(3));
        expect(() => send([{ boatId: 1, position: value, status }])).toThrow(
          /must be a number above 0/,
        );
      },
    );

    it('keeps a fractional RDG/DPI value as set by the protest committee', () => {
      db = seed(finishers(3), 10);
      send([
        { boatId: 1, position: 4.5, status: 'RDG3' },
        { boatId: 2, position: 2.5, status: 'DPI' },
      ]);
      const race = readRace(db);
      expect(race[1]).toEqual([4.5, 4.5, 'RDG3']);
      expect(race[2]).toEqual([2.5, 2.5, 'DPI']);
      expect(race[3]).toEqual([3, 3, 'FINISHED']);
    });

    it('refuses a place past the last boat of the race', () => {
      db = seed(finishers(3), 10);
      expect(() =>
        send([{ boatId: 1, position: 4, status: 'FINISHED' }]),
      ).toThrow(/place 4 is not possible, only 3 boats sailed this race/);
    });

    it('refuses redress points above 99', () => {
      db = seed(finishers(3), 10);
      expect(() =>
        send([{ boatId: 1, position: 100, status: 'RDG3' }]),
      ).toThrow(/100 points is more than the 99 allowed/);
    });

    it('leaves the race untouched when an edit is rejected', () => {
      db = seed(finishers(3));
      const before = readRace(db);
      expect(() =>
        send([{ boatId: 1, position: 0, status: 'FINISHED' }]),
      ).toThrow();
      expect(readRace(db)).toEqual(before);
    });

    it('stores a shared place as an A7 average', () => {
      db = seed(finishers(4));
      send([
        { boatId: 2, position: 2, status: 'FINISHED' },
        { boatId: 3, position: 2, status: 'FINISHED' },
      ]);
      const race = readRace(db);
      expect(race[2]).toEqual([2, 2.5, 'FINISHED']);
      expect(race[3]).toEqual([2, 2.5, 'FINISHED']);
    });
  });

  describe('a code with no finishing place moves the boats behind up', () => {
    // RRS A6.1 for DSQ/RET/DNE/DGM, and the same for every other code with
    // no finishing place: a boat that did not start or finish never held the
    // place, so the result equals entering her with that code in the first
    // place. (BFD, UFD, OCS, DNF … used to leave the boats behind a place
    // too low.)
    const NO_PLACE = [
      'DSQ',
      'RET',
      'DNE',
      'DGM',
      'DNF',
      'DNS',
      'OCS',
      'BFD',
      'UFD',
      'DNC',
      'NSC',
    ];

    it.each(NO_PLACE)('%s promotes the boats behind', (status) => {
      db = seed(finishers(3), 10);
      correct(db, 1, 1, status);
      expect(readRace(db)[2][0]).toBe(1);
      expect(readRace(db)[3][0]).toBe(2);
      expect(readRace(db)[1]).toEqual([11, 11, status]);
    });
  });

  describe('SHRS 3.1.5 — only the cells the user edited decide the shield', () => {
    afterEach(() => raceAssignmentSnapshots.clear());

    /**
     * The whole race as the screen sends it after one typed correction: the
     * edit rules build the cells, and only the typed cell is flagged edited.
     */
    function correctFlagged(
      boatId: number,
      position: number,
      status: string,
      flag = true,
    ) {
      const rows = db
        .prepare(
          'SELECT boat_id, position, points, status FROM Scores WHERE race_id = ? ORDER BY score_id',
        )
        .all(RACE_ID) as Row[];
      const index = rows.findIndex((row) => row.boat_id === boatId);
      const cells = applyRaceColumnEdit(
        rows.map((row) => ({
          position: row.position,
          points: row.points,
          status: row.status,
        })),
        {
          index,
          previousPosition: rows[index].position,
          previousStatus: rows[index].status,
          newPosition: position,
          newPoints: position,
          newStatus: status,
          maxBoats: getMaxHeatSize(EVENT_ID, 'Qualifying'),
        },
      );
      send(
        cells.map((cell, i) => ({
          boatId: rows[i].boat_id,
          position: cell.position,
          status: cell.status,
          ...(flag ? { edited: rows[i].boat_id === boatId } : {}),
        })),
      );
    }

    const shielded = () =>
      Object.fromEntries(
        [...(raceAssignmentSnapshots.get(RACE_ID) ?? new Map())].map(
          ([boat, row]) => [boat, [row.position, row.status]],
        ),
      );

    const frozenWholeRace = {
      1: [1, 'FINISHED'],
      2: [2, 'FINISHED'],
      3: [3, 'FINISHED'],
      4: [4, 'FINISHED'],
    };

    it('a DSQ of the winner freezes every boat the promotion moves', () => {
      db = seed(finishers(4));
      correctFlagged(1, 1, 'DSQ');
      expect(readRace(db)[2][0]).toBe(1); // promoted
      expect(shielded()).toEqual(frozenWholeRace);
    });

    it('gives the same shield whatever the order of the stored rows', () => {
      // The winner stored LAST (highest score_id): the promoted boats are
      // processed before her.
      db = seed(finishers(4).reverse());
      correctFlagged(1, 1, 'DSQ');
      expect(shielded()).toEqual(frozenWholeRace);
    });

    it('a protest code on a cell that was not edited decides nothing', () => {
      db = seed(finishers(4));
      send([
        { boatId: 1, position: 1, status: 'DSQ', edited: false },
        { boatId: 2, position: 1, status: 'FINISHED', edited: false },
        { boatId: 3, position: 2, status: 'FINISHED', edited: false },
        { boatId: 4, position: 3, status: 'FINISHED', edited: false },
      ]);
      expect(raceAssignmentSnapshots.get(RACE_ID)).toBeUndefined();
    });

    it('an office correction un-shields only the edited boat', () => {
      db = seed(finishers(4));
      correctFlagged(1, 1, 'DSQ');
      // Live 2nd, 3rd, 4th are boats 2, 3, 4 at 1, 2, 3; the office puts boat
      // 3 last of them.
      correctFlagged(3, 3, 'FINISHED');
      expect(Object.keys(shielded())).toEqual(['1', '2', '4']);
    });

    it('reversing the decision un-shields only the reversed boat', () => {
      db = seed(finishers(4));
      correctFlagged(1, 1, 'DSQ');
      correctFlagged(1, 1, 'FINISHED');
      expect(Object.keys(shielded())).toEqual(['2', '3', '4']);
    });

    it('an edited cell that ends up unchanged touches no shield', () => {
      db = seed(finishers(4));
      correctFlagged(1, 1, 'DSQ');
      correctFlagged(2, 1, 'FINISHED'); // typed the place it already has
      expect(shielded()).toEqual(frozenWholeRace);
    });

    describe('a payload without `edited` flags', () => {
      it('freezes on a protest code (the status changed)', () => {
        db = seed(finishers(4));
        correctFlagged(1, 1, 'DSQ', false);
        expect(shielded()).toEqual(frozenWholeRace);
      });

      it('un-shields only a boat whose status changed', () => {
        db = seed(finishers(4));
        correctFlagged(1, 1, 'DSQ');
        correctFlagged(1, 1, 'FINISHED', false);
        expect(Object.keys(shielded())).toEqual(['2', '3', '4']);
      });

      it('leaves every shield when only places changed', () => {
        db = seed(finishers(4));
        correctFlagged(1, 1, 'DSQ');
        correctFlagged(3, 3, 'FINISHED', false);
        expect(shielded()).toEqual(frozenWholeRace);
      });
    });
  });

  it('rejects an edit for a boat that did not sail the race', () => {
    db = seed(finishers(2));
    expect(() =>
      send([{ boatId: 99, position: 1, status: 'FINISHED' }]),
    ).toThrow(/did not sail .*, so it has no result there/i);
  });

  it('rejects the same boat twice in one race', () => {
    db = seed(finishers(2));
    expect(() =>
      send([
        { boatId: 1, position: 1, status: 'FINISHED' },
        { boatId: 1, position: 2, status: 'FINISHED' },
      ]),
    ).toThrow(/appears twice/i);
  });
});
