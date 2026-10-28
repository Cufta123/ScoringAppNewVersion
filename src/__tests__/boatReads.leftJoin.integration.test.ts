/** @jest-environment node */
export {};

/**
 * A boat whose sailor is missing (Boats.sailor_id is nullable) is still
 * entered, still in her heat and still scored, so every read that lists boats
 * must still list her. Real handlers, real migrations, real SQLite.
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

describe('boat reads keep a boat that has no sailor', () => {
  let db: any;
  let heatId: number;
  let withoutSailor: number;
  let withoutClub: number;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    require('../main/ipcHandlers/SailorHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;

    const category = db
      .prepare('SELECT category_id FROM Categories LIMIT 1')
      .get().category_id;
    const club = Number(
      db
        .prepare("INSERT INTO Clubs (club_name, country) VALUES ('JK', 'CRO')")
        .run().lastInsertRowid,
    );
    const sailor = Number(
      db
        .prepare(
          "INSERT INTO Sailors (name, surname, birthday, category_id, club_id) VALUES ('Ana', 'Anic', '1990-01-01', ?, ?)",
        )
        .run(category, club).lastInsertRowid,
    );
    // A sailor with no club and no category (an older import).
    const sailorWithoutClub = Number(
      db
        .prepare(
          "INSERT INTO Sailors (name, surname, birthday) VALUES ('Bruno', 'Brunic', '1991-01-01')",
        )
        .run().lastInsertRowid,
    );
    const addBoat = (sail: number, sailorId: number | null) =>
      Number(
        db
          .prepare(
            "INSERT INTO Boats (sail_number, country, model, sailor_id) VALUES (?, 'CRO', 'IOM', ?)",
          )
          .run(sail, sailorId).lastInsertRowid,
      );
    const withSailor = addBoat(1, sailor);
    withoutSailor = addBoat(2, null);
    withoutClub = addBoat(3, sailorWithoutClub);

    const eventId = Number(
      db
        .prepare(
          "INSERT INTO Events (event_name, event_location, start_date, end_date) VALUES ('Kup', 'Split', '2026-05-01', '2026-05-03')",
        )
        .run().lastInsertRowid,
    );
    heatId = Number(
      db
        .prepare(
          "INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, 'Heat A1', 'Qualifying')",
        )
        .run(eventId).lastInsertRowid,
    );
    [withSailor, withoutSailor, withoutClub].forEach((boatId) => {
      db.prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)').run(
        heatId,
        boatId,
      );
    });
  });
  afterAll(() => jest.restoreAllMocks());
  afterEach(() => db.close());

  it('readBoatsByHeat lists a boat with no sailor, with empty sailor fields', async () => {
    const rows = await call('readBoatsByHeat', heatId);

    expect(rows.map((r: any) => r.boat_id).sort()).toEqual([1, 2, 3]);
    const orphan = rows.find((r: any) => r.boat_id === withoutSailor);
    expect(orphan.sail_number).toBe(2);
    expect(orphan.name).toBeNull();
    expect(orphan.surname).toBeNull();
    expect(orphan.category_name).toBeNull();
  });

  it('readAllBoats lists a boat with no sailor and a sailor with no club', async () => {
    const rows = await call('readAllBoats');

    expect(rows.map((r: any) => r.boat_id).sort()).toEqual([1, 2, 3]);
    const orphan = rows.find((r: any) => r.boat_id === withoutSailor);
    expect(orphan.name).toBeNull();
    expect(orphan.club_name).toBeNull();
    const noClub = rows.find((r: any) => r.boat_id === withoutClub);
    expect(noClub.surname).toBe('Brunic');
    expect(noClub.club_name).toBeNull();
    expect(noClub.category_name).toBeNull();
  });
});
