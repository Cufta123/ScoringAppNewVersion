/** @jest-environment node */
/**
 * Starting the Final Series (startFinalSeriesAtomic), through the real
 * handler on real SQLite: regatta-core splits the fleets (SHRS 4.1-4.3,
 * finalSeriesStarted); the handler keeps the oversize confirmation and its
 * refusals in the screen's terms. 4.3 and the split arithmetic are tested
 * in packages/regatta-core.
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
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

/* eslint-disable import/first, import/order */
import { realEvent } from './fixtures/realEvent';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

let db: any;
let event: ReturnType<typeof realEvent>;
let eventId: number;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  require('../main/ipcHandlers/EventHandler');
  require('../main/ipcHandlers/HeatRaceHandler');
});
afterAll(() => jest.restoreAllMocks());

/** CRO 1 … CRO n in `heats` heats (SHRS 3: A1 = 1, 4, 5, 8…). */
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  event = realEvent(db, call);
  eventId = await event.createEvent('Final');
});
afterEach(() => db.close());

/** n boats in `heats` heats, one round sailed in sail-number order. */
const sailedRound = async (n: number, heats: number) => {
  await event.enterBoats(
    eventId,
    Array.from({ length: n }, (_v, i) => i + 1),
  );
  await call('createInitialHeatsAtomic', eventId, heats);
  for (let h = 0; h < heats; h += 1) {
    // eslint-disable-next-line no-await-in-loop
    await event.scoreHeat(eventId, `Heat ${String.fromCharCode(65 + h)}1`);
  }
};
const start = (confirmOversize = false, rule43 = true) =>
  call('startFinalSeriesAtomic', eventId, confirmOversize, rule43);
const fleets = () =>
  Object.fromEntries(
    db
      .prepare(
        "SELECT heat_name, heat_id FROM Heats WHERE event_id = ? AND heat_type = 'Final'",
      )
      .all(eventId)
      .map((h: any) => [h.heat_name, event.sailsIn(h.heat_id)]),
  );

it('splits by the qualifying ranking, best to Gold (SHRS 4.2)', async () => {
  await sailedRound(8, 2);
  // A1: 1, 4, 5, 8 and B1: 2, 3, 6, 7 finish in sail order: 1 and 2 win
  // (1 point, never met: they share 1st), then 3 / 4, 5 / 6, 7 / 8.
  await expect(start()).resolves.toMatchObject({
    success: true,
    createdHeats: 2,
    assignedBoats: 8,
  });
  expect(fleets()).toEqual({
    'Final Gold': [1, 2, 3, 4],
    'Final Silver': [5, 6, 7, 8],
  });
});

it('splits 77 boats in 4 heats 20 / 19 / 19 / 19 (SHRS 4.1)', async () => {
  await sailedRound(77, 4);
  await start();
  expect(
    Object.fromEntries(Object.entries(fleets()).map(([k, v]) => [k, v.length])),
  ).toEqual({
    'Final Gold': 20,
    'Final Silver': 19,
    'Final Bronze': 19,
    'Final Copper': 19,
  });
});

it('adds a fleet when the fleets would pass 20 boats (SHRS 2.3)', async () => {
  await sailedRound(40, 2);
  await event.enterBoats(eventId, [41]); // late: no heat, DNC
  await start();
  expect(Object.keys(fleets())).toHaveLength(3);
});

it('asks before oversize fleets when the event says so', async () => {
  await sailedRound(40, 2);
  await event.enterBoats(eventId, [41]);
  db.prepare(
    "UPDATE Events SET shrs_heat_overflow_policy = 'confirm-allow-oversize' WHERE event_id = ?",
  ).run(eventId);
  await expect(start(false)).rejects.toThrow(/Confirm oversize/);
  expect(fleets()).toEqual({});
  await start(true);
  expect(Object.values(fleets()).map((f) => f.length)).toEqual([21, 20]);
});

it('refuses with a round built but not sailed (parity R7)', async () => {
  await sailedRound(8, 2);
  await call('createNewHeatsBasedOnLeaderboard', eventId);
  await expect(start()).rejects.toThrow(/Undo that round first/);
  expect(fleets()).toEqual({});
});

it('refuses a second start, one heat, and nothing scored', async () => {
  await event.enterBoats(eventId, [1, 2, 3, 4]);
  await call('createInitialHeatsAtomic', eventId, 2);
  await expect(start()).rejects.toThrow();
  await event.scoreHeat(eventId, 'Heat A1');
  await event.scoreHeat(eventId, 'Heat B1');
  await start();
  await expect(start()).rejects.toThrow(/already been started/);
});

it('refuses one heat (SHRS 1.1)', async () => {
  await sailedRound(4, 1);
  await expect(start()).rejects.toThrow(/at least 2 qualifying heats/);
});
