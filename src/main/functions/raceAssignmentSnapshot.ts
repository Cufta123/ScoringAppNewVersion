/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';

// SHRS 3.1.5: "Protest committee decisions shall not change heat assignments."
//
// The next-round assignment is derived from a race's finishing order. When a
// protest-committee decision changes a boat's status (e.g. FINISHED -> DSQ),
// that change must NOT reorder the next-round assignment. We freeze each boat's
// pre-decision finishing place (position + status) and, when building the next
// round, sort shielded boats by their frozen place instead of their live
// result.
//
// The freeze is PER-BOAT so that a later ordinary race-office correction to one
// boat un-shields only that boat (whose corrected result then applies) without
// dropping the 3.1.5 shield on every other protest-decision boat in the heat
// (RULE-M21).

export type FrozenAssignmentRow = {
  position: number | null;
  status: string;
};

// In-memory cache: race_id -> (boat_id -> frozen row). Backed by the
// RaceAssignmentSnapshots table so the freeze survives app restarts. All table
// access is wrapped in try/catch so legacy databases and test doubles without
// the new columns fall back to the in-memory cache.
export const raceAssignmentSnapshots = new Map<
  number,
  Map<string, FrozenAssignmentRow>
>();

export function loadPersistedAssignmentSnapshot(
  race_id: number,
): Map<string, FrozenAssignmentRow> | null {
  try {
    const rows = db
      .prepare(
        `SELECT boat_id, rank, frozen_position, frozen_status FROM RaceAssignmentSnapshots
         WHERE race_id = ? ORDER BY rank ASC`,
      )
      .all(race_id) as {
      boat_id: string | number;
      rank: number;
      frozen_position: number | null;
      frozen_status: string | null;
    }[];
    if (rows && rows.length > 0) {
      const frozen = new Map<string, FrozenAssignmentRow>();
      rows.forEach((row) => {
        // A row written before the frozen_position/frozen_status migration has
        // both columns NULL. Those snapshots only ever recorded the boat ORDER,
        // in the 0-based `rank` column, so rebuild the frozen place from it.
        // Without this every legacy row would load as position null, and
        // compareSeededRows (which coalesces null to MAX_SAFE_INTEGER) would
        // find every boat equal and fall through to national letter + sail
        // number — silently replacing the frozen order with sail-number order.
        frozen.set(String(row.boat_id), {
          position: row.frozen_position ?? Number(row.rank) + 1,
          status: row.frozen_status ?? 'FINISHED',
        });
      });
      return frozen;
    }
  } catch {
    // Table unavailable or missing the new columns (legacy DB or test double);
    // fall back to memory.
  }
  return null;
}

export function persistAssignmentSnapshot(
  race_id: number,
  frozen: Map<string, FrozenAssignmentRow>,
): void {
  try {
    const deleteStmt = db.prepare(
      'DELETE FROM RaceAssignmentSnapshots WHERE race_id = ?',
    );
    const insertStmt = db.prepare(
      'INSERT INTO RaceAssignmentSnapshots (race_id, rank, boat_id, frozen_position, frozen_status) VALUES (?, ?, ?, ?, ?)',
    );
    const tx = db.transaction(() => {
      deleteStmt.run(race_id);
      let rank = 0;
      frozen.forEach((row, boatId) => {
        insertStmt.run(race_id, rank, boatId, row.position, row.status);
        rank += 1;
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
 * RULE-M21: un-shield a single boat after an ordinary race-office correction.
 * The corrected boat's live result should drive its next-round assignment, but
 * every OTHER boat's protest shield must stay intact — unlike the previous
 * behaviour, which cleared the whole race's snapshot and dropped all shields.
 */
export function unshieldBoatFromAssignmentSnapshot(
  race_id: number,
  boat_id: any,
): void {
  const frozen =
    raceAssignmentSnapshots.get(race_id) ??
    loadPersistedAssignmentSnapshot(race_id);
  if (!frozen) {
    return;
  }
  const key = String(boat_id);
  if (!frozen.has(key)) {
    return;
  }
  frozen.delete(key);
  raceAssignmentSnapshots.set(race_id, frozen);
  if (frozen.size === 0) {
    clearAssignmentSnapshot(race_id);
  } else {
    persistAssignmentSnapshot(race_id, frozen);
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
