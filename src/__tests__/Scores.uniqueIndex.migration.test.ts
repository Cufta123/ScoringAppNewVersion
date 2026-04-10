export {};

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

describe('Scores unique index migration safety (temp sqlite file)', () => {
  let tempDbPath = '';

  beforeEach(() => {
    tempDbPath = path.join(
      os.tmpdir(),
      `scores-unique-migration-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}.db`,
    );
  });

  afterEach(() => {
    [tempDbPath, `${tempDbPath}-wal`, `${tempDbPath}-shm`].forEach((file) => {
      if (file && fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  it('preserves latest duplicate row, creates unique index, and blocks future duplicates', () => {
    const pythonScript = String.raw`
import json
import sqlite3
import sys

path = sys.argv[1]
conn = sqlite3.connect(path)
cur = conn.cursor()

cur.execute('''
  CREATE TABLE Scores (
    score_id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id INTEGER NOT NULL,
    boat_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    points REAL NOT NULL,
    status TEXT NOT NULL
  )
''')

rows = [
  (1, 10, 9, 9, 'DNS'),
  (1, 10, 2, 2, 'FINISHED'),
  (1, 11, 3, 3, 'FINISHED'),
  (2, 10, 4, 4, 'FINISHED'),
]
cur.executemany(
  'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
  rows,
)

cur.execute('''
  DELETE FROM Scores
  WHERE score_id NOT IN (
    SELECT MAX(score_id)
    FROM Scores
    GROUP BY race_id, boat_id
  )
''')

cur.execute('''
  CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_race_boat_unique
  ON Scores (race_id, boat_id)
''')

conn.commit()

cur.execute('SELECT race_id, boat_id, position, points, status FROM Scores WHERE race_id = 1 AND boat_id = 10')
deduped = [dict(zip(['race_id', 'boat_id', 'position', 'points', 'status'], row)) for row in cur.fetchall()]

cur.execute("PRAGMA index_list('Scores')")
indexes = cur.fetchall()
unique_index_present = any((row[2] == 1 and 'idx_scores_race_boat_unique' in str(row[1])) for row in indexes)

duplicate_blocked = False
try:
  cur.execute(
    'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
    (1, 10, 1, 1, 'FINISHED'),
  )
  conn.commit()
except sqlite3.IntegrityError:
  duplicate_blocked = True

different_pair_insert_ok = True
try:
  cur.execute(
    'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
    (3, 10, 1, 1, 'FINISHED'),
  )
  conn.commit()
except sqlite3.DatabaseError:
  different_pair_insert_ok = False

conn.close()

print(json.dumps({
  'deduped': deduped,
  'uniqueIndexPresent': unique_index_present,
  'duplicateBlocked': duplicate_blocked,
  'differentPairInsertOk': different_pair_insert_ok,
}))
`;

    const result = spawnSync('python', ['-c', pythonScript, tempDbPath], {
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      throw new Error(
        `Python sqlite migration check failed: ${result.stderr || result.stdout}`,
      );
    }

    const parsed = JSON.parse(result.stdout.trim());

    expect(parsed.deduped).toEqual([
      {
        race_id: 1,
        boat_id: 10,
        position: 2,
        points: 2,
        status: 'FINISHED',
      },
    ]);
    expect(parsed.uniqueIndexPresent).toBe(true);
    expect(parsed.duplicateBlocked).toBe(true);
    expect(parsed.differentPairInsertOk).toBe(true);
  });
});
