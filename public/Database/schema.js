/* eslint-disable no-console */
/**
 * Versioned schema migrations.
 *
 * The database records how far it has been migrated in `PRAGMA user_version`.
 * On open, every migration above that number runs in order and the version is
 * bumped after each one, so a migration runs exactly once per database.
 *
 * Rules for adding a migration:
 *  - APPEND to MIGRATIONS. Never edit, reorder or remove a shipped migration:
 *    a database that already ran it will never run it again.
 *  - Each migration runs inside a transaction unless it sets
 *    `transaction: false` (needed only for steps that toggle
 *    `PRAGMA foreign_keys`, which SQLite ignores inside a transaction).
 *  - Only use `db.exec` and `db.prepare(...).get/all/run`, so the same code
 *    runs on better-sqlite3 in the app and on node:sqlite in the tests
 *    (`schema.migrations.test.ts`).
 *
 * Migration 1 is the schema as it stood when versioning was introduced: every
 * step is idempotent, because existing databases (user_version 0) already have
 * some or all of it.
 */

const { installJournal } = require('./journal');
const { COUNTED_RACES_VIEW } = require('./views');

const readColumns = (db, table) =>
  new Set(
    db
      .prepare(`PRAGMA table_info('${table}')`)
      .all()
      .map((row) => row.name),
  );

const addMissingColumns = (db, table, columns) => {
  const existing = readColumns(db, table);
  columns.forEach(({ name, sql }) => {
    if (existing.has(name)) return;
    console.log(`Migrating ${table}: adding ${name}...`);
    db.exec(sql);
  });
};

/** True when `table` has a UNIQUE index over exactly `columns`, in order. */
const hasUniqueIndexOn = (db, table, columns) =>
  db
    .prepare(`PRAGMA index_list('${table}')`)
    .all()
    .some((indexRow) => {
      if (!indexRow.unique) return false;
      const quoted = `"${String(indexRow.name).replace(/"/g, '""')}"`;
      const indexed = db
        .prepare(`PRAGMA index_info(${quoted})`)
        .all()
        .map((row) => row.name);
      return (
        indexed.length === columns.length &&
        indexed.every((name, i) => name === columns[i])
      );
    });

const hasUniqueSailNumberConstraint = (db) =>
  db
    .prepare("PRAGMA index_list('Boats')")
    .all()
    .some((indexRow) => {
      if (!indexRow.unique) return false;
      const quoted = `"${String(indexRow.name).replace(/"/g, '""')}"`;
      return db
        .prepare(`PRAGMA index_info(${quoted})`)
        .all()
        .some((row) => row.name === 'sail_number');
    });

