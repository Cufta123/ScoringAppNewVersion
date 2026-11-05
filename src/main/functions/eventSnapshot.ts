import { boatsNamed, renameBoats, replay, type Decision } from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type EventSnapshotFile,
  type EventSnapshotFileV2,
  type EventSnapshotInput,
  type SnapshotPeople,
  type SnapshotRow,
} from '../../shared/eventSnapshot';
import { loadLog, reconvertEventLog } from './decisionStore';
import { logError } from '../errorLog';
import { isAcceptableLogo } from './exportLogo';
import { replaceEventLog } from './libraryWrite';
import { enterSailor } from './sailorEntry';
import { parseRedressRaceIds } from './raceSheet';

// Export, restore and import of one event (the backup file; its format is
// shared/eventSnapshot.ts). A file of this version carries the event's
// decision log: a restore makes it the event's log, an import renames its
// boats to this database's. An older file (schemaVersion 2) carries only
// the tables, which are written back and converted to a log.

/** The EventLogs note of an event whose log came from a backup file. */
export const FROM_FILE_NOTE =
  'The decision log came from a backup file; nothing was converted.';

/** The boat ids (this database's) a log names. */
const logBoatIds = (log: Decision[]): number[] =>
  boatsNamed(log)
    .map(Number)
    .filter((id) => Number.isInteger(id));

/**
 * The boats the event uses (entered, or named by its log: a boat entered
 * and removed again), their sailors and clubs, and the category names:
 * what another computer needs to know who raced.
 */
export function buildEventPeople(
  event_id: number,
  log: Decision[] = [],
): SnapshotPeople {
  const named = logBoatIds(log);
  const boats = db
    .prepare(
      `SELECT * FROM Boats
       WHERE boat_id IN (SELECT boat_id FROM Boat_Event WHERE event_id = ?)
       ${named.length ? `OR boat_id IN (${named.map(() => '?').join(',')})` : ''}
       ORDER BY boat_id`,
    )
    .all(event_id, ...named) as SnapshotRow[];
  const idsOf = (rows: SnapshotRow[], key: string) => [
    ...new Set(rows.map((row) => row[key]).filter((id) => id != null)),
  ];
  const byIds = (table: string, key: string, ids: unknown[]) =>
    ids.length
      ? (db
          .prepare(
            `SELECT * FROM ${table} WHERE ${key} IN (${ids.map(() => '?').join(',')})`,
          )
          .all(...ids) as SnapshotRow[])
      : [];
  // Best effort past the boats: the event's own data must still back up
  // when a reference table is missing (a stripped or damaged database).
  const orEmpty = (read: () => SnapshotRow[]): SnapshotRow[] => {
    try {
      return read();
    } catch {
      return [];
    }
  };
  const sailors = orEmpty(() =>
    byIds('Sailors', 'sailor_id', idsOf(boats, 'sailor_id')),
  );
  return {
    Boats: boats,
    Sailors: sailors,
    Clubs: orEmpty(() => byIds('Clubs', 'club_id', idsOf(sailors, 'club_id'))),
    Categories: orEmpty(
      () => db.prepare('SELECT * FROM Categories').all() as SnapshotRow[],
    ),
  };
}

/**
 * The event's log for a backup file, or null when it cannot be read or
 * replayed (the file is then written without it, as version 2, and still
 * restores from its tables: a backup of a broken event is when one matters).
 */
function logForBackup(event_id: number): Decision[] | null {
  try {
    const log = loadLog(event_id);
    return replay(log).ok ? log : null;
  } catch (error) {
    logError(`Reading event ${event_id}'s decision log for a backup`, error);
    return null;
  }
}

