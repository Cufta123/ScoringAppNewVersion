/** @jest-environment node */
/**
 * Creating the first heats (createInitialHeatsAtomic), through the real
 * handler on real SQLite: the screen's checks (boats it cannot tell
 * apart), then regatta-core's SHRS 3.1(1) draw.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
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
jest.mock('../main/database/DBManager', () => {
  // eslint-disable-next-line global-require
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../main/database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);
const EVENT = 1;
let db: any;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  require('../main/ipcHandlers/HeatRaceHandler');
});
afterAll(() => jest.restoreAllMocks());
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  db.prepare(
    `INSERT INTO Events (event_id, event_name, event_location, start_date, end_date)
     VALUES (?, 'E', 'X', '2026-05-01', '2026-05-02')`,
  ).run(EVENT);
});
afterEach(() => db.close());

/** Entered directly, as older data or an import can hold them. */
const enter = (boats: [string, unknown][]) =>
  boats.forEach(([country, sail], i) => {
    db.prepare(
      'INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (?, ?, ?, ?)',
    ).run(i + 1, sail, country, 'IOM');
    db.prepare('INSERT INTO Boat_Event (boat_id, event_id) VALUES (?, ?)').run(
      i + 1,
      EVENT,
    );
  });
const heats = () =>
  db
    .prepare(
      `SELECT h.heat_name, b.country || ' ' || b.sail_number AS boat
       FROM Heats h JOIN Heat_Boat hb ON hb.heat_id = h.heat_id
       JOIN Boats b ON b.boat_id = hb.boat_id ORDER BY h.heat_name, boat`,
    )
    .all()
    .map((row: any) => `${row.heat_name}: ${row.boat}`);

it('draws two nations sharing a sail number (ITA 12, CRO 12)', async () => {
  enter([
    ['CRO', 101],
    ['AUS', 101],
  ]);
  await expect(call('createInitialHeatsAtomic', EVENT, 2)).resolves.toEqual({
    success: true,
    createdHeats: 2,
    assignedBoats: 2,
  });
  expect(heats()).toEqual(['Heat A1: AUS 101', 'Heat B1: CRO 101']);
});

it('refuses the same boat entered twice, and writes nothing', async () => {
  enter([
    ['CRO', 101],
    ['CRO', 101],
  ]);
  await expect(call('createInitialHeatsAtomic', EVENT, 2)).rejects.toThrow(
    /CRO 101 is entered 2 times/,
  );
  expect(heats()).toEqual([]);
});

it('refuses two boats with no sail number', async () => {
  enter([
    ['CRO', ''],
    ['AUS', ''],
  ]);
  await expect(call('createInitialHeatsAtomic', EVENT, 2)).rejects.toThrow(
    /2 boats have no sail number/,
  );
});

it('draws SHRS 3.1(1): national letters, then sail number, A B B A', async () => {
  enter([
    ['CRO', 3],
    ['CRO', 1],
    ['AUS', 9],
    ['CRO', 2],
  ]);
  await expect(call('createInitialHeatsAtomic', EVENT, 2)).resolves.toEqual({
    success: true,
    createdHeats: 2,
    assignedBoats: 4,
  });
  // Seeded AUS 9, CRO 1, CRO 2, CRO 3 -> A, B, B, A.
  expect(heats()).toEqual([
    'Heat A1: AUS 9',
    'Heat A1: CRO 3',
    'Heat B1: CRO 1',
    'Heat B1: CRO 2',
  ]);
});

it('refuses heats that already exist, and more heats than boats (SHRS 2.1)', async () => {
  enter([
    ['CRO', 1],
    ['CRO', 2],
  ]);
  await expect(call('createInitialHeatsAtomic', EVENT, 3)).rejects.toThrow(
    /2 boats cannot fill 3 heats/,
  );
  await call('createInitialHeatsAtomic', EVENT, 1);
  await expect(call('createInitialHeatsAtomic', EVENT, 1)).rejects.toThrow(
    /Heats already exist/,
  );
});