const runInTransaction = (db, fn) => {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const BASELINE_TABLES = `
  CREATE TABLE IF NOT EXISTS Events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL,
    event_location TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    shrs_version TEXT NOT NULL DEFAULT '2026-1',
    shrs_qualifying_assignment_mode TEXT NOT NULL DEFAULT 'progressive',
    shrs_discard_profile_qualifying TEXT NOT NULL DEFAULT 'standard',
    shrs_discard_profile_final TEXT NOT NULL DEFAULT 'standard',
    shrs_discard_locked_qualifying INTEGER NOT NULL DEFAULT 0,
    shrs_discard_locked_final INTEGER NOT NULL DEFAULT 0,
    shrs_heat_overflow_policy TEXT NOT NULL DEFAULT 'auto-increase'
  );

  CREATE TABLE IF NOT EXISTS Sailors (
    sailor_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    surname TEXT NOT NULL,
    birthday TEXT NOT NULL,
    category_id INTEGER,
    club_id INTEGER,
    FOREIGN KEY (category_id) REFERENCES Categories(category_id),
    FOREIGN KEY (club_id) REFERENCES Clubs(club_id)
  );

  CREATE TABLE IF NOT EXISTS Boats (
    boat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sail_number INTEGER NOT NULL,
    country TEXT NOT NULL,
    model TEXT NOT NULL,
    sailor_id INTEGER,
    FOREIGN KEY (sailor_id) REFERENCES Sailors(sailor_id)
  );

  CREATE TABLE IF NOT EXISTS Clubs (
    club_id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_name TEXT NOT NULL,
    country TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS Categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL
  );
  INSERT INTO Categories (category_id, category_name) VALUES (1, 'KADET')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (2, 'JUNIOR')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (3, 'SENIOR')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (4, 'VETERAN')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (5, 'MASTER')
  ON CONFLICT(category_id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS Boat_Event (
    boat_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    boat_id INTEGER,
    event_id INTEGER,
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  CREATE TABLE IF NOT EXISTS Heats (
    heat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    heat_name TEXT NOT NULL,
    heat_type TEXT NOT NULL, -- 'Qualifying' or 'Final'
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  CREATE TABLE IF NOT EXISTS Races (
    race_id INTEGER PRIMARY KEY AUTOINCREMENT,
    heat_id INTEGER NOT NULL,
    race_number INTEGER NOT NULL,
    FOREIGN KEY (heat_id) REFERENCES Heats(heat_id)
  );

  CREATE TABLE IF NOT EXISTS Scores (
    score_id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id INTEGER NOT NULL,
    boat_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    points REAL NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY (race_id) REFERENCES Races(race_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );

  CREATE TABLE IF NOT EXISTS Heat_Boat (
    heat_id INTEGER,
    boat_id INTEGER,
    FOREIGN KEY (heat_id) REFERENCES Heats(heat_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );

  CREATE TABLE IF NOT EXISTS Leaderboard (
    boat_id INTEGER,
    total_points_event REAL NOT NULL,
    event_id INTEGER NOT NULL,
    place INTEGER,
    PRIMARY KEY (boat_id, event_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  -- Retained but unused since the global leaderboard UI was removed; kept so
  -- reviving the feature needs no migration (see AGENTS.md section 10).
  CREATE TABLE IF NOT EXISTS GlobalLeaderboard (
    boat_id INTEGER PRIMARY KEY,
    total_points_global INTEGER NOT NULL,
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );

  CREATE TABLE IF NOT EXISTS FinalLeaderboard (
    boat_id INTEGER,
    total_points_final REAL NOT NULL,
    event_id INTEGER NOT NULL,
    placement_group TEXT NOT NULL,
    place INTEGER,
    PRIMARY KEY (boat_id, event_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );

  -- SHRS 3.1.5: heat assignments must not change after a protest decision.
  -- The pre-protest finishing place of each shielded boat is persisted here.
  CREATE TABLE IF NOT EXISTS RaceAssignmentSnapshots (
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
 * Old databases declared Boats.sail_number UNIQUE. Sail numbers repeat across
 * nations, so the table is rebuilt without it. Rebuilding needs foreign keys
 * off, which SQLite ignores inside a transaction — hence its own transaction.
 */
const dropUniqueSailNumber = (db) => {
  if (!hasUniqueSailNumberConstraint(db)) return;
  console.log(
    'Migrating Boats: removing UNIQUE constraint from sail_number...',
  );
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    runInTransaction(db, () => {
      db.exec(`
        CREATE TABLE Boats_tmp (
          boat_id INTEGER PRIMARY KEY AUTOINCREMENT,
          sail_number INTEGER NOT NULL,
          country TEXT NOT NULL,
          model TEXT NOT NULL,
          sailor_id INTEGER,
          FOREIGN KEY (sailor_id) REFERENCES Sailors(sailor_id)
        );
        INSERT INTO Boats_tmp (boat_id, sail_number, country, model, sailor_id)
          SELECT boat_id, sail_number, country, model, sailor_id FROM Boats;
        DROP TABLE Boats;
        ALTER TABLE Boats_tmp RENAME TO Boats;
        INSERT OR REPLACE INTO sqlite_sequence(name, seq)
          VALUES ('Boats', COALESCE((SELECT MAX(boat_id) FROM Boats), 0));
      `);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline schema (everything before versioned migrations)',
    transaction: false,
    up(db) {
      db.exec(BASELINE_TABLES);

      addMissingColumns(db, 'Events', [
        {
          name: 'shrs_version',
          sql: "ALTER TABLE Events ADD COLUMN shrs_version TEXT NOT NULL DEFAULT '2026-1';",
        },
        {
          name: 'shrs_qualifying_assignment_mode',
          sql: "ALTER TABLE Events ADD COLUMN shrs_qualifying_assignment_mode TEXT NOT NULL DEFAULT 'progressive';",
        },
        {
          name: 'shrs_discard_profile_qualifying',
          sql: "ALTER TABLE Events ADD COLUMN shrs_discard_profile_qualifying TEXT NOT NULL DEFAULT 'standard';",
        },
        {
          name: 'shrs_discard_profile_final',
          sql: "ALTER TABLE Events ADD COLUMN shrs_discard_profile_final TEXT NOT NULL DEFAULT 'standard';",
        },
        {
          name: 'shrs_discard_locked_qualifying',
          sql: 'ALTER TABLE Events ADD COLUMN shrs_discard_locked_qualifying INTEGER NOT NULL DEFAULT 0;',
        },
        {
          name: 'shrs_discard_locked_final',
          sql: 'ALTER TABLE Events ADD COLUMN shrs_discard_locked_final INTEGER NOT NULL DEFAULT 0;',
        },
        {
          name: 'shrs_heat_overflow_policy',
          sql: "ALTER TABLE Events ADD COLUMN shrs_heat_overflow_policy TEXT NOT NULL DEFAULT 'auto-increase';",
        },
      ]);

      dropUniqueSailNumber(db);

      // RULE-M21: per-boat frozen place on pre-existing snapshot tables.
      addMissingColumns(db, 'RaceAssignmentSnapshots', [
        {
          name: 'frozen_position',
          sql: 'ALTER TABLE RaceAssignmentSnapshots ADD COLUMN frozen_position INTEGER;',
        },
        {
          name: 'frozen_status',
          sql: 'ALTER TABLE RaceAssignmentSnapshots ADD COLUMN frozen_status TEXT;',
        },
      ]);

      runInTransaction(db, () => {
        // One score per boat per race. Keep the latest row when historical
        // duplicates exist (Scores.uniqueIndex.migration.test.ts).
        if (!hasUniqueIndexOn(db, 'Scores', ['race_id', 'boat_id'])) {
          console.log(
            'Migrating Scores: enforcing unique (race_id, boat_id)...',
          );
          db.exec(`
            DELETE FROM Scores
            WHERE score_id NOT IN (
              SELECT MAX(score_id) FROM Scores GROUP BY race_id, boat_id
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_race_boat_unique
              ON Scores (race_id, boat_id);
          `);
        }

        // BK-1: one row per boat per heat. Duplicates inflated getMaxHeatSize,
        // double-seeded DNS rows and multiplied SUM(points).
        if (!hasUniqueIndexOn(db, 'Heat_Boat', ['heat_id', 'boat_id'])) {
          console.log(
            'Migrating Heat_Boat: enforcing unique (heat_id, boat_id)...',
          );
          db.exec(`
            DELETE FROM Heat_Boat
            WHERE rowid NOT IN (
              SELECT MIN(rowid) FROM Heat_Boat GROUP BY heat_id, boat_id
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_heat_boat_unique
              ON Heat_Boat (heat_id, boat_id);
          `);
        }

        // Indexes for the joins the leaderboard path walks on every open
        // (298 ms -> 3 ms for the DNC probe on a four-season database).
        // Scores(boat_id) and ANALYZE are deliberately NOT added — see
        // DBManager.performanceIndexes.test.ts before changing this.
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_races_heat_id ON Races(heat_id);
          CREATE INDEX IF NOT EXISTS idx_heats_event_id ON Heats(event_id);
        `);
      });
    },
  },
  {
    version: 2,
    name: 'one entry per boat per event',
    // Nothing stopped a boat being entered in the same event twice
    // (associateBoatWithEvent inserted blindly). A duplicate entry lists the
    // boat twice in the entry list and is reported as a duplicate sail number
    // when heats are built. Collapse existing duplicates, then enforce it.
    up(db) {
      db.exec(`
        DELETE FROM Boat_Event
        WHERE boat_event_id NOT IN (
          SELECT MIN(boat_event_id) FROM Boat_Event GROUP BY boat_id, event_id
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_boat_event_unique
          ON Boat_Event (boat_id, event_id);
      `);
    },
  },
  {
    version: 3,
    name: 'remember which races an RDG2 redress averages',
    // RDG averages are live (RRS A9 averages "all the races in the series",
    // which keeps growing), so the recompute has to know the protest
    // committee's chosen races for an RDG2. JSON array of race ids; NULL for
    // every other status. See src/shared/redress.ts.
    up(db) {
      addMissingColumns(db, 'Scores', [
        {
          name: 'rdg_race_ids',
          sql: 'ALTER TABLE Scores ADD COLUMN rdg_race_ids TEXT;',
        },
      ]);
    },
  },
  {
    version: 4,
    name: 'change journal (history of every change to an event)',
    // Append-only history written by triggers; see journal.js. History starts
    // when a database reaches this version: earlier changes were never kept.
    up(db) {
      installJournal(db);
    },
  },
  {
    version: 5,
    name: 'CountedRaces view (a qualifying race counts once every heat sailed it)',
    // See views.js. The standings count only completed races of the series.
    up(db) {
      db.exec(COUNTED_RACES_VIEW);
    },
  },
  {
    version: 6,
    name: 'history: going back to an earlier point',
    // An action that took the event back to the state right after another
    // action records which one. See restoreToHistoryPoint.ts.
    up(db) {
      addMissingColumns(db, 'ChangeActions', [
        {
          name: 'restores_to_action_id',
          sql: 'ALTER TABLE ChangeActions ADD COLUMN restores_to_action_id INTEGER;',
        },
      ]);
    },
  },
];

