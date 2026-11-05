/** @jest-environment node */
/**
 * Moving a boat between heats (transferBoatBetweenHeats), through the real
 * handler on real SQLite. regatta-core decides (boatMoved); the tables
 * follow. Every refusal leaves the heats as they were.
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
  eventId = await event.createEvent('Transfer');
});
afterEach(() => db.close());

const setUp = async (boats: number, heats: number) => {
  await event.enterBoats(
    eventId,
    Array.from({ length: boats }, (_v, i) => i + 1),
  );
  await call('createInitialHeatsAtomic', eventId, heats);
};
const heat = (name: string) => event.heatId(eventId, name);
const boatOf = (sail: number) =>
  db.prepare('SELECT boat_id FROM Boats WHERE sail_number = ?').get(sail)
    .boat_id;
const heats = () =>
  Object.fromEntries(
    db
      .prepare(
        'SELECT heat_name, heat_id FROM Heats WHERE event_id = ? ORDER BY heat_name',
      )
      .all(eventId)
      .map((h: any) => [h.heat_name, event.sailsIn(h.heat_id)]),
  );
const move = (sail: number, from: string, to: string) =>
  call('transferBoatBetweenHeats', heat(from), heat(to), boatOf(sail));

it('moves the boat', async () => {
  await setUp(4, 2);
  expect(heats()).toEqual({ 'Heat A1': [1, 4], 'Heat B1': [2, 3] });
  await expect(move(4, 'Heat A1', 'Heat B1')).resolves.toEqual({
    success: true,
  });
  expect(heats()).toEqual({ 'Heat A1': [1], 'Heat B1': [2, 3, 4] });
});

it('is a no-op onto her own heat', async () => {
  await setUp(4, 2);
  await expect(move(4, 'Heat A1', 'Heat A1')).resolves.toEqual({
    success: true,
  });
  expect(heats()).toEqual({ 'Heat A1': [1, 4], 'Heat B1': [2, 3] });
});

it('refuses a heat that has raced, and changes nothing', async () => {
  await setUp(4, 2);
  await event.scoreHeat(eventId, 'Heat A1');
  await expect(move(4, 'Heat A1', 'Heat B1')).rejects.toThrow(/A1 has raced/);
  await expect(move(2, 'Heat B1', 'Heat A1')).rejects.toThrow(/A1 has raced/);
  expect(heats()).toEqual({ 'Heat A1': [1, 4], 'Heat B1': [2, 3] });
});

it('refuses a 21st boat (SHRS 2.3)', async () => {
  await setUp(40, 2);
  const [first] = event.sailsIn(heat('Heat A1'));
  await expect(move(first, 'Heat A1', 'Heat B1')).rejects.toThrow(
    /already has 20 boats/,
  );
});

it('refuses a boat no longer in the heat (an old screen)', async () => {
  await setUp(4, 2);
  await move(4, 'Heat A1', 'Heat B1');
  await expect(move(4, 'Heat A1', 'Heat B1')).rejects.toThrow(
    /no longer in the heat it was dragged from/,
  );
  expect(heats()).toEqual({ 'Heat A1': [1], 'Heat B1': [2, 3, 4] });
});

it('refuses heats of two events', async () => {
  await setUp(4, 2);
  const other = await event.createEvent('Other');
  await event.enterBoats(other, [11, 12]);
  await call('createInitialHeatsAtomic', other, 1);
  await expect(
    call(
      'transferBoatBetweenHeats',
      heat('Heat A1'),
      event.heatId(other, 'Heat A1'),
      boatOf(4),
    ),
  ).rejects.toThrow(/same event/);
});

it('refuses a Final Series fleet (SHRS 4.1)', async () => {
  await setUp(4, 2);
  await event.scoreHeat(eventId, 'Heat A1');
  await event.scoreHeat(eventId, 'Heat B1');
  await call('startFinalSeriesAtomic', eventId, true, false);
  const gold = heat('Final Gold');
  const silver = heat('Final Silver');
  const [boat] = event.sailsIn(gold);
  await expect(
    call('transferBoatBetweenHeats', gold, silver, boatOf(boat)),
  ).rejects.toThrow(/SHRS 4.1/);
});