export function buildEventSnapshot(
  event_id: number,
): EventSnapshotFile | EventSnapshotFileV2 {
  const eventRow = db
    .prepare('SELECT * FROM Events WHERE event_id = ?')
    .get(event_id) as SnapshotRow | undefined;

  if (!eventRow) {
    throw new Error(
      'This event no longer exists, so it cannot be exported. Go back to the event list.',
    );
  }

  // First: an event never used since the switch is converted here, and
  // the tables below are then its projection.
  const log = logForBackup(event_id);
  const rows = (sql: string) => db.prepare(sql).all(event_id) as SnapshotRow[];

  const file: EventSnapshotFile = {
    // 2: carries `people` (the boats, sailors and clubs the event uses), so
    // the file can be opened on another computer (importEventSnapshot).
    // 3: carries `log`, the event itself; the tables stay for people and
    // older versions.
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    event_id,
    log: log ?? [],
    people: buildEventPeople(event_id, log ?? []),
    tables: {
      Events: [eventRow],
      Boat_Event: rows('SELECT * FROM Boat_Event WHERE event_id = ?'),
      Heats: rows('SELECT * FROM Heats WHERE event_id = ?'),
      Races: rows(
        `SELECT r.*
         FROM Races r
         JOIN Heats h ON h.heat_id = r.heat_id
         WHERE h.event_id = ?`,
      ),
      Scores: rows(
        `SELECT s.*
         FROM Scores s
         JOIN Races r ON r.race_id = s.race_id
         JOIN Heats h ON h.heat_id = r.heat_id
         WHERE h.event_id = ?`,
      ),
      // SHRS 3.1.5: the frozen pre-protest assignment order. Omitting it made
      // a backup lossy in the one way that changes who races whom — a restored
      // event would seed its next round from the live post-protest order,
      // which is exactly what the rule forbids, and it would look correct.
      RaceAssignmentSnapshots: rows(
        `SELECT ras.*
         FROM RaceAssignmentSnapshots ras
         JOIN Races r ON r.race_id = ras.race_id
         JOIN Heats h ON h.heat_id = r.heat_id
         WHERE h.event_id = ?`,
      ),
      Heat_Boat: rows(
        `SELECT hb.*
         FROM Heat_Boat hb
         JOIN Heats h ON h.heat_id = hb.heat_id
         WHERE h.event_id = ?`,
      ),
    },
  };
  if (log) return file;
  const { log: _none, ...withoutLog } = file;
  return { ...withoutLog, schemaVersion: 2 };
}

/** A file from a newer app version may say things this one would misread. */
function refuseNewerFile(snapshot: EventSnapshotInput, done: string) {
  const version = Number(snapshot.schemaVersion);
  if (Number.isFinite(version) && version > SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `This backup file was made by a newer version of the app, so nothing was ${done}. Update the app, then open the file again.`,
    );
  }
}

/**
 * The file's decision log (schemaVersion 3), checked by replaying it; null
 * for an older file, which carries only the tables. A log the rules refuse
 * (a file edited by hand, or damaged) is refused in words.
 */
function fileLog(
  snapshot: EventSnapshotInput,
  done: string,
): Decision[] | null {
  if (snapshot.log === undefined) return null;
  const { log } = snapshot;
  const damaged = new Error(
    `This backup file is damaged (its results cannot be read), so nothing was ${done}.`,
  );
  if (
    !Array.isArray(log) ||
    log.some(
      (d) =>
        !d || typeof d !== 'object' || typeof (d as Decision).type !== 'string',
    )
  ) {
    throw damaged;
  }
  let result: ReturnType<typeof replay>;
  try {
    result = replay(log as Decision[]);
  } catch {
    throw damaged;
  }
  if (!result.ok) {
    throw new Error(
      `The results in this backup file cannot be worked out, so nothing was ${done}: ${result.reason}`,
    );
  }
  return log as Decision[];
}

/** Store `log` as the event's and project it (inside a transaction). */
function useFileLog(eventId: number, log: Decision[], done: string) {
  const replaced = replaceEventLog(eventId, log, FROM_FILE_NOTE);
  if (!replaced.ok) {
    throw new Error(
      `The results in this backup file cannot be worked out, so nothing was ${done}: ${replaced.reason}`,
    );
  }
}

/**
 * The export logo travels with the event: the snapshot holds the whole
 * Events row (`SELECT *`), picture included, so a restored or imported
 * event looks the same in its documents. A snapshot from before the logo
 * existed has no such field and leaves the current logo alone; a logo that
 * is not a PNG/JPEG data URL (a hand-edited file) is dropped, not stored.
 */
function restoreLogo(event_id: number, eventRow: SnapshotRow) {
  if ('export_logo' in eventRow) {
    db.prepare('UPDATE Events SET export_logo = ? WHERE event_id = ?').run(
      isAcceptableLogo(eventRow.export_logo) ? eventRow.export_logo : null,
      event_id,
    );
  }
}

/**
 * Put the event back as the backup file has it. A file with the event's
 * log (schemaVersion 3) replaces the log: the decisions in force are
 * withdrawn (kept in the history) and the file's appended, replayed and
 * projected, one action that can be gone back from; the event's own fields
 * (name, place, dates, SHRS version, logo) come from its Events row. An
 * older file's tables are written back and converted to a log.
 */
