import { db } from '../../../public/Database/DBManager';
import { invalidateAssignmentSnapshotCache } from './raceAssignmentSnapshot';
import { isAcceptableLogo } from './exportLogo';

// Full export/restore of a single event's rows across every event-scoped table.
// Used by the snapshot-to-file IPC handlers; kept here so the table list and
// the delete-then-reinsert restore transaction live in one place.

export function buildEventSnapshot(event_id: number) {
  const eventRow = db
    .prepare('SELECT * FROM Events WHERE event_id = ?')
    .get(event_id);

  if (!eventRow) {
    throw new Error(
      'This event no longer exists, so it cannot be exported. Go back to the event list.',
    );
  }

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    event_id,
    tables: {
      Events: [eventRow],
      Boat_Event: db
        .prepare('SELECT * FROM Boat_Event WHERE event_id = ?')
        .all(event_id),
      Heats: db.prepare('SELECT * FROM Heats WHERE event_id = ?').all(event_id),
      Races: db
        .prepare(
          `SELECT r.*
           FROM Races r
           JOIN Heats h ON h.heat_id = r.heat_id
           WHERE h.event_id = ?`,
        )
        .all(event_id),
      Scores: db
        .prepare(
          `SELECT s.*
           FROM Scores s
           JOIN Races r ON r.race_id = s.race_id
           JOIN Heats h ON h.heat_id = r.heat_id
           WHERE h.event_id = ?`,
        )
        .all(event_id),
      // SHRS 3.1.5: the frozen pre-protest assignment order. Omitting it made
      // a backup lossy in the one way that changes who races whom — a restored
      // event would seed its next round from the live post-protest order,
      // which is exactly what the rule forbids, and it would look correct.
      RaceAssignmentSnapshots: db
        .prepare(
          `SELECT ras.*
           FROM RaceAssignmentSnapshots ras
           JOIN Races r ON r.race_id = ras.race_id
           JOIN Heats h ON h.heat_id = r.heat_id
           WHERE h.event_id = ?`,
        )
        .all(event_id),
      Heat_Boat: db
        .prepare(
          `SELECT hb.*
           FROM Heat_Boat hb
           JOIN Heats h ON h.heat_id = hb.heat_id
           WHERE h.event_id = ?`,
        )
        .all(event_id),
      Leaderboard: db
        .prepare('SELECT * FROM Leaderboard WHERE event_id = ?')
        .all(event_id),
      FinalLeaderboard: db
        .prepare('SELECT * FROM FinalLeaderboard WHERE event_id = ?')
        .all(event_id),
    },
  };
}

/** One row of a snapshot table, as exported (column name -> value). */
export type SnapshotRow = Record<string, unknown>;

export interface EventSnapshot {
  event_id: number;
  tables: Record<string, SnapshotRow[]>;
}

