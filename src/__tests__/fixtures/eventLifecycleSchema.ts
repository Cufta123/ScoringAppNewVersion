/**
 * The subset of the real schema that the event-lifecycle handlers touch,
 * copied from `public/Database/DBManager.js` with its FOREIGN KEY clauses
 * intact.
 *
 * The clauses are the point. better-sqlite3 is compiled with
 * SQLITE_DEFAULT_FOREIGN_KEYS=1 (see release/app/node_modules/better-sqlite3/
 * deps/defines.gypi), so foreign keys are ENFORCED in the app, and node:sqlite
 * defaults to the same. A hand-cascading delete that misses a referencing
 * table therefore does not leave an orphan row — it aborts the whole delete
 * with "FOREIGN KEY constraint failed". Tests that mock the database with
 * SQL-string matching cannot see that class of bug at all, which is why these
 * run against a real engine.
 */
export const EVENT_LIFECYCLE_SCHEMA = `
  CREATE TABLE Events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT,
    event_location TEXT,
    start_date TEXT,
    end_date TEXT,
    shrs_version TEXT,
    shrs_qualifying_assignment_mode TEXT,
    shrs_discard_profile_qualifying TEXT,
    shrs_discard_profile_final TEXT,
    shrs_discard_locked_qualifying INTEGER,
    shrs_discard_locked_final INTEGER,
    shrs_heat_overflow_policy TEXT
  );

  CREATE TABLE Sailors (sailor_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, surname TEXT);

  CREATE TABLE Boats (
    boat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sail_number INTEGER NOT NULL,
    country TEXT NOT NULL,
    model TEXT NOT NULL,
    sailor_id INTEGER,
    FOREIGN KEY (sailor_id) REFERENCES Sailors(sailor_id)
  );

  CREATE TABLE Boat_Event (
    boat_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    boat_id INTEGER,
    event_id INTEGER,
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  CREATE TABLE Heats (
    heat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    heat_name TEXT NOT NULL,
    heat_type TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  CREATE TABLE Races (
    race_id INTEGER PRIMARY KEY AUTOINCREMENT,
    heat_id INTEGER NOT NULL,
    race_number INTEGER NOT NULL,
    FOREIGN KEY (heat_id) REFERENCES Heats(heat_id)
  );

  CREATE TABLE Scores (
    score_id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id INTEGER NOT NULL,
    boat_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    points REAL NOT NULL,
    status TEXT NOT NULL,
    rdg_race_ids TEXT,
    FOREIGN KEY (race_id) REFERENCES Races(race_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );

  CREATE TABLE Heat_Boat (
    heat_id INTEGER,
    boat_id INTEGER,
    FOREIGN KEY (heat_id) REFERENCES Heats(heat_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );

  CREATE TABLE Leaderboard (
    boat_id INTEGER,
    total_points_event REAL NOT NULL,
    event_id INTEGER NOT NULL,
    place INTEGER,
    PRIMARY KEY (boat_id, event_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  CREATE TABLE GlobalLeaderboard (
    boat_id INTEGER PRIMARY KEY,
    total_points_global INTEGER NOT NULL,
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );

  CREATE TABLE FinalLeaderboard (
    boat_id INTEGER,
    total_points_final REAL NOT NULL,
    event_id INTEGER NOT NULL,
    placement_group TEXT NOT NULL,
    place INTEGER,
    PRIMARY KEY (boat_id, event_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  CREATE TABLE RaceAssignmentSnapshots (
    race_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    boat_id INTEGER NOT NULL,
    frozen_position INTEGER,
    frozen_status TEXT,
    PRIMARY KEY (race_id, rank),
    FOREIGN KEY (race_id) REFERENCES Races(race_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );
`;

/**
 * Every table above that holds per-event data, i.e. everything a delete or a
 * restore has to clear. Boats/Sailors are deliberately absent: they outlive
 * the event.
 */
export const PER_EVENT_TABLES = [
  'Boat_Event',
  'Heats',
  'Races',
  'Scores',
  'Heat_Boat',
  'Leaderboard',
  'FinalLeaderboard',
  'RaceAssignmentSnapshots',
] as const;

/**
 * A stand-in for the DBManager `db` export, backed by a real node:sqlite
 * handle held in `holder.current`.
 *
 * `transaction` mirrors better-sqlite3: the body runs inside a real
 * transaction so a constraint failure rolls it back, and a nested call becomes
 * a SAVEPOINT rather than a second BEGIN (which SQLite rejects). Handlers that
 * wrap a helper which itself opens a transaction depend on that nesting.
 */
export function createSqliteDbMock(holder: { current: any }) {
  let depth = 0;
  return {
    prepare: (...args: any[]) => holder.current.prepare(...args),
    exec: (...args: any[]) => holder.current.exec(...args),
    pragma: (source: string) => holder.current.exec(`PRAGMA ${source}`),
    transaction:
      (fn: (...args: any[]) => any) =>
      (...args: any[]) => {
        const db = holder.current;
        const savepoint = `sp_${depth}`;
        db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
        depth += 1;
        try {
          const result = fn(...args);
          depth -= 1;
          db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          depth -= 1;
          db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
          if (depth > 0) db.exec(`RELEASE ${savepoint}`);
          throw error;
        }
      },
  };
}
