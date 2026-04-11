/* eslint-disable camelcase */
import { ipcMain } from 'electron';
import { db } from '../../../public/Database/DBManager';
import { normalizeDiscardConfigString } from '../functions/discardConfig';

interface SqliteError extends Error {
  code: string;
}
const log = (message: string) => {
  console.log(message);
};

const allowedAssignmentModes = new Set(['progressive', 'pre-assigned']);
const allowedHeatOverflowPolicies = new Set([
  'auto-increase',
  'confirm-allow-oversize',
]);

const normalizeAssignmentMode = (value: unknown): string => {
  const normalized = String(value ?? 'progressive').trim().toLowerCase();
  if (!allowedAssignmentModes.has(normalized)) {
    return 'progressive';
  }
  return normalized;
};

const normalizeHeatOverflowPolicy = (value: unknown): string => {
  const normalized = String(value ?? 'auto-increase').trim().toLowerCase();
  if (!allowedHeatOverflowPolicies.has(normalized)) {
    return 'auto-increase';
  }
  return normalized;
};

console.log('EventHandler.ts loaded');

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pongSailor'));
});

const checkEventLocked = (event_id: any) => {
  const query = `SELECT is_locked FROM Events WHERE event_id = ?`;
  const checkQuery = db.prepare(query);
  const result = checkQuery.get(event_id);
  return result.is_locked === 1;
};

ipcMain.handle('readAllEvents', async () => {
  try {
    const events = await db.prepare('SELECT * FROM Events').all();
    return events;
  } catch (error) {
    console.error('Error reading all events:', error);
    throw error;
  }
});

ipcMain.handle(
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
    const maxRetries = 5;
    const delay = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    const insertEventWithRetry = async (
      attempt: number,
    ): Promise<{ lastInsertRowid: number }> => {
      try {
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
            normalizeAssignmentMode(shrs_qualifying_assignment_mode),
            normalizeDiscardConfigString(shrs_discard_profile_qualifying),
            normalizeDiscardConfigString(shrs_discard_profile_final),
            normalizeHeatOverflowPolicy(shrs_heat_overflow_policy),
          );
        return { lastInsertRowid: result.lastInsertRowid };
      } catch (error) {
        const sqliteError = error as SqliteError;
        if (sqliteError.code === 'SQLITE_BUSY' && attempt < maxRetries) {
          log(`Database is busy. Retrying in 100ms. Attempt ${attempt + 1}`);
          await delay(100 * attempt);
          return insertEventWithRetry(attempt + 1);
        }
        log(`Error inserting event: ${error}`);
        throw error;
      }
    };
    return insertEventWithRetry(1);
  },
);

