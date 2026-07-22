/** @jest-environment node */
export {};

// Integration regression tests for the Sailor SQL handlers, run against a REAL
// SQLite engine (node:sqlite) instead of a string-matching mock. A mock cannot
// catch SQL-level faults like `ambiguous column name: sailor_id` — which is the
// exact bug that broke every sailor edit (updateSailor joined Boats + Sailors,
// both of which have a `sailor_id` column, with an unqualified SELECT).
//
// better-sqlite3 is built for Electron's ABI and is not loadable in Jest's Node
// environment, so these tests use Node's built-in node:sqlite, whose statement
// API (prepare/get/all/run + exec) matches what the handlers call.

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
}));

// The handler binds `db` once at import time. Delegate every call to whichever
// fresh in-memory database the current test built, so each test is isolated.
const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => ({
  db: {
    prepare: (...args: any[]) => mockDbHolder.current.prepare(...args),
    exec: (...args: any[]) => mockDbHolder.current.exec(...args),
    transaction: (fn: (...args: any[]) => any) => fn,
  },
}));

function buildSeededDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE Categories (
      category_id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_name TEXT NOT NULL
    );
    CREATE TABLE Clubs (
      club_id INTEGER PRIMARY KEY AUTOINCREMENT,
      club_name TEXT NOT NULL,
      country TEXT NOT NULL
    );
    CREATE TABLE Sailors (
      sailor_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      surname TEXT NOT NULL,
      birthday TEXT NOT NULL,
      category_id INTEGER,
      club_id INTEGER
    );
    CREATE TABLE Boats (
      boat_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sail_number INTEGER NOT NULL,
      country TEXT NOT NULL,
      model TEXT NOT NULL,
      sailor_id INTEGER
    );
    INSERT INTO Categories (category_id, category_name) VALUES
      (1,'KADET'),(2,'JUNIOR'),(3,'SENIOR'),(4,'VETERAN'),(5,'MASTER');
    INSERT INTO Clubs (club_name, country) VALUES ('YC Split','CRO');
  `);
  return db;
}

// Insert a sailor + associated boat, returning the new boat_id.
function addSailorWithBoat(
  db: any,
  {
    name,
    surname,
    categoryId = 3,
    clubId = 1,
    sail,
  }: {
    name: string;
    surname: string;
    categoryId?: number;
    clubId?: number;
    sail: string | number;
  },
): number {
  const sailor = db
    .prepare(
      'INSERT INTO Sailors (name, surname, birthday, category_id, club_id) VALUES (?,?,?,?,?)',
    )
    .run(name, surname, '', categoryId, clubId);
  const boat = db
    .prepare(
      'INSERT INTO Boats (sail_number, country, model, sailor_id) VALUES (?,?,?,?)',
    )
    .run(String(sail), 'CRO', 'IOM', Number(sailor.lastInsertRowid));
  return Number(boat.lastInsertRowid);
}

const baseEdit = {
  category_name: 'SENIOR',
  club_name: 'YC Split',
  originalClubName: 'YC Split',
  country: 'CRO',
  model: 'IOM',
};

describe('SailorHandler SQL handlers (real SQLite)', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/SailorHandler');
  });

  beforeEach(() => {
    mockDbHolder.current = buildSeededDb();
  });

  it('updateSailor runs without an ambiguous-column error and updates the row', async () => {
    const db = mockDbHolder.current;
    const boatId = addSailorWithBoat(db, {
      name: 'John',
      surname: 'Doe',
      sail: 47,
    });

    // Before the fix this threw `SqliteError: ambiguous column name: sailor_id`.
    const result = await handlerRegistry.updateSailor(
      {},
      {
        ...baseEdit,
        name: 'Johnny',
        surname: 'Doe',
        boat_id: boatId,
        sail_number: 48,
      },
    );

    expect(result).toEqual({ sailorChanges: 1, boatChanges: 1 });

    const sailorRow = db
      .prepare('SELECT name, surname FROM Sailors WHERE sailor_id = 1')
      .get();
    expect(sailorRow).toMatchObject({ name: 'Johnny', surname: 'Doe' });

    const boatRow = db
      .prepare('SELECT sail_number FROM Boats WHERE boat_id = ?')
      .get(boatId);
    // sail_number has INTEGER affinity, so '48' is stored as 48.
    expect(Number(boatRow.sail_number)).toBe(48);
  });

  it('updateSailor edits the sailor tied to the boat, not another same-named sailor', async () => {
    const db = mockDbHolder.current;
    // Two identically-named sailors; only the one on boatA must change.
    const boatA = addSailorWithBoat(db, {
      name: 'Ana',
      surname: 'Lopez',
      sail: 10,
    });
    addSailorWithBoat(db, { name: 'Ana', surname: 'Lopez', sail: 20 });

    await handlerRegistry.updateSailor(
      {},
      {
        ...baseEdit,
        name: 'Ana',
        surname: 'Lopez',
        category_name: 'VETERAN', // 4
        boat_id: boatA,
        sail_number: 10,
      },
    );

    const rows = db
      .prepare('SELECT sailor_id, category_id FROM Sailors ORDER BY sailor_id')
      .all();
    expect(rows).toEqual([
      { sailor_id: 1, category_id: 4 }, // edited
      { sailor_id: 2, category_id: 3 }, // untouched
    ]);
  });

  it('updateSailor reuses an existing club matched by name AND country on rename', async () => {
    const db = mockDbHolder.current;
    db.prepare('INSERT INTO Clubs (club_name, country) VALUES (?, ?)').run(
      'YC Zagreb',
      'CRO',
    );
    const boatId = addSailorWithBoat(db, {
      name: 'Marko',
      surname: 'Maric',
      sail: 5,
    });

    await handlerRegistry.updateSailor(
      {},
      {
        ...baseEdit,
        name: 'Marko',
        surname: 'Maric',
        club_name: 'YC Zagreb',
        boat_id: boatId,
        sail_number: 5,
      },
    );

    const clubCount = db.prepare('SELECT COUNT(*) c FROM Clubs').get();
    expect(Number(clubCount.c)).toBe(2); // no duplicate club created
    const sailor = db
      .prepare('SELECT club_id FROM Sailors WHERE sailor_id = 1')
      .get();
    expect(sailor.club_id).toBe(2); // now points at YC Zagreb
  });

  it('updateSailor creates a new club when none matches the name and country', async () => {
    const db = mockDbHolder.current;
    const boatId = addSailorWithBoat(db, {
      name: 'Iva',
      surname: 'Kovac',
      sail: 7,
    });

    await handlerRegistry.updateSailor(
      {},
      {
        ...baseEdit,
        name: 'Iva',
        surname: 'Kovac',
        club_name: 'YC Rijeka',
        boat_id: boatId,
        sail_number: 7,
      },
    );

    const club = db
      .prepare('SELECT club_id, country FROM Clubs WHERE club_name = ?')
      .get('YC Rijeka');
    expect(club).toMatchObject({ country: 'CRO' });
    const sailor = db
      .prepare('SELECT club_id FROM Sailors WHERE sailor_id = 1')
      .get();
    expect(sailor.club_id).toBe(Number(club.club_id));
  });

  it('readAllSailors and readAllBoats JOIN queries execute on real SQLite', async () => {
    const db = mockDbHolder.current;
    addSailorWithBoat(db, { name: 'Ema', surname: 'Novak', sail: 12 });

    // These queries also cross Sailors/Boats — a regression that reintroduced an
    // unqualified column would throw here too.
    const sailors = await handlerRegistry.readAllSailors();
    expect(sailors).toEqual([
      expect.objectContaining({
        sailor_id: 1,
        name: 'Ema',
        surname: 'Novak',
        club_name: 'YC Split',
        category_name: 'SENIOR',
        sail_number: 12,
      }),
    ]);

    const boats = await handlerRegistry.readAllBoats();
    expect(boats).toEqual([
      expect.objectContaining({
        boat_id: 1,
        name: 'Ema',
        surname: 'Novak',
        club_name: 'YC Split',
      }),
    ]);
  });
});
