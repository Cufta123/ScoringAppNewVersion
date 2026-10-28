/** @jest-environment node */
export {};

// Deleting an event, and restoring one from a backup, both clear the event's
// data by hand rather than relying on ON DELETE CASCADE (the schema declares
// none). Foreign keys ARE enforced, so "the cascade missed a table" does not
// show up as a stray row — it aborts the entire operation with
// "FOREIGN KEY constraint failed" and the event survives.
//
// Run against a real engine (node:sqlite; better-sqlite3 is built for
// Electron's ABI and will not load under Jest) because the SQL-string mocks
// used elsewhere cannot model constraint enforcement at all.

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
  dialog: { showSaveDialog: jest.fn(), showOpenDialog: jest.fn() },
}));

const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => ({
  db: {
    prepare: (...args: any[]) => mockDbHolder.current.prepare(...args),
    exec: (...args: any[]) => mockDbHolder.current.exec(...args),
    transaction: (fn: (...args: any[]) => any) => {
      // Mirror better-sqlite3: the body runs inside a real transaction, so a
      // constraint failure rolls the whole thing back instead of leaving the
      // event half-deleted.
      return (...args: any[]) => {
        mockDbHolder.current.exec('BEGIN');
        try {
          const result = fn(...args);
          mockDbHolder.current.exec('COMMIT');
          return result;
        } catch (error) {
          mockDbHolder.current.exec('ROLLBACK');
          throw error;
        }
      };
    },
  },
}));

// eslint-disable-next-line import/first, import/order
import {
  EVENT_LIFECYCLE_SCHEMA,
  PER_EVENT_TABLES,
} from './fixtures/eventLifecycleSchema';
// eslint-disable-next-line import/first, import/order
import {
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../main/functions/eventSnapshot';
// eslint-disable-next-line import/first, import/order
import {
  loadPersistedAssignmentSnapshot,
  raceAssignmentSnapshots,
} from '../main/functions/raceAssignmentSnapshot';

const EVENT_ID = 1;
const OTHER_EVENT_ID = 2;

/**
 * A two-round qualifying event with a protest decision recorded, which is the
 * only thing that writes RaceAssignmentSnapshots (raceScoring.ts calls
 * captureRaceAssignmentSnapshotIfMissing only for protest-committee statuses).
 * A second event alongside it proves the delete stays inside its own event.
 */
function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);

  db.exec(`
    INSERT INTO Sailors (sailor_id, name, surname) VALUES (1, 'Ana', 'Horvat'), (2, 'Ivo', 'Marić');
    INSERT INTO Boats (boat_id, sail_number, country, model, sailor_id)
      VALUES (1, 11, 'CRO', 'IOM', 1), (2, 22, 'CRO', 'IOM', 2);

    INSERT INTO Events (event_id, event_name, event_location, start_date, end_date,
      shrs_version, shrs_qualifying_assignment_mode, shrs_discard_profile_qualifying,
      shrs_discard_profile_final, shrs_discard_locked_qualifying,
      shrs_discard_locked_final, shrs_heat_overflow_policy)
      VALUES (${EVENT_ID}, 'Kup Rogoznice', 'Rogoznica', '2026-05-01', '2026-05-03',
        '2026-1', 'progressive', 'standard', 'standard', 0, 0, 'auto-increase');
    INSERT INTO Events (event_id, event_name) VALUES (${OTHER_EVENT_ID}, 'Untouched event');

    INSERT INTO Boat_Event (boat_id, event_id) VALUES (1, ${EVENT_ID}), (2, ${EVENT_ID});
    INSERT INTO Boat_Event (boat_id, event_id) VALUES (1, ${OTHER_EVENT_ID});

    INSERT INTO Heats (heat_id, event_id, heat_name, heat_type)
      VALUES (10, ${EVENT_ID}, 'Heat A1', 'Qualifying'), (11, ${EVENT_ID}, 'Heat A2', 'Qualifying');
    INSERT INTO Heats (heat_id, event_id, heat_name, heat_type)
      VALUES (20, ${OTHER_EVENT_ID}, 'Heat A1', 'Qualifying');

    INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (10, 1), (10, 2), (11, 1), (11, 2);
    INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (20, 1);

    INSERT INTO Races (race_id, heat_id, race_number) VALUES (100, 10, 1), (101, 11, 2);
    INSERT INTO Races (race_id, heat_id, race_number) VALUES (200, 20, 1);

    INSERT INTO Scores (race_id, boat_id, position, points, status)
      VALUES (100, 1, 1, 1, 'FINISHED'), (100, 2, 2, 2, 'FINISHED'),
             (101, 1, 1, 1, 'FINISHED'), (101, 2, 2, 2, 'DSQ');
    INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (200, 1, 1, 1, 'FINISHED');

    INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place) VALUES (1, 2, ${EVENT_ID}, 1);
    INSERT INTO FinalLeaderboard (boat_id, total_points_final, event_id, placement_group, place)
      VALUES (1, 2, ${EVENT_ID}, 'Gold', 1);
    INSERT INTO GlobalLeaderboard (boat_id, total_points_global) VALUES (1, 5);

    -- SHRS 3.1.5: the protest DSQ in race 101 froze that race's assignment order.
    INSERT INTO RaceAssignmentSnapshots (race_id, rank, boat_id, frozen_position, frozen_status)
      VALUES (101, 1, 1, 1, NULL), (101, 2, 2, 2, NULL);
  `);

  mockDbHolder.current = db;
  return db;
}