export function restoreEventSnapshot(
  event_id: number,
  snapshot: EventSnapshotInput,
) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error(
      'This file is not an event backup made by this app, so nothing was restored.',
    );
  }
  refuseNewerFile(snapshot, 'restored');

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

  const log = fileLog(snapshot, 'restored');
  if (log) {
    // The log names this database's boats; a file from another computer
    // whose event has this event's id names others (or none).
    const named = boatsNamed(log);
    const ids = logBoatIds(log);
    const known = (id: number) =>
      Boolean(db.prepare('SELECT 1 FROM Boats WHERE boat_id = ?').get(id));
    if (ids.length !== named.length || !ids.every(known)) {
      throw new Error(
        'This backup file names boats that are not on this computer (it was made on another one), so nothing was restored. Use “Import from backup…” on the event list instead.',
      );
    }
    // The same ids on another computer can be other boats: every boat must
    // also be the same boat here (national letters and sail number).
    const fileBoats = new Map(
      (snapshot.people?.Boats ?? []).map((row) => [Number(row.boat_id), row]),
    );
    const key = (
      row: { country?: unknown; sail_number?: unknown } | undefined,
    ) =>
      `${String(row?.country ?? '')
        .trim()
        .toUpperCase()} ${String(row?.sail_number ?? '')
        .trim()
        .toUpperCase()}`;
    const differing = ids.filter((id) => {
      const here = db
        .prepare('SELECT country, sail_number FROM Boats WHERE boat_id = ?')
        .get(id) as { country: unknown; sail_number: unknown };
      return key(fileBoats.get(id)) !== key(here);
    });
    if (differing.length > 0) {
      throw new Error(
        `This backup file's boats are not the boats on this computer (${differing
          .slice(0, 5)
          .map((id) => key(fileBoats.get(id)).trim() || 'a boat')
          .join(
            ', ',
          )}${differing.length > 5 ? ', …' : ''}), so nothing was restored. If the file was made on another computer, or those boats' sail numbers were changed since, use “Import from backup…” on the event list instead.`,
      );
    }
    const eventRow = eventRows[0];
    db.transaction(() => {
      db.prepare(
        `UPDATE Events
         SET event_name = ?, event_location = ?, start_date = ?, end_date = ?,
             shrs_version = ?
         WHERE event_id = ?`,
      ).run(
        eventRow.event_name,
        eventRow.event_location,
        eventRow.start_date,
        eventRow.end_date,
        eventRow.shrs_version,
        event_id,
      );
      restoreLogo(event_id, eventRow);
      useFileLog(event_id, log, 'restored');
    })();
    return;
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

    restoreLogo(event_id, eventRow);

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
      'INSERT INTO Scores (score_id, race_id, boat_id, position, points, status, rdg_race_ids, held_place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    (tables.Scores || []).forEach((row) => {
      insertScore.run(
        row.score_id,
        row.race_id,
        row.boat_id,
        row.position,
        row.points,
        row.status,
        // Absent from snapshots taken before schema migration 3 / 8.
        row.rdg_race_ids ?? null,
        row.held_place ?? null,
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
    // Standings (Leaderboard / FinalLeaderboard in files from older
    // versions) are not data: they are worked out from the results.
  });

  tx();
  // The tables are the backup's now: the event's log is converted from
  // them again (the decisions before stay in the history, withdrawn).
  reconvertEventLog(Number(event_id));
}

const NOT_A_BACKUP =
  'This file is not an event backup made by this app, so nothing was imported.';