export function restoreEventSnapshot(
  event_id: number,
  snapshot: EventSnapshot,
) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error(
      'This file is not an event backup made by this app, so nothing was restored.',
    );
  }

  if (Number(snapshot.event_id) !== Number(event_id)) {
    throw new Error(
      'This backup file belongs to a different event, so nothing was restored. Open that event and restore it there.',
    );
  }

  const tables = snapshot.tables || {};
  const eventRows = Array.isArray(tables.Events) ? tables.Events : [];
  if (eventRows.length !== 1) {
    throw new Error(
      'This backup file is incomplete (the event details are missing), so nothing was restored.',
    );
  }

  const tx = db.transaction(() => {
    // Before the races they reference: foreign keys are enforced and nothing
    // cascades, so leaving these behind aborts the restore outright rather
    // than orphaning a row (deleteEvent had the same gap).
    db.prepare(
      `DELETE FROM RaceAssignmentSnapshots WHERE race_id IN (
        SELECT r.race_id
        FROM Races r
        JOIN Heats h ON h.heat_id = r.heat_id
        WHERE h.event_id = ?
      )`,
    ).run(event_id);

    db.prepare(
      `DELETE FROM Scores WHERE race_id IN (
        SELECT r.race_id
        FROM Races r
        JOIN Heats h ON h.heat_id = r.heat_id
        WHERE h.event_id = ?
      )`,
    ).run(event_id);

    db.prepare(
      `DELETE FROM Races WHERE heat_id IN (
        SELECT heat_id FROM Heats WHERE event_id = ?
      )`,
    ).run(event_id);

    db.prepare(
      `DELETE FROM Heat_Boat WHERE heat_id IN (
        SELECT heat_id FROM Heats WHERE event_id = ?
      )`,
    ).run(event_id);

    db.prepare('DELETE FROM Heats WHERE event_id = ?').run(event_id);
    db.prepare('DELETE FROM Leaderboard WHERE event_id = ?').run(event_id);
    db.prepare('DELETE FROM FinalLeaderboard WHERE event_id = ?').run(event_id);
    db.prepare('DELETE FROM Boat_Event WHERE event_id = ?').run(event_id);

    const eventRow = eventRows[0];
    db.prepare(
      `UPDATE Events
       SET event_name = ?,
           event_location = ?,
           start_date = ?,
           end_date = ?,
           shrs_version = ?,
           shrs_qualifying_assignment_mode = ?,
           shrs_discard_profile_qualifying = ?,
           shrs_discard_profile_final = ?,
           shrs_discard_locked_qualifying = ?,
           shrs_discard_locked_final = ?,
           shrs_heat_overflow_policy = ?
       WHERE event_id = ?`,
    ).run(
      eventRow.event_name,
      eventRow.event_location,
      eventRow.start_date,
      eventRow.end_date,
      eventRow.shrs_version,
      eventRow.shrs_qualifying_assignment_mode,
      eventRow.shrs_discard_profile_qualifying,
      eventRow.shrs_discard_profile_final,
      eventRow.shrs_discard_locked_qualifying,
      eventRow.shrs_discard_locked_final,
      eventRow.shrs_heat_overflow_policy,
      event_id,
    );

    // The export logo travels with the event: the snapshot holds the whole
    // Events row (`SELECT *`), picture included, so a restored or imported
    // event looks the same in its documents. A snapshot from before the logo
    // existed has no such field and leaves the current logo alone; a logo that
    // is not a PNG/JPEG data URL (a hand-edited file) is dropped, not stored.
    if ('export_logo' in eventRow) {
      db.prepare('UPDATE Events SET export_logo = ? WHERE event_id = ?').run(
        isAcceptableLogo(eventRow.export_logo) ? eventRow.export_logo : null,
        event_id,
      );
    }

    // OR IGNORE: a snapshot taken before entries were made unique (schema
    // migration 2) can list a boat twice; keep one entry instead of aborting.
    const insertBoatEvent = db.prepare(
      'INSERT OR IGNORE INTO Boat_Event (boat_event_id, boat_id, event_id) VALUES (?, ?, ?)',
    );
    (tables.Boat_Event || []).forEach((row) => {
      insertBoatEvent.run(row.boat_event_id, row.boat_id, row.event_id);
    });

    const insertHeat = db.prepare(
      'INSERT INTO Heats (heat_id, event_id, heat_name, heat_type) VALUES (?, ?, ?, ?)',
    );
    (tables.Heats || []).forEach((row) => {
      insertHeat.run(row.heat_id, row.event_id, row.heat_name, row.heat_type);
    });

    // BK-1: OR IGNORE so restoring a snapshot captured before the
    // UNIQUE(heat_id, boat_id) constraint (which could contain duplicate
    // Heat_Boat rows) can't throw mid-restore — duplicates are simply dropped.
    const insertHeatBoat = db.prepare(
      'INSERT OR IGNORE INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
    );
    (tables.Heat_Boat || []).forEach((row) => {
      insertHeatBoat.run(row.heat_id, row.boat_id);
    });

    const insertRace = db.prepare(
      'INSERT INTO Races (race_id, heat_id, race_number) VALUES (?, ?, ?)',
    );
    (tables.Races || []).forEach((row) => {
      insertRace.run(row.race_id, row.heat_id, row.race_number);
    });

    const insertScore = db.prepare(
      'INSERT INTO Scores (score_id, race_id, boat_id, position, points, status, rdg_race_ids) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    (tables.Scores || []).forEach((row) => {
      insertScore.run(
        row.score_id,
        row.race_id,
        row.boat_id,
        row.position,
        row.points,
        row.status,
        // Absent from snapshots taken before schema migration 3.
        row.rdg_race_ids ?? null,
      );
    });

    const insertAssignmentSnapshot = db.prepare(
      `INSERT INTO RaceAssignmentSnapshots
         (race_id, rank, boat_id, frozen_position, frozen_status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    (tables.RaceAssignmentSnapshots || []).forEach((row) => {
      insertAssignmentSnapshot.run(
        row.race_id,
        row.rank,
        row.boat_id,
        row.frozen_position ?? null,
        row.frozen_status ?? null,
      );
    });

    const insertLeaderboard = db.prepare(
      'INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place) VALUES (?, ?, ?, ?)',
    );
    (tables.Leaderboard || []).forEach((row) => {
      insertLeaderboard.run(
        row.boat_id,
        row.total_points_event,
        row.event_id,
        row.place,
      );
    });

    const insertFinalLeaderboard = db.prepare(
      'INSERT INTO FinalLeaderboard (boat_id, total_points_final, event_id, placement_group, place) VALUES (?, ?, ?, ?, ?)',
    );
    (tables.FinalLeaderboard || []).forEach((row) => {
      insertFinalLeaderboard.run(
        row.boat_id,
        row.total_points_final,
        row.event_id,
        row.placement_group,
        row.place,
      );
    });
  });

  tx();

  // The restore rewrote RaceAssignmentSnapshots underneath the in-memory cache,
  // which is read first. Without this the pre-restore shields keep winning.
  invalidateAssignmentSnapshotCache();
}