const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

const getSchemaVersion = (db) =>
  Number(db.prepare('PRAGMA user_version').get().user_version) || 0;

/**
 * Bring `db` up to LATEST_SCHEMA_VERSION.
 *
 * `beforeMigrating(fromVersion, toVersion)` is called once, before the first
 * pending migration, so the caller can take a backup. It is not called when
 * the database is already current.
 *
 * Throws (and leaves the database at the last fully-applied version) if a
 * migration fails, or if the database comes from a NEWER app version — opening
 * that with this code could silently misread or damage it.
 */
function migrate(db, { beforeMigrating } = {}) {
  const current = getSchemaVersion(db);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `This database was created by a newer version of IOM Regatta Manager (schema ${current}; this version understands up to ${LATEST_SCHEMA_VERSION}). Install the newer version to open it.`,
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length === 0) {
    return { from: current, to: current, applied: [] };
  }

  if (beforeMigrating) {
    beforeMigrating(current, LATEST_SCHEMA_VERSION);
  }

  const applied = [];
  pending.forEach((migration) => {
    console.log(
      `Applying schema migration ${migration.version}: ${migration.name}`,
    );
    const run = () => {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    };
    if (migration.transaction === false) {
      run();
    } else {
      runInTransaction(db, run);
    }
    applied.push(migration.version);
  });

  return { from: current, to: LATEST_SCHEMA_VERSION, applied };
}

module.exports = {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  getSchemaVersion,
  migrate,
};
