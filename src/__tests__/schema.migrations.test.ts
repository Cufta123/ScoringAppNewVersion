/** @jest-environment node */
export {};

// The real migration runner (public/Database/schema.js) against a real SQLite
// engine. better-sqlite3 is built for Electron's ABI and will not load under
// Jest; node:sqlite runs the same SQL, and schema.js only uses the
// exec/prepare API the two share.

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const schema = require('../../public/Database/schema');

const { LATEST_SCHEMA_VERSION, MIGRATIONS, getSchemaVersion, migrate } = schema;

const tables = (db: any) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row: { name: string }) => row.name);

const indexes = (db: any, table: string) =>
  db
    .prepare(`PRAGMA index_list('${table}')`)
    .all()
    .map((row: { name: string }) => row.name);

/** A database as an early release left it: no user_version, legacy shapes. */
function legacyDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE Events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL, event_location TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL
    );
    CREATE TABLE Sailors (sailor_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      surname TEXT NOT NULL, birthday TEXT NOT NULL, category_id INTEGER, club_id INTEGER);
    CREATE TABLE Boats (
      boat_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sail_number INTEGER NOT NULL UNIQUE,
      country TEXT NOT NULL, model TEXT NOT NULL, sailor_id INTEGER
    );
    CREATE TABLE Boat_Event (boat_event_id INTEGER PRIMARY KEY AUTOINCREMENT, boat_id INTEGER, event_id INTEGER);
    CREATE TABLE Heats (heat_id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL,
      heat_name TEXT NOT NULL, heat_type TEXT NOT NULL);
    CREATE TABLE Races (race_id INTEGER PRIMARY KEY AUTOINCREMENT, heat_id INTEGER NOT NULL,
      race_number INTEGER NOT NULL);
    CREATE TABLE Scores (score_id INTEGER PRIMARY KEY AUTOINCREMENT, race_id INTEGER NOT NULL,
      boat_id INTEGER NOT NULL, position INTEGER NOT NULL, points REAL NOT NULL, status TEXT NOT NULL);
    CREATE TABLE Heat_Boat (heat_id INTEGER, boat_id INTEGER);
    CREATE TABLE RaceAssignmentSnapshots (race_id INTEGER NOT NULL, rank INTEGER NOT NULL,
      boat_id INTEGER NOT NULL, PRIMARY KEY (race_id, rank));

    INSERT INTO Events (event_id, event_name, event_location, start_date, end_date)
      VALUES (1, 'Old Cup', 'Pula', '2025-06-01', '2025-06-02');
    INSERT INTO Sailors (sailor_id, name, surname, birthday) VALUES (1, 'Ana', 'H', '1990-01-01');
    INSERT INTO Boats (boat_id, sail_number, country, model, sailor_id) VALUES (1, 11, 'CRO', 'IOM', 1);
    INSERT INTO Boat_Event (boat_id, event_id) VALUES (1, 1), (1, 1);
    INSERT INTO Heats (heat_id, event_id, heat_name, heat_type) VALUES (1, 1, 'Heat A1', 'Qualifying');
    INSERT INTO Heat_Boat VALUES (1, 1), (1, 1);
    INSERT INTO Races (race_id, heat_id, race_number) VALUES (1, 1, 1);
    INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (1, 1, 3, 3, 'FINISHED');
    INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (1, 1, 1, 1, 'FINISHED');
  `);
  return db;
}

describe('schema migrations', () => {
  it('builds a fresh database at the latest version', () => {
    const db = new DatabaseSync(':memory:');
    const beforeMigrating = jest.fn();

    const result = migrate(db, { beforeMigrating });

    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied).toEqual(MIGRATIONS.map((m: any) => m.version));
    expect(beforeMigrating).toHaveBeenCalledWith(0, LATEST_SCHEMA_VERSION);
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        'Events',
        'Sailors',
        'Boats',
        'Clubs',
        'Categories',
        'Boat_Event',
        'Heats',
        'Races',
        'Scores',
        'Heat_Boat',
        'Leaderboard',
        'GlobalLeaderboard',
        'FinalLeaderboard',
        'RaceAssignmentSnapshots',
      ]),
    );
    expect(db.prepare('SELECT COUNT(*) AS c FROM Categories').get().c).toBe(5);
    db.close();
  });

  it('does nothing — and takes no backup — when already current', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const beforeMigrating = jest.fn();

    expect(migrate(db, { beforeMigrating }).applied).toEqual([]);
    expect(beforeMigrating).not.toHaveBeenCalled();
    db.close();
  });

  it('upgrades a legacy database without losing data', () => {
    const db = legacyDb();

    migrate(db);

    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    // Events gained the SHRS settings columns with their defaults.
    expect(db.prepare('SELECT * FROM Events').get()).toMatchObject({
      event_name: 'Old Cup',
      shrs_version: '2026-1',
      shrs_discard_profile_qualifying: 'standard',
    });
    // Sail numbers may repeat across nations now.
    db.exec(
      "INSERT INTO Boats (sail_number, country, model) VALUES (11, 'ITA', 'IOM')",
    );
    // Duplicates collapsed; the LATEST score row is the one kept.
    expect(db.prepare('SELECT position FROM Scores').all()).toEqual([
      { position: 1 },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS c FROM Heat_Boat').get().c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM Boat_Event').get().c).toBe(1);
    // ...and can no longer be created.
    expect(() =>
      db.exec('INSERT INTO Boat_Event (boat_id, event_id) VALUES (1, 1)'),
    ).toThrow(/UNIQUE/);
    expect(indexes(db, 'Races')).toContain('idx_races_heat_id');
    // RULE-M21 columns added to the legacy snapshot table.
    db.exec(
      "INSERT INTO RaceAssignmentSnapshots (race_id, rank, boat_id, frozen_position, frozen_status) VALUES (1, 0, 1, 1, 'FINISHED')",
    );
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('refuses a database written by a newer app version', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);

    expect(() => migrate(db)).toThrow(/newer version/);
    db.close();
  });

  it('stops at the last good version when a migration fails, rolling it back', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const failing = {
      version: LATEST_SCHEMA_VERSION + 1,
      name: 'test: fails half-way',
      up(handle: any) {
        handle.exec('CREATE TABLE HalfDone (id INTEGER)');
        throw new Error('boom');
      },
    };
    MIGRATIONS.push(failing);
    try {
      expect(() => migrate(db)).toThrow('boom');
    } finally {
      MIGRATIONS.pop();
    }

    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tables(db)).not.toContain('HalfDone');
    db.close();
  });

  it('numbers migrations 1..n with no gaps', () => {
    expect(MIGRATIONS.map((m: any) => m.version)).toEqual(
      MIGRATIONS.map((_m: any, i: number) => i + 1),
    );
  });
});
