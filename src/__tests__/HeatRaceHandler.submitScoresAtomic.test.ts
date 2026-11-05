/** @jest-environment node */
/**
 * Scoring a race (submitHeatRaceScoresAtomic), through the real handler on
 * real SQLite: the race office's sheet is a raceScored decision, scored by
 * regatta-core (RRS A4, A7, 44.3(c), T1; SHRS 5.2), and the result rows are
 * what the library worked out. The handler's checks (sails it cannot match
 * or tell apart, a finishing place that is not a whole number) come first.
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
  eventId = await event.createEvent('Scoring');
});
afterEach(() => db.close());

/** CRO 1 … CRO n in one heat (A1). */
const oneHeat = async (n: number) => {
  await event.enterBoats(
    eventId,
    Array.from({ length: n }, (_v, i) => i + 1),
  );
  await call('createInitialHeatsAtomic', eventId, 1);
  return event.heatId(eventId, 'Heat A1');
};
const submit = (heat: number, entries: [number, number | null, string][]) =>
  call('submitHeatRaceScoresAtomic', {
    heat_id: heat,
    placeNumbers: entries.map(([boatNumber, place, status]) => ({
      boatNumber,
      place,
      status,
    })),
  });
const rows = (raceId: number) =>
  Object.fromEntries(
    db
      .prepare(
        `SELECT b.sail_number AS sail, s.position, s.points, s.status
         FROM Scores s JOIN Boats b ON b.boat_id = s.boat_id
         WHERE s.race_id = ? ORDER BY b.sail_number`,
      )
      .all(raceId)
      .map((r: any) => [r.sail, `${r.status} ${r.position}/${r.points}`]),
  );
const races = () => db.prepare('SELECT COUNT(*) AS n FROM Races').get().n;

it('scores the sheet: places, T1, a code, and a boat not on it (DNS)', async () => {
  const heat = await oneHeat(6);
  const result = await submit(heat, [
    [1, 1, 'FINISHED'],
    [2, 2, 'FINISHED'],
    [3, 3, 'T1'],
    [4, 4, 'FINISHED'],
    [5, null, 'DNF'],
  ]);
  expect(result).toMatchObject({ ok: true, raceNumber: 1 });
  // Largest heat 6: no place = 7 (SHRS 5.2); T1 = 3 + 30% of 7 = 5.1.
  expect(rows(result.raceId)).toEqual({
    1: 'FINISHED 1/1',
    2: 'FINISHED 2/2',
    3: 'T1 3/5.1',
    4: 'FINISHED 4/4',
    5: 'DNF 7/7',
    6: 'DNS 7/7',
  });
});

it("scores against the heat's own event, whatever the payload says (HRH M4)", async () => {
  const heat = await oneHeat(2);
  const result = await call('submitHeatRaceScoresAtomic', {
    event_id: 999,
    heat_id: heat,
    placeNumbers: [
      { boatNumber: 1, place: 1, status: 'FINISHED' },
      { boatNumber: 2, place: 2, status: 'FINISHED' },
    ],
  });
  expect(result.ok).toBe(true);
});

it('a penalty that keeps the place does not move the boats behind (44.3(c))', async () => {
  const heat = await oneHeat(4);
  const { raceId } = await submit(heat, [
    [1, 1, 'FINISHED'],
    [2, 2, 'ZFP'],
    [3, 3, 'FINISHED'],
    [4, 4, 'FINISHED'],
  ]);
  // ZFP = 2 + 20% of 5 = 3.
  expect(rows(raceId)).toEqual({
    1: 'FINISHED 1/1',
    2: 'ZFP 2/3',
    3: 'FINISHED 3/3',
    4: 'FINISHED 4/4',
  });
});

it('a tie with a penalised boat: she adds her penalty to the shared points (RRS 44.3(c) 2025)', async () => {
  const heat = await oneHeat(4);
  const { raceId } = await submit(heat, [
    [1, 1, 'FINISHED'],
    [2, 2, 'FINISHED'],
    [3, 2, 'ZFP'],
    [4, 4, 'FINISHED'],
  ]);
  // 2 and 3 tie for 2nd: 2.5 each; 3's ZFP adds 20% of 5 = 1: 3.5.
  expect(rows(raceId)).toEqual({
    1: 'FINISHED 1/1',
    2: 'FINISHED 2/2.5',
    3: 'ZFP 2/3.5',
    4: 'FINISHED 4/4',
  });
});

it('a code needs no place; a falsy one is fine (BK-6)', async () => {
  const heat = await oneHeat(3);
  const result = await submit(heat, [
    [1, 1, 'FINISHED'],
    [2, 0, 'OCS'],
    [3, null, 'RET'],
  ]);
  expect(rows(result.raceId)).toMatchObject({ 2: 'OCS 4/4', 3: 'RET 4/4' });
});

it('refuses a finishing place 0, and writes nothing (BK-6)', async () => {
  const heat = await oneHeat(2);
  await expect(
    submit(heat, [
      [1, 0, 'FINISHED'],
      [2, 1, 'FINISHED'],
    ]),
  ).rejects.toThrow(/The place of sail 1/);
  expect(races()).toBe(0);
});

it('reports sails it cannot match, and writes nothing', async () => {
  const heat = await oneHeat(2);
  await expect(submit(heat, [[77, 1, 'FINISHED']])).resolves.toEqual({
    ok: false,
    reason: 'UNMATCHED_SAILS',
    unmatched: [77],
  });
  expect(races()).toBe(0);
});

it('refuses a sail twice in the result', async () => {
  const heat = await oneHeat(2);
  await expect(
    submit(heat, [
      [1, 1, 'FINISHED'],
      [1, 2, 'FINISHED'],
    ]),
  ).rejects.toThrow(/in the result twice/);
});

it('numbers the races of a heat 1, 2, … and undoes the last', async () => {
  const heat = await oneHeat(2);
  await submit(heat, [
    [1, 1, 'FINISHED'],
    [2, 2, 'FINISHED'],
  ]);
  const second = await submit(heat, [
    [2, 1, 'FINISHED'],
    [1, 2, 'FINISHED'],
  ]);
  expect(second.raceNumber).toBe(2);
  await expect(call('undoLastScoredRaceForHeat', heat)).resolves.toMatchObject({
    success: true,
    raceNumber: 2,
    removedScores: 2,
  });
  expect(races()).toBe(1);
});
