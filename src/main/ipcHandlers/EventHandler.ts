import { db } from '../../../public/Database/DBManager';
import { deleteEventLog, markConversionSeen } from '../functions/decisionStore';
import conversionReport from '../functions/conversionReport';
import { normalizeDiscardConfigString } from '../functions/discardConfig';
import handle from './handle';
import { readEventHistory } from '../functions/changeJournal';
import revertHistoryAction from '../functions/revertHistoryAction';
import restoreToHistoryPoint from '../functions/restoreToHistoryPoint';
import retryWhenBusy from '../functions/retryWhenBusy';
import { isAcceptableLogo } from '../functions/exportLogo';
import { enterBoat } from '../functions/sailorEntry';
import { applyToEvent } from '../functions/libraryWrite';
import { discardProfile } from '../functions/eventLog';
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
// The discard settings are fixed once their series has a race (SHRS 5.4),
// worked out from the races (the stored lock flags never reset; parity
// R11: undoing every race frees them again).
const EVENT_COLUMNS = `event_id, event_name, event_location, start_date,
  end_date, shrs_version, shrs_qualifying_assignment_mode,
  shrs_discard_profile_qualifying, shrs_discard_profile_final,
  EXISTS (
    SELECT 1 FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
    WHERE h.event_id = Events.event_id AND h.heat_type = 'Qualifying'
  ) AS shrs_discard_locked_qualifying,
  EXISTS (
    SELECT 1 FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
    WHERE h.event_id = Events.event_id AND h.heat_type = 'Final'
  ) AS shrs_discard_locked_final,
  shrs_heat_overflow_policy`;

/**
 * Whether each series has begun, for the edit form: the qualifying assignment
 * mode is fixed from the first qualifying race (or once the discard setting
 * was locked by one), the overflow policy once the Final Series is split.
 * The same facts guard `updateEvent`.
 */
const SERIES_STARTED_COLUMNS = `
  EXISTS (
    SELECT 1 FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
    WHERE h.event_id = Events.event_id AND h.heat_type = 'Qualifying'
  ) AS qualifying_started,
  EXISTS (
    SELECT 1 FROM Heats h
    WHERE h.event_id = Events.event_id AND h.heat_type = 'Final'
  ) AS final_series_started`;

handle('readAllEvents', async () => {
  const events = await db
    .prepare(`SELECT ${EVENT_COLUMNS}, ${SERIES_STARTED_COLUMNS} FROM Events`)
    .all();
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
  enterBoat(Number(boat_id), Number(event_id));
  const row = db
    .prepare(
      'SELECT boat_event_id FROM Boat_Event WHERE boat_id = ? AND event_id = ?',
    )
    .get(boat_id, event_id) as { boat_event_id: number } | undefined;
  return { lastInsertRowid: row?.boat_event_id ?? 0 };
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
  // regatta-core (boatRemoved) refuses a boat that has raced (she stays in
  // the results: score her DNC or RET), parity R2; any other entry goes,
  // from her heats too.
  applyToEvent(Number(event_id), {
    decide: () => [{ type: 'boatRemoved', boat: String(boat_id) }],
  });
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
            shrs_discard_locked_final,
            shrs_qualifying_assignment_mode,
            shrs_heat_overflow_policy,
            ${SERIES_STARTED_COLUMNS}
           FROM Events
           WHERE event_id = ?`,
      )
      .get(event_id) as
      | {
          shrs_discard_profile_qualifying: string;
          shrs_discard_profile_final: string;
          shrs_discard_locked_qualifying: number;
          shrs_discard_locked_final: number;
          shrs_qualifying_assignment_mode: string | null;
          shrs_heat_overflow_policy: string | null;
          qualifying_started: number;
          final_series_started: number;
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

    const assignmentMode = normalizeQualifyingAssignmentMode(
      shrs_qualifying_assignment_mode,
    );
    const overflowPolicy = normalizeHeatOverflowPolicy(
      shrs_heat_overflow_policy,
    );

    db.transaction(() => {
      db.prepare(
        `UPDATE Events
           SET event_name = ?, event_location = ?, start_date = ?, end_date = ?
           WHERE event_id = ?`,
      ).run(event_name, event_location, start_date, end_date, event_id);
      // The scoring settings are a settingsChanged decision: regatta-core
      // refuses a change of a value the racing has fixed (the assignment
      // method once qualifying started, discards once their series raced,
      // SHRS 5.4, the fleets setting once the fleets are made); a value
      // saved again unchanged is no change.
      applyToEvent(Number(event_id), {
        decide: () => [
          {
            type: 'settingsChanged',
            settings: {
              qualifyingMode: assignmentMode,
              discards: {
                qualifying: discardProfile(normalizedQualifyingDiscardProfile),
                final: discardProfile(normalizedFinalDiscardProfile),
              },
              finalOverflow:
                overflowPolicy === 'auto-increase'
                  ? 'add-fleets'
                  : 'allow-oversize',
            },
          },
        ],
      });
    })();
    return { success: true };
  },
);

handle('deleteEvent', async (event, event_id) => {
  db.transaction(() => {
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

    // Its decision log (no cascade: foreign keys are enforced).
    deleteEventLog(Number(event_id));

    // Finally delete the event itself
    db.prepare('DELETE FROM Events WHERE event_id = ?').run(event_id);
  })();

  return { success: true };
});

/**
 * What moving the event to regatta-core changed (null: nothing to tell),
 * shown on its leaderboard until the race officer confirms it.
 */
handle('readConversionReport', async (_event, raw_event_id) =>
  conversionReport(Number(raw_event_id)),
);

handle('markConversionReportSeen', async (_event, raw_event_id) => {
  markConversionSeen(Number(raw_event_id));
  return { success: true };
});
