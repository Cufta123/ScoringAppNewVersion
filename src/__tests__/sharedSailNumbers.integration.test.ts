/** @jest-environment node */
export {};

/**
 * ITA 12 and CRO 12 at one event (sail numbers are national; common in the
 * IOM class). Heats must be created, and a heat holding both must be scored
 * by naming them with their national letters. Real handlers, real SQLite.
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

describe('two nations, one sail number', () => {
  let db: any;
  let eventId: number;
  const boatIds: Record<string, number> = {};

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
    eventId = Number(
      (await call('insertEvent', 'EC', 'Split', '2026-05-01', '2026-05-03'))
        .lastInsertRowid,
    );
    const enter = async (country: string, sail: number) => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO Boats (sail_number, country, model) VALUES (?, ?, 'IOM')",
          )
          .run(sail, country).lastInsertRowid,
      );
      boatIds[`${country} ${sail}`] = id;
      await call('associateBoatWithEvent', id, eventId);
    };
    await enter('ITA', 12);
    await enter('CRO', 12);
    await enter('CRO', 7);
  });
  afterEach(() => db.close());

  const scoreOf = (raceId: number, key: string) =>
    db
      .prepare(
        'SELECT position, status FROM Scores WHERE race_id = ? AND boat_id = ?',
      )
      .get(raceId, boatIds[key]);

  it('creates the heats and scores the heat by national letters', async () => {
    await call('createInitialHeatsAtomic', eventId, 1);
    const heat = db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ?')
      .get(eventId);
    const result = await call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: [
        { boatNumber: 'cro12', place: 1, status: 'FINISHED' },
        { boatNumber: 7, place: 2, status: 'FINISHED' },
        { boatNumber: 'ITA 12', place: 3, status: 'DNF' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(scoreOf(result.raceId, 'CRO 12')).toEqual({
      position: 1,
      status: 'FINISHED',
    });
    expect(scoreOf(result.raceId, 'CRO 7')).toEqual({
      position: 2,
      status: 'FINISHED',
    });
    expect(scoreOf(result.raceId, 'ITA 12').status).toBe('DNF');
  });

  it('the number alone does not say which boat: nothing is written', async () => {
    await call('createInitialHeatsAtomic', eventId, 1);
    const heat = db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ?')
      .get(eventId);
    const result = await call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: [{ boatNumber: '12', place: 1, status: 'FINISHED' }],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'UNMATCHED_SAILS',
      unmatched: ['12'],
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM Races').get().n).toBe(0);
  });

  it('one boat named twice is refused, not scored twice', async () => {
    await call('createInitialHeatsAtomic', eventId, 1);
    const heat = db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ?')
      .get(eventId);
    await expect(
      call('submitHeatRaceScoresAtomic', {
        heat_id: heat.heat_id,
        placeNumbers: [
          { boatNumber: 7, place: 1, status: 'FINISHED' },
          { boatNumber: 'CRO 7', place: 2, status: 'FINISHED' },
        ],
      }),
    ).rejects.toThrow(/in the result twice/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM Races').get().n).toBe(0);
  });

  it('the same national letters and number cannot be entered twice', async () => {
    const twin = Number(
      db
        .prepare(
          "INSERT INTO Boats (sail_number, country, model) VALUES ('12', 'cro', 'IOM')",
        )
        .run().lastInsertRowid,
    );
    await expect(call('associateBoatWithEvent', twin, eventId)).rejects.toThrow(
      'Sail CRO 12 is already entered in this event.',
    );
    // Entering a boat already entered stays a harmless no-op.
    await expect(
      call('associateBoatWithEvent', boatIds['ITA 12'], eventId),
    ).resolves.toBeDefined();
  });
});