ipcMain.handle('associateBoatWithEvent', async (event, boat_id, event_id) => {
  if (checkEventLocked(event_id)) {
    throw new Error('Event is locked.');
  }
  try {
    const result = db
      .prepare('INSERT INTO Boat_Event (boat_id, event_id) VALUES (?, ?)')
      .run(boat_id, event_id);
    return { lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    log(`Error associating boat with event: ${error}`);
    throw error;
  }
});

ipcMain.handle('readBoatsByEvent', async (event, event_id) => {
  try {
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
JOIN Sailors s ON b.sailor_id = s.sailor_id
JOIN Clubs c ON s.club_id = c.club_id
JOIN Categories cat ON s.category_id = cat.category_id
WHERE be.event_id = ?
        `,
      )
      .all(event_id);
    return rows;
  } catch (error) {
    console.error('Error reading boats by event:', error);
    throw error;
  }
});

ipcMain.handle('removeBoatFromEvent', async (event, boat_id, event_id) => {
  try {
    db.prepare('DELETE FROM Boat_Event WHERE boat_id = ? AND event_id = ?').run(
      boat_id,
      event_id,
    );
  } catch (error) {
    log(`Error removing boat from event: ${error}`);
    throw error;
  }
});

ipcMain.handle('lockEvent', async (event, event_id) => {
  try {
    // Check if the final series has started
    const heats = db
      .prepare('SELECT * FROM Heats WHERE event_id = ?')
      .all(event_id);
    const finalHeats = heats.filter(
      (heat: { heat_type: string }) => heat.heat_type === 'Final',
    );
    const finalSeriesStarted = finalHeats.length > 0;

    let leaderboard;
    if (finalSeriesStarted) {
      leaderboard = db
        .prepare(
          `
        SELECT
          fl.boat_id,
          fl.total_points_final,
          fl.placement_group,
          b.sail_number AS boat_number,
          b.model AS boat_type,
          s.name,
          s.surname,
          b.country
        FROM FinalLeaderboard fl
        LEFT JOIN Boats b ON fl.boat_id = b.boat_id
        LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
        WHERE fl.event_id = ?
        ORDER BY fl.placement_group, fl.total_points_final ASC
      `,
        )
        .all(event_id);
    } else {
      leaderboard = db
        .prepare(
          `
        SELECT
          lb.boat_id,
          lb.total_points_event,
          b.sail_number AS boat_number,
          b.model AS boat_type,
          s.name,
          s.surname,
          b.country
        FROM Leaderboard lb
        LEFT JOIN Boats b ON lb.boat_id = b.boat_id
        LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
        WHERE lb.event_id = ?
        ORDER BY lb.total_points_event ASC
      `,
        )
        .all(event_id);
    }

    // Update the global leaderboard
    const updateQuery = db.prepare(`
      INSERT INTO GlobalLeaderboard (boat_id, total_points_global)
      VALUES (?, ?)
      ON CONFLICT(boat_id) DO UPDATE SET total_points_global = excluded.total_points_global
    `);

    let rank = 1;
    const groupOrder = ['Gold', 'Silver', 'Bronze', 'Copper', 'General'];
    if (finalSeriesStarted) {
      groupOrder.forEach((group) => {
        const groupBoats = leaderboard.filter(
          (entry: { placement_group: string }) =>
            entry.placement_group === group,
        );
        groupBoats.forEach((entry: { boat_id: any }) => {
          updateQuery.run(entry.boat_id, rank);
          rank += 1;
        });
      });
    } else {
      leaderboard.forEach((entry: { boat_id: any }) => {
        updateQuery.run(entry.boat_id, rank);
        rank += 1;
      });
    }

    // Lock the event
    db.prepare('UPDATE Events SET is_locked = 1 WHERE event_id = ?').run(
      event_id,
    );

    console.log('Event locked and global leaderboard updated successfully.');
    return { success: true };
  } catch (error) {
    console.error(
      'Error locking event and updating global leaderboard:',
      error,
    );
    throw error;
  }
});

ipcMain.handle('unlockEvent', async (event, event_id) => {
  try {
    const query = `UPDATE Events SET is_locked = 0 WHERE event_id = ?`;
    const updateQuery = db.prepare(query);
    updateQuery.run(event_id);
    console.log(`Event ${event_id} unlocked.`);
    return { success: true };
  } catch (error) {
    console.error('Error unlocking event:', error);
    throw error;
  }
});

ipcMain.handle(
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
    try {
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
        throw new Error('Event not found.');
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
          'Qualifying discard profile is locked after the first qualifying race.',
        );
      }

      if (
        existingEvent.shrs_discard_locked_final === 1 &&
        existingFinalDiscardProfile !== normalizedFinalDiscardProfile
      ) {
        throw new Error(
          'Final discard profile is locked after the first final race.',
        );
      }

      db.prepare(
        `UPDATE Events
         SET event_name = ?,
             event_location = ?,
             start_date = ?,
             end_date = ?,
             shrs_version = '2026-1',
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
        normalizeAssignmentMode(shrs_qualifying_assignment_mode),
        normalizedQualifyingDiscardProfile,
        normalizedFinalDiscardProfile,
        normalizeHeatOverflowPolicy(shrs_heat_overflow_policy),
        event_id,
      );
      return { success: true };
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  },
);

ipcMain.handle('deleteEvent', async (event, event_id) => {
  try {
    db.transaction(() => {
      // Remove GlobalLeaderboard entries for boats in this event before Boat_Event is deleted
      db.prepare(
        `DELETE FROM GlobalLeaderboard WHERE boat_id IN (
          SELECT boat_id FROM Boat_Event WHERE event_id = ?
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
  } catch (error) {
    console.error('Error deleting event:', error);
    throw error;
  }
});
