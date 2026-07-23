import { DatabaseSync } from 'node:sqlite';

export {};

// Verifies the Scores UNIQUE(race_id, boat_id) migration against a real
// (in-memory) SQLite engine. Ported from a `python`-shell-out to `node:sqlite`
// so it no longer fails in environments without `python` on PATH (e.g. a bare
// pyenv). The SQL mirrors public/Database/DBManager.js `ensureUniqueRaceBoatScores`.

describe('Scores unique index migration safety (in-memory sqlite)', () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE Scores (
        score_id INTEGER PRIMARY KEY AUTOINCREMENT,
        race_id INTEGER NOT NULL,
        boat_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        points REAL NOT NULL,
        status TEXT NOT NULL
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  const runMigration = () => {
    db.exec(`
      DELETE FROM Scores
      WHERE score_id NOT IN (
        SELECT MAX(score_id)
        FROM Scores
        GROUP BY race_id, boat_id
      )
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_race_boat_unique
      ON Scores (race_id, boat_id)
    `);
  };

  it('preserves latest duplicate row, creates unique index, and blocks future duplicates', () => {
    const insert = db.prepare(
      'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
    );
    // (1,10) appears twice — the later row (score_id 2) must survive.
    insert.run(1, 10, 9, 9, 'DNS');
    insert.run(1, 10, 2, 2, 'FINISHED');
    insert.run(1, 11, 3, 3, 'FINISHED');
    insert.run(2, 10, 4, 4, 'FINISHED');

    runMigration();

    const deduped = db
      .prepare(
        'SELECT race_id, boat_id, position, points, status FROM Scores WHERE race_id = 1 AND boat_id = 10',
      )
      .all();
    expect(deduped).toEqual([
      {
        race_id: 1,
        boat_id: 10,
        position: 2,
        points: 2,
        status: 'FINISHED',
      },
    ]);

    const indexes = db.prepare("PRAGMA index_list('Scores')").all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(
      indexes.some(
        (i) => i.unique === 1 && i.name === 'idx_scores_race_boat_unique',
      ),
    ).toBe(true);

    // A duplicate (race_id, boat_id) insert must now throw.
    expect(() =>
      db
        .prepare(
          'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(1, 10, 1, 1, 'FINISHED'),
    ).toThrow();

    // A different pair inserts fine.
    expect(() =>
      db
        .prepare(
          'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(3, 10, 1, 1, 'FINISHED'),
    ).not.toThrow();
  });
});