/** "Kup", or "Kup (imported)", "Kup (imported 2)" when the name is taken. */
function freeEventName(name: string): string {
  const taken = (candidate: string) =>
    Boolean(
      db.prepare('SELECT 1 FROM Events WHERE event_name = ?').get(candidate),
    );
  if (!taken(name)) return name;
  for (let n = 1; ; n += 1) {
    const candidate = `${name} (imported${n === 1 ? '' : ` ${n}`})`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * Add the event in a backup file as a NEW event of this database: on another
 * computer, or after the event was deleted (the restore needs the event to
 * still exist). Every id is given anew; boats are matched by national
 * letters + sail number (a boat already on file is reused, with her sailor),
 * the others are entered with their sailors and clubs, as the add form
 * would. A file with the event's log (schemaVersion 3) brings the log
 * itself, its boats renamed to this database's (regatta-core
 * `renameBoats`), replayed and projected: nothing is converted. An older
 * file's tables are copied and converted to a log. The change history of
 * the original event is not carried over.
 */
export function importEventSnapshot(snapshot: EventSnapshotInput): {
  eventId: number;
  eventName: string;
} {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.tables) {
    throw new Error(NOT_A_BACKUP);
  }
  refuseNewerFile(snapshot, 'imported');
  const { tables } = snapshot;
  const eventRows = Array.isArray(tables.Events) ? tables.Events : [];
  if (eventRows.length !== 1) {
    throw new Error(
      'This backup file is incomplete (the event details are missing), so nothing was imported.',
    );
  }
  const log = fileLog(snapshot, 'imported');
  const people = snapshot.people ?? {};
  const fileBoats = Array.isArray(people.Boats) ? people.Boats : [];
  const boatById = new Map(fileBoats.map((b) => [Number(b.boat_id), b]));
  // The file's boats the event needs: the ones its log names, or (an older
  // file) the ones entered.
  const entered = log
    ? boatsNamed(log).map(Number)
    : (Array.isArray(tables.Boat_Event) ? tables.Boat_Event : []).map((row) =>
        Number(row.boat_id),
      );
  if (entered.some((id) => !boatById.has(id))) {
    throw new Error(
      log && snapshot.people
        ? 'This backup file is damaged (a boat in its results is not in the file), so nothing was imported.'
        : 'This backup was made by an older version of the app and does not include the sailors, so it can only be restored on the computer it came from (open the event there and use Restore). Make a new backup there to move the event.',
    );
  }
  const sailorById = new Map(
    (people.Sailors ?? []).map((row) => [Number(row.sailor_id), row]),
  );
  const clubById = new Map(
    (people.Clubs ?? []).map((row) => [Number(row.club_id), row]),
  );
  const categoryNameById = new Map(
    (people.Categories ?? []).map((row) => [
      Number(row.category_id),
      String(row.category_name ?? ''),
    ]),
  );
  const localCategoryId = (fileId: unknown): number | null => {
    const name = categoryNameById.get(Number(fileId));
    if (!name) return null;
    const row = db
      .prepare(
        'SELECT category_id FROM Categories WHERE UPPER(category_name) = UPPER(?)',
      )
      .get(name) as { category_id: number } | undefined;
    return row?.category_id ?? null;
  };
  const text = (value: unknown) => String(value ?? '');

  let result: { eventId: number; eventName: string } | null = null;
  db.transaction(() => {
    const row = eventRows[0];
    const eventName = freeEventName(text(row.event_name).trim() || 'Event');
    const eventId = Number(
      db
        .prepare(
          `INSERT INTO Events (
             event_name, event_location, start_date, end_date, shrs_version,
             shrs_qualifying_assignment_mode, shrs_discard_profile_qualifying,
             shrs_discard_profile_final, shrs_discard_locked_qualifying,
             shrs_discard_locked_final, shrs_heat_overflow_policy, export_logo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventName,
          text(row.event_location),
          text(row.start_date),
          text(row.end_date),
          text(row.shrs_version) || '2026-1',
          text(row.shrs_qualifying_assignment_mode) || 'progressive',
          text(row.shrs_discard_profile_qualifying) || 'standard',
          text(row.shrs_discard_profile_final) || 'standard',
          Number(row.shrs_discard_locked_qualifying) === 1 ? 1 : 0,
          Number(row.shrs_discard_locked_final) === 1 ? 1 : 0,
          text(row.shrs_heat_overflow_policy) || 'auto-increase',
          isAcceptableLogo(row.export_logo) ? row.export_logo : null,
        ).lastInsertRowid,
    );

    // Boats: the one on file with the same letters and number, or a new one
    // with her sailor and club. `into` null only stores her (the log
    // enters her), else she is entered in the new event.
    const boatMap = new Map<number, number>();
    const localBoat = (fileBoatId: number, into: number | null) => {
      const boat = boatById.get(fileBoatId) as SnapshotRow;
      const sailor = sailorById.get(Number(boat.sailor_id)) ?? {};
      const club = clubById.get(Number(sailor.club_id)) ?? {};
      const outcome = enterSailor(
        {
          name: text(sailor.name) || '?',
          surname: text(sailor.surname) || '?',
          birthday: text(sailor.birthday),
          clubName: text(club.club_name),
          country: text(boat.country),
          sailNumber: text(boat.sail_number),
          model: text(boat.model),
          categoryId: localCategoryId(sailor.category_id),
        },
        into,
        // The results belong to the boat: enter her even if she is now
        // registered to someone else on this computer.
        { useRegisteredSailor: true },
      );
      if (outcome.status === 'ownerConflict') throw new Error(NOT_A_BACKUP);
      return outcome.boatId;
    };

    if (log) {
      const names: Record<string, string> = {};
      const fileBoatOf = new Map<number, number>();
      boatsNamed(log).forEach((fileId) => {
        const local = localBoat(Number(fileId), null);
        const other = fileBoatOf.get(local);
        if (other !== undefined) {
          const label = (id: number) => {
            const b = boatById.get(id) ?? {};
            return `${text(b.country)} ${text(b.sail_number)}`.trim();
          };
          throw new Error(
            `Boats ${label(other)} and ${label(Number(fileId))} of this backup file are one boat on this computer (same letters and sail number), so nothing was imported.`,
          );
        }
        fileBoatOf.set(local, Number(fileId));
        names[fileId] = String(local);
      });
      const renamed = renameBoats(log, names);
      if (!renamed.ok) {
        throw new Error(`Nothing was imported: ${renamed.reason}`);
      }
      useFileLog(eventId, renamed.log, 'imported');
      result = { eventId, eventName };
      return;
    }

    entered.forEach((fileBoatId) => {
      if (boatMap.has(fileBoatId)) return;
      boatMap.set(fileBoatId, localBoat(fileBoatId, eventId));
    });
    const boatOf = (fileId: unknown): number => {
      const id = boatMap.get(Number(fileId));
      if (id == null) {
        throw new Error(
          'This backup file is damaged (results of a boat that is not entered), so nothing was imported.',
        );
      }
      return id;
    };

    const heatMap = new Map<number, number>();
    (tables.Heats ?? []).forEach((heat) => {
      heatMap.set(
        Number(heat.heat_id),
        Number(
          db
            .prepare(
              'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
            )
            .run(eventId, text(heat.heat_name), text(heat.heat_type))
            .lastInsertRowid,
        ),
      );
    });
    const heatOf = (fileId: unknown): number => {
      const id = heatMap.get(Number(fileId));
      if (id == null) throw new Error(NOT_A_BACKUP);
      return id;
    };

    const insertHeatBoat = db.prepare(
      'INSERT OR IGNORE INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
    );
    (tables.Heat_Boat ?? []).forEach((hb) => {
      insertHeatBoat.run(heatOf(hb.heat_id), boatOf(hb.boat_id));
    });

    const raceMap = new Map<number, number>();
    (tables.Races ?? []).forEach((race) => {
      raceMap.set(
        Number(race.race_id),
        Number(
          db
            .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
            .run(heatOf(race.heat_id), Number(race.race_number))
            .lastInsertRowid,
        ),
      );
    });
    const raceOf = (fileId: unknown): number => {
      const id = raceMap.get(Number(fileId));
      if (id == null) throw new Error(NOT_A_BACKUP);
      return id;
    };

    const insertScore = db.prepare(
      'INSERT INTO Scores (race_id, boat_id, position, points, status, rdg_race_ids, held_place) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    (tables.Scores ?? []).forEach((score) => {
      // RDG2: the races the redress averages, by race id.
      const chosen = parseRedressRaceIds(score.rdg_race_ids);
      const rdg = chosen
        ? JSON.stringify(
            chosen
              .map((id) => raceMap.get(id))
              .filter((id): id is number => id != null),
          )
        : null;
      insertScore.run(
        raceOf(score.race_id),
        boatOf(score.boat_id),
        Number(score.position),
        Number(score.points),
        text(score.status),
        rdg,
        // RRS A6.2 kept place; absent from files before schema migration 8.
        score.held_place == null ? null : Number(score.held_place),
      );
    });

    const insertShield = db.prepare(
      `INSERT INTO RaceAssignmentSnapshots
         (race_id, rank, boat_id, frozen_position, frozen_status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    (tables.RaceAssignmentSnapshots ?? []).forEach((shield) => {
      insertShield.run(
        raceOf(shield.race_id),
        shield.rank,
        boatOf(shield.boat_id),
        shield.frozen_position ?? null,
        shield.frozen_status ?? null,
      );
    });

    // Entering the boats started the event's log before its heats and
    // results were copied in: convert it from the copied tables.
    reconvertEventLog(eventId);
    result = { eventId, eventName };
  })();

  return result as unknown as { eventId: number; eventName: string };
}
