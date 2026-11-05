/** @jest-environment node */
/**
 * The next qualifying round (createNewHeatsBasedOnLeaderboard) and taking
 * it back (undoLatestHeatRedistribution), through the real handlers on real
 * SQLite. regatta-core builds the round (roundCreated: the SHRS 3.1 Heat
 * Movement Table, or 3.2 pre-assignment); an undo takes it out of the log.
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
  eventId = await event.createEvent('Rounds');
});
afterEach(() => db.close());

const setUp = async (boats: number, heats: number) => {
  await event.enterBoats(
    eventId,
    Array.from({ length: boats }, (_v, i) => i + 1),
  );
  await call('createInitialHeatsAtomic', eventId, heats);
};
const heats = () =>
  Object.fromEntries(
    db
      .prepare(
        'SELECT heat_name, heat_id FROM Heats WHERE event_id = ? ORDER BY heat_name',
      )
      .all(eventId)
      .map((h: any) => [h.heat_name, event.sailsIn(h.heat_id)]),
  );
const nextRound = () => call('createNewHeatsBasedOnLeaderboard', eventId);
const undoRound = () => call('undoLatestHeatRedistribution', eventId);

it('moves boats by the Heat Movement Table (SHRS 3.1(ii))', async () => {
  await setUp(8, 2); // A1: 1, 4, 5, 8; B1: 2, 3, 6, 7
  await event.scoreHeat(eventId, 'Heat A1'); // 1, 4, 5, 8 finish in order
  await event.scoreHeat(eventId, 'Heat B1', true); // 7, 6, 3, 2
  await expect(nextRound()).resolves.toMatchObject({ success: true });
  // 1st stays, 2nd goes to the other heat, 3rd stays, 4th goes:
  // A1 1, 4, 5, 8 -> 1, 5 stay; 4, 8 to B. B1 7, 6, 3, 2 -> 7, 3 stay; 6, 2 to A.
  expect(heats()).toMatchObject({
    'Heat A2': [1, 2, 5, 6],
    'Heat B2': [3, 4, 7, 8],
  });
});

it('keeps every boat in her heat when pre-assigned (SHRS 3.2)', async () => {
  await setUp(8, 2);
  const id = db.prepare('SELECT * FROM Events WHERE event_id = ?').get(eventId);
  db.prepare(
    "UPDATE Events SET shrs_qualifying_assignment_mode = 'pre-assigned' WHERE event_id = ?",
  ).run(id.event_id);
  await event.scoreHeat(eventId, 'Heat A1');
  await event.scoreHeat(eventId, 'Heat B1', true);
  await nextRound();
  expect(heats()).toMatchObject({
    'Heat A2': [1, 4, 5, 8],
    'Heat B2': [2, 3, 6, 7],
  });
});

it('refuses while a heat of the round has not sailed, and writes nothing', async () => {
  await setUp(8, 2);
  await event.scoreHeat(eventId, 'Heat A1');
  await expect(nextRound()).rejects.toThrow(
    /not all|same races|same number of races/i,
  );
  expect(Object.keys(heats())).toEqual(['Heat A1', 'Heat B1']);
});

it('refuses with no results to move boats from', async () => {
  await setUp(8, 2);
  await expect(nextRound()).rejects.toThrow();
  expect(Object.keys(heats())).toEqual(['Heat A1', 'Heat B1']);
});

it.each([10, 14])(
  'returns the odd/even advisory for 2 heats of %i boats',
  async (boats) => {
    await setUp(boats, 2);
    await event.scoreHeat(eventId, 'Heat A1');
    await event.scoreHeat(eventId, 'Heat B1');
    const result = await nextRound();
    expect(result.advisory).toMatch(/odd\/even/);
  },
);

it('refuses once the Final Series has started', async () => {
  await setUp(8, 2);
  await event.scoreHeat(eventId, 'Heat A1');
  await event.scoreHeat(eventId, 'Heat B1');
  await call('startFinalSeriesAtomic', eventId, true, false);
  await expect(nextRound()).rejects.toThrow(/Final Series/);
});

describe('undo the round', () => {
  it('refuses on the first round', async () => {
    await setUp(8, 2);
    await expect(undoRound()).rejects.toThrow(/first-round heats/);
  });

  it('takes the latest round back, the earlier ones stay', async () => {
    await setUp(8, 2);
    await event.scoreHeat(eventId, 'Heat A1');
    await event.scoreHeat(eventId, 'Heat B1');
    await nextRound();
    await expect(undoRound()).resolves.toMatchObject({
      success: true,
      removedHeats: 2,
      removedAssignments: 8,
      removedHeatNames: expect.arrayContaining(['Heat A2', 'Heat B2']),
    });
    expect(Object.keys(heats())).toEqual(['Heat A1', 'Heat B1']);
    // And the round can be built again, the same way.
    await nextRound();
    expect(Object.keys(heats())).toEqual([
      'Heat A1',
      'Heat A2',
      'Heat B1',
      'Heat B2',
    ]);
  });

  it('refuses once the latest round has raced', async () => {
    await setUp(8, 2);
    await event.scoreHeat(eventId, 'Heat A1');
    await event.scoreHeat(eventId, 'Heat B1');
    await nextRound();
    await event.scoreHeat(eventId, 'Heat A2');
    await expect(undoRound()).rejects.toThrow(/already contain races/);
  });
});
