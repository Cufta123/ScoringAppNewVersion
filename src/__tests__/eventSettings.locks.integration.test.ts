/** @jest-environment node */
export {};

/**
 * Settings the Notice of Race fixes for a whole series cannot be switched once
 * that series has begun: the qualifying assignment mode (SHRS 3.1 / 3.2) from
 * the first qualifying race, the final fleets setting (2.3 / 4.1) once the
 * Final Series is split. Real migrations and handlers on real SQLite.
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
jest.mock('../main/database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

// eslint-disable-next-line import/first, import/order

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../main/database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const update = (
  eventId: number,
  mode: string,
  overflow: string,
  qualifyingDiscards = 'standard',
) =>
  call(
    'updateEvent',
    eventId,
    'Kup',
    'Split',
    '2026-05-01',
    '2026-05-03',
    mode,
    qualifyingDiscards,
    'standard',
    overflow,
  );

const readEvent = async (eventId: number) =>
  ((await call('readAllEvents')) as any[]).find(
    (row) => row.event_id === eventId,
  );

describe('event settings fixed once their series has begun', () => {
  let db: any;
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
    const created = await call(
      'insertEvent',
      'Kup',
      'Split',
      '2026-05-01',
      '2026-05-03',
    );
    eventId = Number(created.lastInsertRowid);
    for (let sail = 1; sail <= 8; sail += 1) {
      const boatId = Number(
        db
          .prepare(
            "INSERT INTO Boats (sail_number, country, model) VALUES (?, 'CRO', 'IOM')",
          )
          .run(sail).lastInsertRowid,
      );
      // eslint-disable-next-line no-await-in-loop
      await call('associateBoatWithEvent', boatId, eventId);
    }
    await call('createInitialHeatsAtomic', eventId, 2);
  });

  afterEach(() => db.close());

  const scoreHeat = async (name: string) => {
    const { heat_id: heatId } = db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?')
      .get(eventId, name);
    const sails = db
      .prepare(
        'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ? ORDER BY b.sail_number',
      )
      .all(heatId)
      .map((row: { sail_number: number }) => row.sail_number);
    const result = await call('submitHeatRaceScoresAtomic', {
      heat_id: heatId,
      placeNumbers: sails.map((sail: number, index: number) => ({
        boatNumber: sail,
        place: index + 1,
        status: 'FINISHED',
      })),
    });
    expect(result.ok).toBe(true);
  };

  it('allows both changes before any race', async () => {
    expect((await readEvent(eventId)).qualifying_started).toBe(0);
    await update(eventId, 'pre-assigned', 'confirm-allow-oversize');
    const row = await readEvent(eventId);
    expect(row.shrs_qualifying_assignment_mode).toBe('pre-assigned');
    expect(row.shrs_heat_overflow_policy).toBe('confirm-allow-oversize');
  });

  it('refuses a new assignment mode after the first qualifying race', async () => {
    await scoreHeat('Heat A1');
    expect((await readEvent(eventId)).qualifying_started).toBe(1);

    await expect(
      update(eventId, 'pre-assigned', 'auto-increase'),
    ).rejects.toThrow(/assignment method is fixed/);
    expect((await readEvent(eventId)).shrs_qualifying_assignment_mode).toBe(
      'progressive',
    );

    // Saving the same mode (e.g. only the name changed) still works, and the
    // overflow setting can still change until the fleets are split.
    await update(eventId, 'progressive', 'confirm-allow-oversize');
    expect((await readEvent(eventId)).shrs_heat_overflow_policy).toBe(
      'confirm-allow-oversize',
    );
  });

  it('frees the mode again once the race is undone (no race sailed, parity R11)', async () => {
    await scoreHeat('Heat A1');
    const { heat_id: heatId } = db
      .prepare("SELECT heat_id FROM Heats WHERE heat_name = 'Heat A1'")
      .get();
    await call('undoLastScoredRaceForHeat', heatId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM Races').get().n).toBe(0);
    // The screen reads the locks from the races too, not a stored flag.
    expect(await readEvent(eventId)).toMatchObject({
      qualifying_started: 0,
      shrs_discard_locked_qualifying: 0,
    });
    await expect(
      update(eventId, 'pre-assigned', 'auto-increase'),
    ).resolves.toMatchObject({ success: true });
  });

  it('refuses a new final fleets setting once the Final Series is split', async () => {
    for (const heat of ['Heat A1', 'Heat B1']) {
      // eslint-disable-next-line no-await-in-loop
      await scoreHeat(heat);
    }
    await call('startFinalSeriesAtomic', eventId);
    expect((await readEvent(eventId)).final_series_started).toBe(1);

    await expect(
      update(eventId, 'progressive', 'confirm-allow-oversize'),
    ).rejects.toThrow(/final fleets are already made/);
    expect((await readEvent(eventId)).shrs_heat_overflow_policy).toBe(
      'auto-increase',
    );
  });
});
