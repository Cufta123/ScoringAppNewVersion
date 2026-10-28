/** @jest-environment node */
export {};

// "Recreate Heats" throws the current heats away and seeds them again from
// scratch. That is two steps, and the destructive one runs first, so if the
// second step is rejected the event must not be left with no heats at all.
//
// Run against a real SQLite engine so the assertion is what the database
// actually holds afterwards, not what a mock was asked to do.

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
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order, global-require
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

// eslint-disable-next-line import/first, import/order
import { EVENT_LIFECYCLE_SCHEMA } from './fixtures/eventLifecycleSchema';

const EVENT_ID = 1;

/** `count` entries with distinct sail numbers, no heats yet. */
function seed(count = 9) {
  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);
  db.exec(
    `INSERT INTO Events (event_id, event_name) VALUES (${EVENT_ID}, 'Kup');`,
  );
  for (let i = 1; i <= count; i += 1) {
    db.exec(
      `INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (${i}, ${i}, 'CRO', 'IOM');
       INSERT INTO Boat_Event (boat_id, event_id) VALUES (${i}, ${EVENT_ID});`,
    );
  }
  mockDbHolder.current = db;
  return db;
}

const heatNames = (db: any) =>
  db
    .prepare('SELECT heat_name FROM Heats WHERE event_id = ? ORDER BY heat_id')
    .all(EVENT_ID)
    .map((row: { heat_name: string }) => row.heat_name);

const assignmentCount = (db: any) =>
  db.prepare('SELECT COUNT(*) AS c FROM Heat_Boat').get().c;

describe('recreateInitialHeatsAtomic', () => {
  let db: any;

  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(async () => {
    db = seed();
    await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 3);
  });

  afterEach(() => {
    db.close();
  });

  it('replaces the heats with a new split', async () => {
    expect(heatNames(db)).toEqual(['Heat A1', 'Heat B1', 'Heat C1']);

    await handlerRegistry.recreateInitialHeatsAtomic({}, EVENT_ID, 2);

    expect(heatNames(db)).toEqual(['Heat A1', 'Heat B1']);
    expect(assignmentCount(db)).toBe(9);
  });

  it('keeps the existing heats when the new split is rejected', async () => {
    const before = heatNames(db);
    // The same sail entered twice is the realistic trigger: the entry list is
    // edited after the heats were built, and no one could tell the two boats
    // apart when scoring, so the new split is refused.
    db.exec(
      `INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (99, 1, 'CRO', 'IOM');
       INSERT INTO Boat_Event (boat_id, event_id) VALUES (99, ${EVENT_ID});`,
    );

    await expect(
      handlerRegistry.recreateInitialHeatsAtomic({}, EVENT_ID, 3),
    ).rejects.toThrow('CRO 1 is entered 2 times');

    expect(heatNames(db)).toEqual(before);
    expect(assignmentCount(db)).toBe(9);
  });

  it('keeps the existing heats when the boats would not fit', async () => {
    const before = heatNames(db);

    await expect(
      handlerRegistry.recreateInitialHeatsAtomic({}, EVENT_ID, 0),
    ).rejects.toThrow('Number of heats must be between 1 and 26.');

    expect(heatNames(db)).toEqual(before);
    expect(assignmentCount(db)).toBe(9);
  });

  it('refuses once a race has been scored, without touching the heats', async () => {
    const heatId = db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ? ORDER BY heat_id')
      .get(EVENT_ID).heat_id;
    db.exec(
      `INSERT INTO Races (race_id, heat_id, race_number) VALUES (500, ${heatId}, 1);`,
    );
    const before = heatNames(db);

    await expect(
      handlerRegistry.recreateInitialHeatsAtomic({}, EVENT_ID, 2),
    ).rejects.toThrow('races have already been scored');

    expect(heatNames(db)).toEqual(before);
    expect(assignmentCount(db)).toBe(9);
  });

  it('seeds identically to creating the heats on an empty event', async () => {
    await handlerRegistry.recreateInitialHeatsAtomic({}, EVENT_ID, 3);
    const viaRecreate = db
      .prepare(
        `SELECT h.heat_name, hb.boat_id FROM Heat_Boat hb
         JOIN Heats h ON h.heat_id = hb.heat_id
         ORDER BY h.heat_name, hb.boat_id`,
      )
      .all();

    db.exec('DELETE FROM Heat_Boat; DELETE FROM Heats;');
    await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 3);
    const viaFreshCreate = db
      .prepare(
        `SELECT h.heat_name, hb.boat_id FROM Heat_Boat hb
         JOIN Heats h ON h.heat_id = hb.heat_id
         ORDER BY h.heat_name, hb.boat_id`,
      )
      .all();

    expect(viaRecreate).toEqual(viaFreshCreate);
  });
});
