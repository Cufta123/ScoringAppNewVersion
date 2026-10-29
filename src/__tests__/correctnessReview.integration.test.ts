/** @jest-environment node */
export {};

// Correctness review: bugs found by reading the business logic, each pinned by
// a test that failed before its fix. Real SQLite engine, foreign keys on, the
// real IPC handlers (same harness as HeatRaceHandler.undoAndGuards.integration).

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
  app: { getPath: jest.fn(() => '/tmp') },
}));

const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

// eslint-disable-next-line import/first, import/order
import { EVENT_LIFECYCLE_SCHEMA } from './fixtures/eventLifecycleSchema';
// eslint-disable-next-line import/first, import/order
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';

const EVENT_ID = 1;

function seed(boatCount: number) {
  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);
  db.exec(`
    CREATE TABLE Categories (category_id INTEGER PRIMARY KEY, category_name TEXT);
    ALTER TABLE Sailors ADD COLUMN category_id INTEGER;
    INSERT INTO Events (event_id, event_name, event_location, start_date, end_date,
      shrs_version, shrs_qualifying_assignment_mode, shrs_discard_profile_qualifying,
      shrs_discard_profile_final, shrs_discard_locked_qualifying,
      shrs_discard_locked_final, shrs_heat_overflow_policy)
      VALUES (${EVENT_ID}, 'Kup', 'Split', '2026-05-01', '2026-05-03',
        '2026-1', 'progressive', 'standard', 'standard', 0, 0, 'auto-increase');
  `);
  for (let i = 1; i <= boatCount; i += 1) {
    db.exec(
      `INSERT INTO Sailors (sailor_id, name, surname) VALUES (${i}, 'S${i}', 'X${i}');
       INSERT INTO Boats (boat_id, sail_number, country, model, sailor_id) VALUES (${i}, ${i}, 'CRO', 'IOM', ${i});
       INSERT INTO Boat_Event (boat_id, event_id) VALUES (${i}, ${EVENT_ID});`,
    );
  }
  mockDbHolder.current = db;
  return db;
}

const heatId = (db: any, name: string): number =>
  db
    .prepare('SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?')
    .get(EVENT_ID, name).heat_id;

describe('correctness review (real SQLite, FKs on)', () => {
  let db: any;

  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    invalidateAssignmentSnapshotCache();
  });

  afterEach(() => {
    db.close();
  });

  describe('a boat whose sailor row is missing', () => {
    it('still appears among the boats of her heat (scoring screen, starting list)', async () => {
      db = seed(4);
      // Boats.sailor_id is nullable (older imports, restored backups); every
      // other read LEFT JOINs the sailor and keeps such a boat.
      db.exec('UPDATE Boats SET sailor_id = NULL WHERE boat_id = 3');
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 1);

      const inHeat = db.prepare('SELECT COUNT(*) AS c FROM Heat_Boat').get()
        .c as number;
      const listed = await handlerRegistry.readBoatsByHeat(
        {},
        heatId(db, 'Heat A1'),
      );

      expect(inHeat).toBe(4);
      expect(listed.map((b: any) => b.boat_id).sort()).toEqual([1, 2, 3, 4]);
    });
  });
});
