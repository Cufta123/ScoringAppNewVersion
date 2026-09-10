/** @jest-environment node */
export {};

// The leaderboard path walks Races -> Heats on every open, and since the
// DNC backfill landed it does so twice: once to find the rounds a boat missed
// (raceScoring.ts) and once for the leaderboard SELECT itself. Only the two
// unique constraints existed, and both lead with the wrong column for these
// lookups, so both walks fell back to scanning.
//
// On a four-season database the backfill probe measured 298 ms without these
// indexes and 3 ms with them. This test pins that the planner actually reaches
// for them rather than just that CREATE INDEX ran — an index the optimiser
// ignores buys nothing.

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const path = require('path');

/**
 * The index DDL is inside DBManager's schema bootstrap, which needs
 * better-sqlite3 and electron and so cannot be required here. Read the
 * statements out of the source instead, so the test fails if they are removed
 * or renamed rather than silently testing a copy.
 */
function indexStatementsFromDbManager(): string {
  const source = fs.readFileSync(
    path.join(__dirname, '../../public/Database/DBManager.js'),
    'utf8',
  );
  const statements = source.match(
    /CREATE INDEX IF NOT EXISTS [\s\S]*?ON \w+\([^)]*\);/g,
  );
  if (!statements || statements.length === 0) {
    throw new Error(
      'No performance indexes found in DBManager.js — did ensurePerformanceIndexes get removed?',
    );
  }
  return statements.join('\n');
}

const SCHEMA = `
  CREATE TABLE Events (event_id INTEGER PRIMARY KEY);
  CREATE TABLE Boats (boat_id INTEGER PRIMARY KEY);
  CREATE TABLE Boat_Event (boat_event_id INTEGER PRIMARY KEY, boat_id INTEGER, event_id INTEGER);
  CREATE TABLE Heats (heat_id INTEGER PRIMARY KEY, event_id INTEGER, heat_name TEXT, heat_type TEXT);
  CREATE TABLE Races (race_id INTEGER PRIMARY KEY, heat_id INTEGER, race_number INTEGER);
  CREATE TABLE Scores (score_id INTEGER PRIMARY KEY, race_id INTEGER, boat_id INTEGER, position INTEGER, points REAL, status TEXT);
  CREATE UNIQUE INDEX idx_scores_race_boat_unique ON Scores(race_id, boat_id);
`;

function open(withIndexes: boolean) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  if (withIndexes) db.exec(indexStatementsFromDbManager());
  return db;
}

const plan = (db: any, sql: string, ...args: any[]) =>
  db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...args)
    .map((row: { detail: string }) => row.detail)
    .join('\n');

const RACES_FOR_EVENT = `
  SELECT r.race_number, MIN(r.race_id) AS anchor_race_id
  FROM Races r
  JOIN Heats h ON h.heat_id = r.heat_id
  WHERE h.event_id = ? AND h.heat_type = 'Qualifying'
  GROUP BY r.race_number`;

describe('DBManager performance indexes', () => {
  it('declares them idempotently, so an existing database gains them on open', () => {
    const statements = indexStatementsFromDbManager();

    expect(statements).toContain('IF NOT EXISTS');
    // Running twice must be safe: this executes on every app start.
    const db = open(true);
    expect(() => db.exec(statements)).not.toThrow();
    db.close();
  });

  it('indexes the Races -> Heats join the leaderboard path walks', () => {
    const db = open(true);

    const detail = plan(db, RACES_FOR_EVENT, 1);

    expect(detail).toContain('idx_heats_event_id');
    expect(detail).toContain('idx_races_heat_id');
    db.close();
  });

  it('scans that join without them', () => {
    // Guards the test itself: if the query stopped being scan-bound the
    // assertion above would pass for the wrong reason.
    const db = open(false);

    expect(plan(db, RACES_FOR_EVENT, 1)).toContain('SCAN');
    db.close();
  });

  it('leaves Scores(boat_id) alone', () => {
    // Measured: it speeds the leaderboard SELECT (16 ms -> 10 ms) but pushes
    // the planner to a worse plan for the backfill probe (3 ms -> 35 ms), and
    // both run on the same click. Re-measure before adding it.
    expect(indexStatementsFromDbManager()).not.toMatch(/ON Scores\(\s*boat_id/);
  });
});
