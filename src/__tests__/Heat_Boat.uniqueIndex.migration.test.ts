import { DatabaseSync } from 'node:sqlite';

export {};

// BK-1: verifies the Heat_Boat UNIQUE(heat_id, boat_id) migration against a real
// (in-memory) SQLite engine. Uses node:sqlite so it needs neither `python` (the
// Scores migration test's dependency, which fails without python on PATH) nor a
// native better-sqlite3 build. The SQL here is copied verbatim from
// public/Database/DBManager.js `ensureUniqueHeatBoat`.

describe('Heat_Boat unique index migration safety (in-memory sqlite)', () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    // Original schema — no UNIQUE constraint, so duplicates were possible.
    db.exec(`
      CREATE TABLE Heat_Boat (
        heat_id INTEGER,
        boat_id INTEGER
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  const runMigration = () => {
    db.exec(`
      DELETE FROM Heat_Boat
      WHERE rowid NOT IN (
        SELECT MIN(rowid)
        FROM Heat_Boat
        GROUP BY heat_id, boat_id
      );
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_heat_boat_unique
      ON Heat_Boat (heat_id, boat_id);
    `);
  };

  it('collapses historical duplicates to one row per (heat_id, boat_id)', () => {
    const insert = db.prepare(
      'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
    );
    insert.run(10, 5); // duplicate pair
    insert.run(10, 5); // duplicate pair
    insert.run(10, 6);
    insert.run(11, 5);

    runMigration();

    const rows = db
      .prepare(
        'SELECT heat_id, boat_id FROM Heat_Boat ORDER BY heat_id, boat_id',
      )
      .all();
    expect(rows).toEqual([
      { heat_id: 10, boat_id: 5 },
      { heat_id: 10, boat_id: 6 },
      { heat_id: 11, boat_id: 5 },
    ]);
  });

  it('creates the unique index and blocks future duplicate inserts', () => {
    db.prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)').run(
      10,
      5,
    );
    runMigration();

    const indexes = db
      .prepare("PRAGMA index_list('Heat_Boat')")
      .all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(
      indexes.some((i) => i.unique === 1 && i.name === 'idx_heat_boat_unique'),
    ).toBe(true);

    // A plain duplicate INSERT must now throw.
    expect(() =>
      db
        .prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')
        .run(10, 5),
    ).toThrow();

    // A different pair inserts fine.
    expect(() =>
      db
        .prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')
        .run(10, 6),
    ).not.toThrow();
  });

  it('INSERT OR IGNORE turns a duplicate into a silent no-op (the handler guard)', () => {
    db.prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)').run(
      10,
      5,
    );
    runMigration();

    const dup = db
      .prepare(
        'INSERT OR IGNORE INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
      )
      .run(10, 5);
    expect(dup.changes).toBe(0); // ignored, no duplicate created

    const fresh = db
      .prepare(
        'INSERT OR IGNORE INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
      )
      .run(10, 6);
    expect(fresh.changes).toBe(1);

    const count = db.prepare('SELECT COUNT(*) AS c FROM Heat_Boat').get() as {
      c: number;
    };
    expect(count.c).toBe(2);
  });
});
