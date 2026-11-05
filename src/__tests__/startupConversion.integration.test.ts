/** @jest-environment node */
export {};

/**
 * An event from before regatta-core (tables, no decision log) is moved to
 * the new scoring when the app starts: its log is converted, the conversion
 * is one action in the history (not undoable from there), and every result
 * the rules score differently from what the old app stored is reported in
 * the screen's words until the race officer confirms it. Real migrations
 * and handlers on real SQLite.
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

describe('moving events to the new scoring at start-up', () => {
  let db: any;
  let eventId: number;
  let convertEventsAtStartup: () => { converted: number[]; failed: number[] };

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
    // eslint-disable-next-line global-require
    convertEventsAtStartup =
      require('../main/functions/startupConversion').default;
  });

  afterAll(() => jest.restoreAllMocks());

  const heatId = (name: string) =>
    db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?')
      .get(eventId, name).heat_id;

  const scoreHeat = async (name: string) => {
    const sails = db
      .prepare(
        'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ? ORDER BY b.sail_number',
      )
      .all(heatId(name))
      .map((row: { sail_number: number }) => row.sail_number);
    const result = await call('submitHeatRaceScoresAtomic', {
      heat_id: heatId(name),
      placeNumbers: sails.map((sail: number, index: number) => ({
        boatNumber: sail,
        place: index + 1,
        status: 'FINISHED',
      })),
    });
    expect(result.ok).toBe(true);
  };

  /** The event as the old app left it: tables only, no decision log. */
  const asBeforeTheSwitch = () => {
    db.prepare('DELETE FROM Decisions WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM EventLogs WHERE event_id = ?').run(eventId);
  };

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
    await scoreHeat('Heat A1');
    await scoreHeat('Heat B1');
  });

  afterEach(() => db.close());

  it('converts an event without a log, as one history action that is not undone from the history', async () => {
    asBeforeTheSwitch();
    expect(convertEventsAtStartup()).toEqual({
      converted: [eventId],
      failed: [],
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM Decisions WHERE event_id = ?')
        .get(eventId).n,
    ).toBeGreaterThan(0);
    const action = db
      .prepare(
        "SELECT action_id FROM ChangeActions WHERE channel = 'convertEventLog'",
      )
      .get();
    expect(action).toBeDefined();
    expect(
      db
        .prepare('SELECT converted_by FROM EventLogs WHERE event_id = ?')
        .get(eventId).converted_by,
    ).toBe(action.action_id);

    // A second start finds nothing to do.
    expect(convertEventsAtStartup()).toEqual({ converted: [], failed: [] });
  });

  it('reports nothing when every stored result scores the same', async () => {
    asBeforeTheSwitch();
    convertEventsAtStartup();
    expect(await call('readConversionReport', eventId)).toBeNull();
  });

  it('reports a result the old app stored with other points, in the words of the screen, until confirmed', async () => {
    asBeforeTheSwitch();
    // The old app stored 3 points for the boat that finished 2nd.
    const second = db
      .prepare(
        `SELECT sc.score_id, b.sail_number FROM Scores sc
         JOIN Boats b ON b.boat_id = sc.boat_id
         JOIN Races r ON r.race_id = sc.race_id
         WHERE r.heat_id = ? AND sc.position = 2`,
      )
      .get(heatId('Heat A1'));
    db.prepare('UPDATE Scores SET points = 3 WHERE score_id = ?').run(
      second.score_id,
    );

    convertEventsAtStartup();
    const report = await call('readConversionReport', eventId);
    expect(report).toMatchObject({
      seen: false,
      refused: null,
      heats: [],
      notes: [],
      points: [
        {
          race: 'Heat A1, race 1',
          boat: `CRO ${second.sail_number}`,
          status: 'FINISHED',
          before: 3,
          after: 2,
        },
      ],
    });

    await call('markConversionReportSeen', eventId);
    expect(await call('readConversionReport', eventId)).toMatchObject({
      seen: true,
    });
    // The standings are the rules': 2 points.
    const rows = await call('readLeaderboard', eventId);
    const row = rows.find(
      (r: any) => String(r.boat_number) === String(second.sail_number),
    );
    expect(row.total_points_event).toBe(2);
  });

  it('an event the conversion fails on is logged and left; the others go on', async () => {
    asBeforeTheSwitch();
    const other = Number(
      (await call('insertEvent', 'Other', 'Zadar', '2026-06-01', '2026-06-02'))
        .lastInsertRowid,
    );
    db.prepare('DELETE FROM EventLogs WHERE event_id = ?').run(other);
    // eslint-disable-next-line global-require
    const store = require('../main/functions/decisionStore');
    const real = store.ensureEventLog;
    const spy = jest
      .spyOn(store, 'ensureEventLog')
      .mockImplementation((id: unknown) => {
        if (id === eventId) throw new Error('disk on fire');
        return real(id);
      });
    try {
      const result = convertEventsAtStartup();
      expect(result).toEqual({ converted: [other], failed: [eventId] });
    } finally {
      spy.mockRestore();
    }
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM EventLogs WHERE event_id = ?')
        .get(eventId).n,
    ).toBe(0);
    // The next start tries it again.
    expect(convertEventsAtStartup()).toEqual({
      converted: [eventId],
      failed: [],
    });
  });

  it('says so when the rules cannot read the old records at all', async () => {
    asBeforeTheSwitch();
    // The old records put one boat in both heats of the round.
    const boat = db
      .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
      .get(heatId('Heat A1')).boat_id;
    db.prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)').run(
      heatId('Heat B1'),
      boat,
    );
    convertEventsAtStartup();
    const report = await call('readConversionReport', eventId);
    expect(report.refused).toEqual(expect.any(String));
  });
  it('leaves out a final fleet with no boats and no races (older records), and says so', async () => {
    asBeforeTheSwitch();
    db.prepare(
      "INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, 'Heat Gold', 'Final'), (?, 'Heat Silver', 'Final')",
    ).run(eventId, eventId);
    convertEventsAtStartup();
    expect((await call('readLeaderboard', eventId)).length).toBe(8);
    const report = await call('readConversionReport', eventId);
    expect(report.refused).toBeNull();
    expect(report.heats).toEqual([]);
    expect(report.notes).toEqual([
      'The Gold fleet has no boats and no races; it is left out.',
      'The Silver fleet has no boats and no races; it is left out.',
    ]);
  });

  it('keeps an RDG2 whose races older records did not keep as the points the committee gave', async () => {
    asBeforeTheSwitch();
    const third = db
      .prepare(
        `SELECT sc.score_id, b.sail_number FROM Scores sc
         JOIN Boats b ON b.boat_id = sc.boat_id
         JOIN Races r ON r.race_id = sc.race_id
         WHERE r.heat_id = ? AND sc.position = 3`,
      )
      .get(heatId('Heat B1'));
    db.prepare(
      "UPDATE Scores SET status = 'RDG2', position = 2.5, points = 2.5, held_place = NULL, rdg_race_ids = NULL WHERE score_id = ?",
    ).run(third.score_id);
    convertEventsAtStartup();
    const rows = await call('readLeaderboard', eventId);
    const row = rows.find(
      (r: any) => String(r.boat_number) === String(third.sail_number),
    );
    expect(row.race_points).toBe('2.5');
    const report = await call('readConversionReport', eventId);
    expect(report.points).toEqual([]);
    expect(report.notes).toEqual([
      expect.stringMatching(
        /RDG2 \(2\.5 points\) without the races it averages/,
      ),
    ]);
  });
});