const countIn = (db: any, table: string, whereEventId = true) => {
  const sql = whereEventId
    ? `SELECT COUNT(*) AS c FROM ${table} WHERE event_id = ?`
    : `SELECT COUNT(*) AS c FROM ${table}`;
  return whereEventId
    ? db.prepare(sql).get(EVENT_ID).c
    : db.prepare(sql).get().c;
};

/** Rows still tied to the deleted event, per table. */
function remainingForEvent(db: any) {
  return {
    Boat_Event: countIn(db, 'Boat_Event'),
    Heats: countIn(db, 'Heats'),
    Leaderboard: countIn(db, 'Leaderboard'),
    FinalLeaderboard: countIn(db, 'FinalLeaderboard'),
    Races: db
      .prepare(
        `SELECT COUNT(*) AS c FROM Races r JOIN Heats h ON h.heat_id = r.heat_id WHERE h.event_id = ?`,
      )
      .get(EVENT_ID).c,
    Scores: db
      .prepare(
        `SELECT COUNT(*) AS c FROM Scores s JOIN Races r ON r.race_id = s.race_id
         JOIN Heats h ON h.heat_id = r.heat_id WHERE h.event_id = ?`,
      )
      .get(EVENT_ID).c,
    Heat_Boat: db
      .prepare(
        `SELECT COUNT(*) AS c FROM Heat_Boat hb JOIN Heats h ON h.heat_id = hb.heat_id WHERE h.event_id = ?`,
      )
      .get(EVENT_ID).c,
    RaceAssignmentSnapshots: db
      .prepare(
        `SELECT COUNT(*) AS c FROM RaceAssignmentSnapshots ras
         JOIN Races r ON r.race_id = ras.race_id
         JOIN Heats h ON h.heat_id = r.heat_id WHERE h.event_id = ?`,
      )
      .get(EVENT_ID).c,
  };
}

