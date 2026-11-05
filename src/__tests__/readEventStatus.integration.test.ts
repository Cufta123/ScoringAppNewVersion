/** @jest-environment node */
/**
 * readEventStatus through the real handlers on real SQLite: regatta-core's
 * eventStatus with the library's heats named by the app's heat ids, and
 * every verdict the screens show agreeing with what the handler then does.
 */
import type { EventStatusView } from '../shared/eventStatus';

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

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  event = realEvent(db, call);
  eventId = await event.createEvent('Status');
});
afterEach(() => db.close());

const status = (): Promise<EventStatusView> => call('readEventStatus', eventId);
const heatId = (name: string) =>
  Number(
    db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?')
      .get(eventId, name).heat_id,
  );

it('before the heats: enter boats, then create the heats', async () => {
  expect((await status()).next).toEqual({ kind: 'enterBoats' });
  await event.enterBoats(eventId, [1, 2, 3, 4, 5, 6]);
  expect(await status()).toMatchObject({
    series: 'entries',
    round: null,
    heats: [],
    next: { kind: 'createHeats' },
  });
});

it('names the heats as the app does, and the handlers do what it says', async () => {
  await event.enterBoats(eventId, [1, 2, 3, 4, 5, 6, 7, 8]);
  await call('createInitialHeatsAtomic', eventId, 2);
  let now = await status();
  expect(now.series).toBe('qualifying');
  expect(now.round).toBe(1);
  expect(now.heats.map((h) => [h.heat_id, h.heat_name, h.races])).toEqual([
    [heatId('Heat A1'), 'Heat A1', 0],
    [heatId('Heat B1'), 'Heat B1', 0],
  ]);
  expect(now.heats[0].boat_ids).toHaveLength(4);
  expect(now.next).toEqual({
    kind: 'score',
    heat_id: heatId('Heat A1'),
    heat_name: 'Heat A1',
    race: 1,
  });
  expect(now.startFinal).toMatchObject({
    ok: false,
    offered: true,
    eligibility: { reason: 'NO_RACES_COMPLETED', numFinalHeats: 2 },
  });

  await event.scoreHeat(eventId, 'Heat A1');
  await event.scoreHeat(eventId, 'Heat B1');
  now = await status();
  expect(now.next).toEqual({
    kind: 'createRound',
    round: 2,
    finalSeries: true,
  });
  expect(now.createRound).toEqual({ ok: true, offered: true });
  expect(now.startFinal.eligibility).toMatchObject({
    ok: true,
    reason: 'OK',
    completedQualifyingRaces: 1,
  });

  await call('createNewHeatsBasedOnLeaderboard', eventId);
  now = await status();
  expect(now.round).toBe(2);
  expect(now.undoRound).toEqual({ ok: true, offered: true });
  expect(now.startFinal.eligibility).toMatchObject({
    reason: 'LATEST_ROUND_UNSAILED',
    latestRoundNumber: 2,
  });
  await event.scoreHeat(eventId, 'Heat B2');
  now = await status();
  expect(now.undoRound).toMatchObject({ ok: false, offered: true });
  await expect(call('undoLatestHeatRedistribution', eventId)).rejects.toThrow(
    now.undoRound.ok ? 'never' : now.undoRound.reason,
  );

  // An earlier round's race: the handler refuses (the status lists only
  // the round being sailed).
  await expect(
    call('undoLastScoredRaceForHeat', heatId('Heat A1')),
  ).rejects.toThrow(/next round/);
  const b2 = now.heats.find((h) => h.heat_name === 'Heat B2')!;
  expect(b2.undoRace).toEqual({ ok: true, offered: true });
  await call('undoLastScoredRaceForHeat', b2.heat_id);
  expect((await status()).undoRound).toEqual({ ok: true, offered: true });
  await call('undoLatestHeatRedistribution', eventId);
  expect((await status()).round).toBe(1);

  await call('startFinalSeriesAtomic', eventId, true, true);
  now = await status();
  expect(now.series).toBe('final');
  expect(now.round).toBeNull();
  expect(now.heats.map((h) => [h.heat_id, h.heat_name])).toEqual([
    [heatId('Final Gold'), 'Final Gold'],
    [heatId('Final Silver'), 'Final Silver'],
  ]);
  expect(now.startFinal).toMatchObject({
    ok: false,
    offered: false,
    eligibility: { reason: 'STARTED' },
  });
  expect(now.next).toMatchObject({ kind: 'score', heat_name: 'Final Gold' });
});

it('a heat left with no boats does not hold the next round up', async () => {
  // Every boat moved out of Heat B1 before racing: A1 sails, and the round
  // is complete (regatta-core: a heat with no boats has nothing to sail).
  await event.enterBoats(eventId, [1, 2, 3, 4]);
  await call('createInitialHeatsAtomic', eventId, 2);
  const b1 = heatId('Heat B1');
  const a1 = heatId('Heat A1');
  const inB1 = db
    .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
    .all(b1)
    .map((row: any) => row.boat_id);
  // eslint-disable-next-line no-restricted-syntax
  for (const boat of inB1) {
    // eslint-disable-next-line no-await-in-loop
    await call('transferBoatBetweenHeats', b1, a1, boat);
  }
  await event.scoreHeat(eventId, 'Heat A1');
  const now = await status();
  expect(now.heats.find((h) => h.heat_name === 'Heat B1')!.score).toEqual({
    ok: true,
    offered: false,
  });
  expect(now.next).toMatchObject({ kind: 'createRound', round: 2 });
  expect(now.createRound).toEqual({ ok: true, offered: true });
  // The handler builds it (it used to refuse: "Not all heats have the same
  // number of races yet").
  await expect(
    call('createNewHeatsBasedOnLeaderboard', eventId),
  ).resolves.toMatchObject({ success: true });
});
