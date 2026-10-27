/** @jest-environment node */
export {};

/**
 * The standings count a qualifying race only once every heat of its round has
 * sailed it (SHRS 1.1: a race consists of all its heats), and they are rebuilt
 * from the scores on every read, so they are never stale. Real migrations,
 * real handlers, real SQLite.
 */

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
import { realEvent } from './fixtures/realEvent';
// eslint-disable-next-line import/first, import/order
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

/** What the standings screen gets: place, total and counted races per boat. */
const standings = async (eventId: number) =>
  (await call('readLeaderboard', eventId)).map((row: any) => ({
    boat: row.boat_id,
    place: row.place,
    total: row.total_points_event,
    races: row.race_points,
    pending: row.pending_races.map((race: any) => race.points),
  }));

describe('standings count completed rounds only, and are never stale', () => {
  let db: any;
  let event: ReturnType<typeof realEvent>;
  let eventId: number;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(async () => {
    invalidateAssignmentSnapshotCache();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
    event = realEvent(db, call);
    eventId = await event.createEvent('Kup');
    // Six boats, two heats of three.
    await event.enterBoats(eventId, [1, 2, 3, 4, 5, 6]);
    await call('createInitialHeatsAtomic', eventId, 2);
  });

  afterEach(() => db.close());

  it('a round in progress is shown apart and changes nothing', async () => {
    await event.scoreHeat(eventId, 'Heat A1');
    // Round 1 is not complete: no standings yet.
    expect(await standings(eventId)).toEqual([]);

    await event.scoreHeat(eventId, 'Heat B1', true);
    const afterRound1 = await standings(eventId);
    expect(afterRound1).toHaveLength(6);
    afterRound1.forEach((row: any) => expect(row.pending).toEqual([]));

    await call('createNewHeatsBasedOnLeaderboard', eventId);
    await event.scoreHeat(eventId, 'Heat A2', true);

    const midRound2 = await standings(eventId);
    // Places, totals and counted races are exactly as after round 1...
    const counted = (rows: any[]) =>
      rows.map((row) => ({ ...row, pending: undefined }));
    expect(counted(midRound2)).toEqual(counted(afterRound1));
    // ...and Heat A2's boats carry their round-2 result as in progress.
    const inProgress = midRound2.filter((row: any) => row.pending.length > 0);
    expect(inProgress).toHaveLength(3);
    inProgress.forEach((row: any) => expect(row.pending).toHaveLength(1));

    await event.scoreHeat(eventId, 'Heat B2');
    const afterRound2 = await standings(eventId);
    afterRound2.forEach((row: any) => {
      expect(row.pending).toEqual([]);
      expect(String(row.races).split(',')).toHaveLength(2);
    });
  });

  it('every place agrees with the total shown next to it', async () => {
    await event.scoreHeat(eventId, 'Heat A1');
    await event.scoreHeat(eventId, 'Heat B1', true);
    await call('createNewHeatsBasedOnLeaderboard', eventId);
    await event.scoreHeat(eventId, 'Heat A2', true);
    const rows = await standings(eventId);
    rows.forEach((row: any) => {
      const sum = String(row.races)
        .split(',')
        .reduce((total: number, points: string) => total + Number(points), 0);
      expect(row.total).toBe(sum); // under 4 races: no discard
    });
    const totals = rows.map((row: any) => row.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it('standings rebuilt on read: a stale stored table never reaches the screen', async () => {
    await event.scoreHeat(eventId, 'Heat A1');
    await event.scoreHeat(eventId, 'Heat B1', true);
    const fresh = await standings(eventId);
    // Corrupt the stored cache behind the app's back.
    db.prepare(
      'UPDATE Leaderboard SET total_points_event = 99, place = 6',
    ).run();
    expect(await standings(eventId)).toEqual(fresh);
  });
});