describe('deleteEvent', () => {
  let db: any;

  beforeAll(() => {
    // Registers the IPC handlers via module side effects.
    require('../main/ipcHandlers/EventHandler');
  });

  beforeEach(() => {
    db = seed();
  });

  afterEach(() => {
    db.close();
  });

  it('deletes an event that has a protest assignment snapshot', async () => {
    await handlerRegistry.deleteEvent({}, EVENT_ID);

    expect(
      db
        .prepare('SELECT COUNT(*) AS c FROM Events WHERE event_id = ?')
        .get(EVENT_ID).c,
    ).toBe(0);
  });

  it('leaves no row behind in any per-event table', async () => {
    await handlerRegistry.deleteEvent({}, EVENT_ID);

    expect(remainingForEvent(db)).toEqual({
      Boat_Event: 0,
      Heats: 0,
      Races: 0,
      Scores: 0,
      Heat_Boat: 0,
      Leaderboard: 0,
      FinalLeaderboard: 0,
      RaceAssignmentSnapshots: 0,
    });
  });

  it('leaves the database referentially intact', async () => {
    await handlerRegistry.deleteEvent({}, EVENT_ID);

    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('does not touch a second event or the boats themselves', async () => {
    await handlerRegistry.deleteEvent({}, EVENT_ID);

    expect(db.prepare('SELECT COUNT(*) AS c FROM Events').get().c).toBe(1);
    expect(
      db
        .prepare('SELECT COUNT(*) AS c FROM Heats WHERE event_id = ?')
        .get(OTHER_EVENT_ID).c,
    ).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM Scores').get().c).toBe(1);
    expect(countIn(db, 'Boats', false)).toBe(2);
    expect(countIn(db, 'Sailors', false)).toBe(2);
  });
});

describe('event snapshot round trip', () => {
  let db: any;

  beforeEach(() => {
    db = seed();
  });

  afterEach(() => {
    db.close();
  });

  it('restores over an event that has a protest assignment snapshot', () => {
    const snapshot = buildEventSnapshot(EVENT_ID);

    expect(() => restoreEventSnapshot(EVENT_ID, snapshot as any)).not.toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('carries the SHRS 3.1.5 protest shields through the backup', () => {
    // Without these rows the restored event seeds its next round from the
    // live post-protest order, which is exactly what 3.1.5 forbids.
    const snapshot = buildEventSnapshot(EVENT_ID) as any;
    expect(snapshot.tables.RaceAssignmentSnapshots).toHaveLength(2);

    restoreEventSnapshot(EVENT_ID, snapshot);

    expect(
      db
        .prepare(
          'SELECT race_id, rank, boat_id, frozen_position, frozen_status FROM RaceAssignmentSnapshots ORDER BY rank',
        )
        .all(),
    ).toEqual([
      {
        race_id: 101,
        rank: 1,
        boat_id: 1,
        frozen_position: 1,
        frozen_status: null,
      },
      {
        race_id: 101,
        rank: 2,
        boat_id: 2,
        frozen_position: 2,
        frozen_status: null,
      },
    ]);
  });

  it('round trips the whole event unchanged', () => {
    const before = PER_EVENT_TABLES.map((table) => [
      table,
      db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c,
    ]);

    const snapshot = buildEventSnapshot(EVENT_ID);
    restoreEventSnapshot(EVENT_ID, snapshot as any);

    expect(
      PER_EVENT_TABLES.map((table) => [
        table,
        db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c,
      ]),
    ).toEqual(before);
  });

  it('discards the in-memory shields cached before the restore', () => {
    const snapshot = buildEventSnapshot(EVENT_ID) as any;

    // Simulate the app having read (and cached) race 101's shields, then a
    // later protest changing them, before the user restores the backup. The
    // cache is consulted ahead of the table, so a stale entry would outvote
    // the restored rows and the backup would appear not to have taken.
    raceAssignmentSnapshots.set(
      101,
      new Map([['1', { position: 9, status: 'DSQ' }]]),
    );

    restoreEventSnapshot(EVENT_ID, snapshot);

    expect(raceAssignmentSnapshots.has(101)).toBe(false);
    expect([...(loadPersistedAssignmentSnapshot(101) ?? new Map())]).toEqual([
      ['1', { position: 1, status: 'FINISHED' }],
      ['2', { position: 2, status: 'FINISHED' }],
    ]);
  });

  it('rolls back completely when the restore payload is rejected', () => {
    const snapshot = buildEventSnapshot(EVENT_ID) as any;
    const before = db.prepare('SELECT COUNT(*) AS c FROM Scores').get().c;

    expect(() => restoreEventSnapshot(OTHER_EVENT_ID, snapshot)).toThrow(
      'This backup file belongs to a different event',
    );
    expect(db.prepare('SELECT COUNT(*) AS c FROM Scores').get().c).toBe(before);
  });
});
