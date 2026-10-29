import {
  findIndistinguishableBoats,
  type KeyedBoat,
} from '../../shared/boatKeys';
import { db } from '../../../public/Database/DBManager';
import { normalizeDiscardConfigString } from '../functions/discardConfig';
import handle from './handle';
import { readEventHistory } from '../functions/changeJournal';
import revertHistoryAction from '../functions/revertHistoryAction';
import restoreToHistoryPoint from '../functions/restoreToHistoryPoint';
import retryWhenBusy from '../functions/retryWhenBusy';
import { isAcceptableLogo } from '../functions/exportLogo';
import {
  normalizeHeatOverflowPolicy,
  normalizeQualifyingAssignmentMode,
} from '../../shared/eventSettings';

handle('readEventHistory', async (event, event_id) =>
  readEventHistory(Number(event_id)),
);

handle('revertHistoryAction', async (event, event_id, action_id) =>
  revertHistoryAction(Number(event_id), Number(action_id)),
);

handle('restoreEventToHistoryPoint', async (event, event_id, action_id) =>
  restoreToHistoryPoint(Number(event_id), Number(action_id)),
);

/**
 * Every event column except the export logo: the logo is a picture of up to
 * a few hundred KB, and the event list is read on every screen. It has its
 * own channels below.
 */
const EVENT_COLUMNS = `event_id, event_name, event_location, start_date,
  end_date, shrs_version, shrs_qualifying_assignment_mode,
  shrs_discard_profile_qualifying, shrs_discard_profile_final,
  shrs_discard_locked_qualifying, shrs_discard_locked_final,
  shrs_heat_overflow_policy`;

