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

/**
 * RULE-M13: drop every snapshot belonging to a heat.
 *
 * A snapshot records which boats were in a heat and in what order, so it is
 * only valid while the heat's membership is unchanged. When a boat is moved
 * between heats the stale snapshot still lists her in the old heat, so the next
 * round is built from it and she is assigned from BOTH heats — entering two
 * next-round heats at once. Invalidating on membership change makes the next
 * assignment recompute from the heat's actual boats.
 *
 * SHRS 3.1.5 ("Protest committee decisions shall not change heat assignments")
 * is not in play here: a race-office transfer is not a protest decision.
 */
export function clearAssignmentSnapshotsForHeat(heat_id: number): void {
  let raceIds: number[] = [];
  try {
    raceIds = (
      db
        .prepare('SELECT race_id FROM Races WHERE heat_id = ?')
        .all(heat_id) as { race_id: number }[]
    ).map((row) => Number(row.race_id));
  } catch {
    // Table unavailable (legacy DB or test double).
    return;
  }

  raceIds.forEach((raceId) => clearAssignmentSnapshot(raceId));
}
