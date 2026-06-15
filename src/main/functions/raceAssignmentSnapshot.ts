/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';

// SHRS 3.1.5: pre-protest assignment order for a race. Held in an in-memory
// cache and backed by the RaceAssignmentSnapshots table so the order survives
// app restarts. All table access is wrapped in try/catch so legacy databases
// and test doubles without the table fall back to the in-memory cache.

export const raceAssignmentSnapshots = new Map<number, string[]>();

export function loadPersistedAssignmentSnapshot(
  race_id: number,
): string[] | null {
  try {
    const rows = db
      .prepare(
        `SELECT boat_id FROM RaceAssignmentSnapshots
         WHERE race_id = ? ORDER BY rank ASC`,
      )
      .all(race_id) as { boat_id: string | number }[];
    if (rows && rows.length > 0) {
      return rows.map((row) => String(row.boat_id));
    }
  } catch {
    // Table unavailable (legacy DB or test double); fall back to memory.
  }
  return null;
}

export function persistAssignmentSnapshot(
  race_id: number,
  boatIds: string[],
): void {
  try {
    const deleteStmt = db.prepare(
      'DELETE FROM RaceAssignmentSnapshots WHERE race_id = ?',
    );
    const insertStmt = db.prepare(
      'INSERT INTO RaceAssignmentSnapshots (race_id, rank, boat_id) VALUES (?, ?, ?)',
    );
    const tx = db.transaction(() => {
      deleteStmt.run(race_id);
      boatIds.forEach((boatId, rank) => {
        insertStmt.run(race_id, rank, boatId);
      });
    });
    tx();
  } catch {
    // Table unavailable (legacy DB or test double); memory cache still applies.
  }
}

export function clearAssignmentSnapshot(race_id: number): void {
  raceAssignmentSnapshots.delete(race_id);
  try {
    db.prepare('DELETE FROM RaceAssignmentSnapshots WHERE race_id = ?').run(
      race_id,
    );
  } catch {
    // Table unavailable (legacy DB or test double); nothing to clean up.
  }
}