handle('readAllEvents', async () => {
  const events = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM Events`).all();
  return events;
});

handle('readEventExportLogo', async (event, raw_event_id) => {
  const row = db
    .prepare('SELECT export_logo FROM Events WHERE event_id = ?')
    .get(Number(raw_event_id)) as { export_logo: string | null } | undefined;
  return row?.export_logo ?? null;
});

handle('saveEventExportLogo', async (event, raw_event_id, logo) => {
  const event_id = Number(raw_event_id);
  if (logo !== null && !isAcceptableLogo(logo)) {
    throw new Error(
      'That logo cannot be saved: it must be a PNG or JPEG picture of at most 2 MB. Choose the picture again.',
    );
  }
  const result = db
    .prepare('UPDATE Events SET export_logo = ? WHERE event_id = ?')
    .run(logo, event_id);
  if (result.changes === 0) {
    throw new Error(
      'This event no longer exists, so the logo was not saved. Go back to the event list.',
    );
  }
  return { success: true };
});

handle(
  'insertEvent',
  async (
    event,
    event_name,
    event_location,
    start_date,
    end_date,
    shrs_qualifying_assignment_mode = 'progressive',
    shrs_discard_profile_qualifying = 'standard',
    shrs_discard_profile_final = 'standard',
    shrs_heat_overflow_policy = 'auto-increase',
  ) => {
    return retryWhenBusy(() => {
      const result = db
        .prepare(
          `INSERT INTO Events (
            event_name,
            event_location,
            start_date,
            end_date,
            shrs_version,
            shrs_qualifying_assignment_mode,
            shrs_discard_profile_qualifying,
            shrs_discard_profile_final,
            shrs_heat_overflow_policy
          ) VALUES (?, ?, ?, ?, '2026-1', ?, ?, ?, ?)`,
        )
        .run(
          event_name,
          event_location,
          start_date,
          end_date,
          normalizeQualifyingAssignmentMode(shrs_qualifying_assignment_mode),
          normalizeDiscardConfigString(shrs_discard_profile_qualifying),
          normalizeDiscardConfigString(shrs_discard_profile_final),
          normalizeHeatOverflowPolicy(shrs_heat_overflow_policy),
        );
      return { lastInsertRowid: result.lastInsertRowid };
    });
  },
);

handle('associateBoatWithEvent', async (event, boat_id, event_id) => {
  // Two entries no one could tell apart (same national letters and sail
  // number) could not be scored; refuse the second here, where it can still
  // be fixed, rather than at the first heat. ITA 12 and CRO 12 are fine.
  const boat = db
    .prepare(
      'SELECT boat_id, sail_number, country FROM Boats WHERE boat_id = ?',
    )
    .get(boat_id) as KeyedBoat | undefined;
  if (boat) {
    const entered = db
      .prepare(
        `SELECT b.boat_id, b.sail_number, b.country FROM Boats b
         JOIN Boat_Event be ON be.boat_id = b.boat_id
         WHERE be.event_id = ? AND b.boat_id <> ?`,
      )
      .all(event_id, boat_id) as KeyedBoat[];
    const clash = findIndistinguishableBoats([...entered, boat]).find((group) =>
      group.boatIds.some((id) => String(id) === String(boat_id)),
    );
    if (clash && clash.name !== '') {
      throw new Error(
        `Sail ${clash.name} is already entered in this event. Check the sail number and country.`,
      );
    }
  }
  const result = db
    // OR IGNORE: one entry per boat per event (schema migration 2). Entering
    // a boat that is already entered is a no-op, not an error.
    .prepare(
      'INSERT OR IGNORE INTO Boat_Event (boat_id, event_id) VALUES (?, ?)',
    )
    .run(boat_id, event_id);
  return { lastInsertRowid: result.lastInsertRowid };
});

handle('readBoatsByEvent', async (event, event_id) => {
  const rows = db
    .prepare(
      `
SELECT
b.boat_id, b.sail_number, b.country AS boat_country, b.model,
s.name, s.surname,
c.club_name, c.country AS club_country,
cat.category_name
FROM Boats b
JOIN Boat_Event be ON b.boat_id = be.boat_id
-- LEFT: an entered boat is always listed. With inner joins a sailor with no
-- club or category (an older import, a restored backup) vanished from the
-- entry list while still racing, and the page said nobody was registered.
LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
LEFT JOIN Clubs c ON s.club_id = c.club_id
LEFT JOIN Categories cat ON s.category_id = cat.category_id
WHERE be.event_id = ?
      `,
    )
    .all(event_id);
  return rows;
});

handle('removeBoatFromEvent', async (event, boat_id, event_id) => {
  // Server-side guard. The renderer blocks this once a race has happened, but
  // that state can be stale and the channel is reachable on its own — the same
  // reasoning recreateInitialHeatsAtomic already applies. A mid-series withdrawal is
  // recorded as WTH in scoring; removing the entry would orphan her scores.
  const scored = db
    .prepare(
      `SELECT COUNT(*) AS count FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE h.event_id = ?`,
    )
    .get(event_id) as { count: number };
  if (scored.count > 0) {
    throw new Error(
      'Cannot remove a boat after a race has already been scored for this event. Record a mid-series withdrawal by scoring the boat as WTH instead.',
    );
  }

  // Heats are built from the entry list and can exist before any race, so the
  // entry and its heat assignment have to go together. Deleting only the
  // Boat_Event row left the boat in her heat — on the starting list and
  // scoreable — while every leaderboard read, which joins Boat_Event, no
  // longer knew about her.
  const removeEntry = db.transaction(() => {
    db.prepare(
      `DELETE FROM Heat_Boat
       WHERE boat_id = ?
         AND heat_id IN (SELECT heat_id FROM Heats WHERE event_id = ?)`,
    ).run(boat_id, event_id);

    // Defensive: a leaderboard row can survive undoing every race, and would
    // otherwise keep a boat who is no longer entered in the results.
    db.prepare(
      'DELETE FROM Leaderboard WHERE boat_id = ? AND event_id = ?',
    ).run(boat_id, event_id);
    db.prepare(
      'DELETE FROM FinalLeaderboard WHERE boat_id = ? AND event_id = ?',
    ).run(boat_id, event_id);

    db.prepare('DELETE FROM Boat_Event WHERE boat_id = ? AND event_id = ?').run(
      boat_id,
      event_id,
    );
  });
  removeEntry();
});

handle(
  'updateEvent',
  async (
    event,
    event_id,
    event_name,
    event_location,
    start_date,
    end_date,
    shrs_qualifying_assignment_mode = 'progressive',
    shrs_discard_profile_qualifying = 'standard',
    shrs_discard_profile_final = 'standard',
    shrs_heat_overflow_policy = 'auto-increase',
  ) => {
    const existingEvent = db
      .prepare(
        `SELECT
            shrs_discard_profile_qualifying,
            shrs_discard_profile_final,
            shrs_discard_locked_qualifying,
            shrs_discard_locked_final
           FROM Events
           WHERE event_id = ?`,
      )
      .get(event_id) as
      | {
          shrs_discard_profile_qualifying: string;
          shrs_discard_profile_final: string;
          shrs_discard_locked_qualifying: number;
          shrs_discard_locked_final: number;
        }
      | undefined;

    if (!existingEvent) {
      throw new Error(
        'This event no longer exists (it may have been deleted in the meantime). Go back to the event list.',
      );
    }

    const normalizedQualifyingDiscardProfile = normalizeDiscardConfigString(
      shrs_discard_profile_qualifying,
    );
    const normalizedFinalDiscardProfile = normalizeDiscardConfigString(
      shrs_discard_profile_final,
    );

    const existingQualifyingDiscardProfile = normalizeDiscardConfigString(
      existingEvent.shrs_discard_profile_qualifying,
    );
    const existingFinalDiscardProfile = normalizeDiscardConfigString(
      existingEvent.shrs_discard_profile_final,
    );

    if (
      existingEvent.shrs_discard_locked_qualifying === 1 &&
      existingQualifyingDiscardProfile !== normalizedQualifyingDiscardProfile
    ) {
      throw new Error(
        'The qualifying discards cannot be changed any more: a qualifying race has already been scored with the current setting.',
      );
    }

    if (
      existingEvent.shrs_discard_locked_final === 1 &&
      existingFinalDiscardProfile !== normalizedFinalDiscardProfile
    ) {
      throw new Error(
        'The Final Series discards cannot be changed any more: a final race has already been scored with the current setting.',
      );
    }

    // shrs_version is deliberately NOT written here: an event keeps the rule
    // version it was created under. Rewriting it on every edit would make a
    // future rule version silently re-label (and re-score) old events.
    db.prepare(
      `UPDATE Events
         SET event_name = ?,
             event_location = ?,
             start_date = ?,
             end_date = ?,
             shrs_qualifying_assignment_mode = ?,
             shrs_discard_profile_qualifying = ?,
             shrs_discard_profile_final = ?,
             shrs_heat_overflow_policy = ?
         WHERE event_id = ?`,
    ).run(
      event_name,
      event_location,
      start_date,
      end_date,
      normalizeQualifyingAssignmentMode(shrs_qualifying_assignment_mode),
      normalizedQualifyingDiscardProfile,
      normalizedFinalDiscardProfile,
      normalizeHeatOverflowPolicy(shrs_heat_overflow_policy),
      event_id,
    );
    return { success: true };
  },
);

handle('deleteEvent', async (event, event_id) => {
  db.transaction(() => {
    // Remove GlobalLeaderboard entries for boats in this event before Boat_Event is deleted
    db.prepare(
      `DELETE FROM GlobalLeaderboard WHERE boat_id IN (
        SELECT boat_id FROM Boat_Event WHERE event_id = ?
      )`,
    ).run(event_id);

    // SHRS 3.1.5 assignment snapshots reference Races, so they must go before
    // the races do. Foreign keys are enforced (better-sqlite3 is built with
    // SQLITE_DEFAULT_FOREIGN_KEYS=1) and the schema declares no ON DELETE
    // CASCADE, so a missed table here does not orphan a row — it aborts the
    // whole delete with "FOREIGN KEY constraint failed" and the event stays.
    // That made any event with a protest decision permanently undeletable.
    db.prepare(
      `DELETE FROM RaceAssignmentSnapshots WHERE race_id IN (
        SELECT race_id FROM Races WHERE heat_id IN (
          SELECT heat_id FROM Heats WHERE event_id = ?
        )
      )`,
    ).run(event_id);

    // Delete Scores for all races belonging to heats of this event
    db.prepare(
      `DELETE FROM Scores WHERE race_id IN (
        SELECT race_id FROM Races WHERE heat_id IN (
          SELECT heat_id FROM Heats WHERE event_id = ?
        )
      )`,
    ).run(event_id);

    // Delete Races for heats of this event
    db.prepare(
      `DELETE FROM Races WHERE heat_id IN (
        SELECT heat_id FROM Heats WHERE event_id = ?
      )`,
    ).run(event_id);

    // Delete Heat_Boat associations for heats of this event
    db.prepare(
      `DELETE FROM Heat_Boat WHERE heat_id IN (
        SELECT heat_id FROM Heats WHERE event_id = ?
      )`,
    ).run(event_id);

    // Delete Heats for this event
    db.prepare('DELETE FROM Heats WHERE event_id = ?').run(event_id);

    // Delete Boat_Event associations
    db.prepare('DELETE FROM Boat_Event WHERE event_id = ?').run(event_id);

    // Delete Leaderboard and FinalLeaderboard entries
    db.prepare('DELETE FROM Leaderboard WHERE event_id = ?').run(event_id);
    db.prepare('DELETE FROM FinalLeaderboard WHERE event_id = ?').run(event_id);

    // Finally delete the event itself
    db.prepare('DELETE FROM Events WHERE event_id = ?').run(event_id);
  })();

  return { success: true };
});
