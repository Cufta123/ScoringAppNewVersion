/** @jest-environment node */
export {};

// A bulk import reports a row as failed ("invalid") and carries on with the
// next one. The rows that failed must leave nothing behind: a sailor and a boat
// created before the failing statement stayed in the database, and the boat was
// still counted as created, so the summary counted one row twice.

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

const count = (db: any, table: string): number =>
  db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

describe('importSailors: a failed row leaves nothing behind', () => {
  let db: any;

  beforeAll(() => {
    require('../main/ipcHandlers/SailorHandler');
  });

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(EVENT_LIFECYCLE_SCHEMA);
    db.exec(`
      ALTER TABLE Sailors ADD COLUMN birthday TEXT;
      ALTER TABLE Sailors ADD COLUMN category_id INTEGER;
      ALTER TABLE Sailors ADD COLUMN club_id INTEGER;
      CREATE TABLE Clubs (club_id INTEGER PRIMARY KEY AUTOINCREMENT, club_name TEXT, country TEXT);
      CREATE TABLE Categories (category_id INTEGER PRIMARY KEY, category_name TEXT);
      INSERT INTO Categories VALUES (3, 'SENIOR');
      INSERT INTO Events (event_id, event_name, event_location, start_date, end_date)
        VALUES (1, 'Kup', 'Split', '2026-05-01', '2026-05-03');
    `);
    mockDbHolder.current = db;
  });

  afterEach(() => {
    db.close();
  });

  const row = (name: string, sail: number, eventId: number) => ({
    name,
    surname: 'Test',
    birthday: '1990-01-01',
    sail_number: sail,
    country: 'CRO',
    model: 'IOM',
    club_name: 'JK Split',
    category_name: 'SENIOR',
    eventId,
  });

  it('a row whose entry in the event fails is rolled back and counted once', async () => {
    // Event 99 does not exist, so the Boat_Event insert (after the sailor and
    // the boat were written) violates its foreign key.
    const summary = await handlerRegistry.importSailors({}, [
      row('Ana', 1, 1),
      row('Bor', 2, 99),
      row('Cvita', 3, 1),
    ]);

    expect(summary.invalid).toBe(1);
    expect(summary.created).toBe(2);
    expect(summary.errors).toHaveLength(1);
    // Only the two good rows exist: no sailor or boat without an entry.
    expect(count(db, 'Sailors')).toBe(2);
    expect(count(db, 'Boats')).toBe(2);
    expect(count(db, 'Boat_Event')).toBe(2);
  });
});
