/* eslint-disable camelcase */
import { ipcMain, dialog } from 'electron';
import fs from 'fs';
import { db } from '../../../public/Database/DBManager';
import calculateBoatScores from '../functions/calculateBoatScores';

import {
  assignBoatsToNewHeatsZigZag,
  checkRaceCountForLatestHeats,
  findLatestHeatsBySuffix,
  generateNextHeatNames,
  getNextHeatIndexByMovementTable,
} from '../functions/creatingNewHeatsUtls';
import {
  DiscardConfig,
  getEventDiscardConfig,
  getExcludeCountForConfig,
} from '../functions/discardConfig';
import {
  OverallTiePacket,
  buildOverallTiePacket,
  resolveOverallTieGroupSequentially,
} from '../functions/overallTieBreak';
import { computeAdjustedFleetTotals } from '../../shared/fleetAssignment';
import explainTieBreak from '../functions/explainTieBreak';
import {
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../functions/eventSnapshot';
import {
  clearAssignmentSnapshot,
  loadPersistedAssignmentSnapshot,
  persistAssignmentSnapshot,
  raceAssignmentSnapshots,
} from '../functions/raceAssignmentSnapshot';
import {
  getLatestQualifyingHeats,
  getRaceCountForHeat,
} from '../functions/heatQueries';
import { getFinalSeriesEligibility } from '../functions/finalSeriesEligibility';
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../functions/leaderboardRecompute';
import {
  compareSeededRows,
  getHeatBaseFromName,
  getScoringPenaltyPoints,
  mandatoryDisplaceStatuses,
  normalizeScoreStatus,
  normalizeStatus,
  penaltyStatuses,
  rdgStatuses,
  scoringPenaltyStatuses,
} from '../functions/scoreStatus';

console.log('HeatRaceHandler.ts loaded');

const getEventQualifyingAssignmentMode = (event_id: any): string => {
  const row = db
    .prepare(
      'SELECT shrs_qualifying_assignment_mode FROM Events WHERE event_id = ?',
    )
    .get(event_id) as { shrs_qualifying_assignment_mode?: string } | undefined;
  const value = row?.shrs_qualifying_assignment_mode;
  if (value === 'pre-assigned') {
    return 'pre-assigned';
  }
  return 'progressive';
};

const getEventHeatOverflowPolicy = (event_id: any): string => {
  const row = db
    .prepare('SELECT shrs_heat_overflow_policy FROM Events WHERE event_id = ?')
    .get(event_id) as { shrs_heat_overflow_policy?: string } | undefined;
  if (row?.shrs_heat_overflow_policy === 'confirm-allow-oversize') {
    return 'confirm-allow-oversize';
  }
  return 'auto-increase';
};

const SHRS_MAX_BOATS_PER_HEAT = 20;

const lockDiscardProfileForRace = (race_id: number) => {
  const row = db
    .prepare(
      `SELECT h.event_id, h.heat_type
       FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE r.race_id = ?`,
    )
    .get(race_id) as { event_id: number; heat_type: string } | undefined;

  if (!row) {
    return;
  }

  if (row.heat_type === 'Qualifying') {
    db.prepare(
      'UPDATE Events SET shrs_discard_locked_qualifying = 1 WHERE event_id = ?',
    ).run(row.event_id);
  }

  if (row.heat_type === 'Final') {
    db.prepare(
      'UPDATE Events SET shrs_discard_locked_final = 1 WHERE event_id = ?',
    ).run(row.event_id);
  }
};

function getLatestRaceRowsForHeats(
  latestHeats: { heat_name: string; heat_id: number }[],
) {
  const latestRaceByHeatQuery = db.prepare(
    `SELECT race_id, race_number
     FROM Races
     WHERE heat_id = ?
     ORDER BY race_number DESC, race_id DESC
     LIMIT 1`,
  );

  const raceRows = latestHeats.map((heat) => {
    const raceRow = latestRaceByHeatQuery.get(heat.heat_id);
    if (!raceRow) {
      throw new Error(`No races found for heat ${heat.heat_name}.`);
    }
    return { ...raceRow, heat_id: heat.heat_id, heat_name: heat.heat_name };
  });

  const raceNumbers = [...new Set(raceRows.map((row) => row.race_number))];
  if (raceNumbers.length > 1) {
    throw new Error(
      'Latest qualifying heats are not aligned on the same race number.',
    );
  }

  return raceRows;
}

function applyRaceResultUpdate(
  event_id: any,
  race_id: any,
  boat_id: any,
  new_position: any,
  shift_positions: boolean,
  new_status: any,
) {
  const status = normalizeScoreStatus(new_status);
  const isRdg = rdgStatuses.includes(status);
  const isScoringPenalty = scoringPenaltyStatuses.has(status);

  // Determine heat info used by SHRS 5.2 / 44.3(c) scoring.
  const heatRow = db
    .prepare(
      `SELECT h.heat_id, h.heat_type FROM Heats h
       JOIN Races r ON r.heat_id = h.heat_id
       WHERE r.race_id = ?`,
    )
    .get(race_id) as { heat_id: number; heat_type: string } | undefined;
  const heatType = heatRow?.heat_type ?? 'Qualifying';
  const maxBoats = getMaxHeatSize(event_id, heatType);

  if (heatRow?.heat_id != null) {
    captureRaceAssignmentSnapshotIfMissing(heatRow.heat_id, Number(race_id));
  }

  // For RDG statuses keep frontend-provided value;
  // for ZFP/SCP apply scoring penalty on finishing place;
  // for other penalties use largest-heat size + 1 per SHRS 5.2.
  let finalPosition = Number(new_position);
  let points = finalPosition;
  if (!isRdg && penaltyStatuses.includes(status)) {
    if (isScoringPenalty) {
      points = getScoringPenaltyPoints(finalPosition, maxBoats, status);
    } else {
      finalPosition = maxBoats + 1;
      points = finalPosition;
    }
  }

  const currentResult = db
    .prepare(
      `SELECT position, COALESCE(status, 'FINISHED') as status
              FROM Scores
              WHERE race_id = ? AND boat_id = ?
              ORDER BY score_id DESC
              LIMIT 1`,
    )
    .get(race_id, boat_id) as { position: number; status: string } | undefined;

  if (!currentResult) {
    throw new Error(
      `Current result not found for race_id: ${race_id}, boat_id: ${boat_id}`,
    );
  }
  const currentPosition = currentResult.position;
  const previousStatus = normalizeScoreStatus(currentResult.status);

  db.prepare(
    'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
  ).run(finalPosition, points, status, race_id, boat_id);

  if (previousStatus === 'FINISHED' && mandatoryDisplaceStatuses.has(status)) {
    db.prepare(
      `UPDATE Scores SET position = position - 1, points = position - 1
       WHERE race_id = ? AND status = 'FINISHED' AND position > ?`,
    ).run(race_id, currentPosition);
  }

  if (shift_positions && status === 'FINISHED') {
    if (currentPosition > finalPosition) {
      db.prepare(
        `UPDATE Scores SET position = position + 1, points = position + 1
         WHERE race_id = ? AND status = 'FINISHED' AND position >= ? AND position < ? AND boat_id != ?`,
      ).run(race_id, finalPosition, currentPosition, boat_id);
    } else if (currentPosition < finalPosition) {
      db.prepare(
        `UPDATE Scores SET position = position - 1, points = position - 1
         WHERE race_id = ? AND status = 'FINISHED' AND position <= ? AND position > ? AND boat_id != ?`,
      ).run(race_id, finalPosition, currentPosition, boat_id);
    }
  }

  applyRaceTieScoring(race_id);
}

/**
 * SHRS 5.2: Get the number of boats in the largest heat for an event.
 * Used for penalty scoring (DNS, DSQ, RET, etc. = largest heat size + 1).
 */
function getMaxHeatSize(event_id: any, heat_type?: string): number {
  const heatTypeFilter = heat_type ? `AND h.heat_type = ?` : '';
  const sql = `
    SELECT MAX(boat_count) AS max_boats
    FROM (
      SELECT COUNT(*) AS boat_count
      FROM Heat_Boat hb
      JOIN Heats h ON hb.heat_id = h.heat_id
      WHERE h.event_id = ? ${heatTypeFilter}
      GROUP BY hb.heat_id
    )
  `;
  const row = heat_type
    ? (db.prepare(sql).get(event_id, heat_type) as
        | { max_boats: number | null }
        | undefined)
    : (db.prepare(sql).get(event_id) as
        | { max_boats: number | null }
        | undefined);
  return row?.max_boats ?? 0;
}

function seedRaceWithDefaultDnsScores(race_id: number, heat_id: number): void {
  const heatMeta = db
    .prepare('SELECT event_id, heat_type FROM Heats WHERE heat_id = ?')
    .get(heat_id) as { event_id: number; heat_type: string } | undefined;

  if (!heatMeta) {
    return;
  }

  const penaltyPosition =
    getMaxHeatSize(heatMeta.event_id, heatMeta.heat_type) + 1;
  const boatRows = db
    .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
    .all(heat_id) as { boat_id: number }[];

  const updateExisting = db.prepare(
    `UPDATE Scores
     SET position = ?, points = ?, status = 'DNS'
     WHERE race_id = ? AND boat_id = ?`,
  );
  const insertNew = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, 'DNS')`,
  );

  const tx = db.transaction(() => {
    boatRows.forEach((row) => {
      const updated = updateExisting.run(
        penaltyPosition,
        penaltyPosition,
        race_id,
        row.boat_id,
      );
      if (updated.changes === 0) {
        insertNew.run(race_id, row.boat_id, penaltyPosition, penaltyPosition);
      }
    });
  });

  tx();
}

function ensureCompleteRaceScoresForEvent(
  event_id: any,
  heatType: 'Qualifying' | 'Final',
): number {
  const missingRows = db
    .prepare(
      `SELECT r.race_id, hb.boat_id
       FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id
       JOIN Heat_Boat hb ON hb.heat_id = h.heat_id
       LEFT JOIN Scores s ON s.race_id = r.race_id AND s.boat_id = hb.boat_id
       WHERE h.event_id = ? AND h.heat_type = ? AND s.score_id IS NULL`,
    )
    .all(event_id, heatType) as { race_id: number; boat_id: number }[];

  if (missingRows.length === 0) {
    return 0;
  }

  const penaltyPosition = getMaxHeatSize(event_id, heatType) + 1;
  const insertMissingScore = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, 'DNS')`,
  );

  const transaction = db.transaction(() => {
    missingRows.forEach((row) => {
      insertMissingScore.run(
        row.race_id,
        row.boat_id,
        penaltyPosition,
        penaltyPosition,
      );
    });
  });

  transaction();
  console.warn(
    `[Data integrity] Repaired ${missingRows.length} missing score row(s) as DNS for event ${event_id} (${heatType}).`,
  );
  return missingRows.length;
}

function applyRaceTieScoring(race_id: number): void {
  // Position-keeping penalties (ZFP/SCP/T1) keep their finishing place, so they
  // occupy a slot in the finishing order even though their points are computed
  // separately. They must be included in the place walk; otherwise finishers
  // behind them would be compacted up a place and lose points (RRS A7 / 44.3c).
  const penaltyList = [...scoringPenaltyStatuses]
    .map((status) => `'${status}'`)
    .join(', ');
  const rankedRows = db
    .prepare(
      `SELECT score_id, position, status
       FROM Scores
       WHERE race_id = ? AND (status = 'FINISHED' OR status IN (${penaltyList}))
       ORDER BY position ASC, score_id ASC`,
    )
    .all(race_id) as { score_id: number; position: number; status: string }[];

  if (rankedRows.length === 0) {
    return;
  }

  const updateScore = db.prepare(
    'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
  );

  let cursorPlace = 1;
  let index = 0;

  while (index < rankedRows.length) {
    const tieValue = rankedRows[index].position;
    const tieGroup: { score_id: number; position: number; status: string }[] =
      [];

    while (
      index < rankedRows.length &&
      rankedRows[index].position === tieValue
    ) {
      tieGroup.push(rankedRows[index]);
      index += 1;
    }

    const groupSize = tieGroup.length;
    const startPlace = cursorPlace;
    const endPlace = cursorPlace + groupSize - 1;
    const tiePoints = (startPlace + endPlace) / 2;

    tieGroup.forEach((row) => {
      // Only finishers are (re)scored here. Penalty boats keep the place and
      // points assigned at submit time but still consume a place slot above.
      if (row.status === 'FINISHED') {
        updateScore.run(startPlace, tiePoints, row.score_id);
      }
    });

    cursorPlace += groupSize;
  }
}

function getSeedingResultsFromLastRace(
  event_id: any,
  latestHeats: { heat_name: string; heat_id: number }[],
) {
  checkRaceCountForLatestHeats(latestHeats, db);

  const raceCount = getRaceCountForHeat(latestHeats[0].heat_id);
  if (raceCount === 0) {
    throw new Error(
      'Cannot create next heats before the current qualifying round has race results.',
    );
  }

  const raceRows = getLatestRaceRowsForHeats(latestHeats);

  const rowsByRaceQuery = db.prepare(
    `SELECT
      hb.boat_id,
      sc.position,
      sc.status,
      b.country,
      b.sail_number
     FROM Heat_Boat hb
     JOIN Boats b ON b.boat_id = hb.boat_id
     LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id
     WHERE hb.heat_id = ?`,
  );

  const seedingRows = raceRows.flatMap((raceRow) =>
    rowsByRaceQuery
      .all(raceRow.race_id, raceRow.heat_id)
      .map(
        (row: {
          boat_id: string;
          position: number | null;
          status: string | null;
          country: string | null;
          sail_number: string | number | null;
        }) => ({
          boat_id: row.boat_id,
          position: row.position,
          status: normalizeStatus(row.status),
          country: row.country,
          sail_number: row.sail_number,
        }),
      ),
  );

  seedingRows.sort(compareSeededRows);

  return seedingRows.map((row) => ({ boat_id: row.boat_id }));
}

function getOddEvenMovementAdvisory(
  numberOfHeats: number,
  totalBoats: number,
): string | null {
  // SHRS 2026 end-note advisory: with 2 heats and odd/even movement,
  // fleet totals where N mod 4 = 2 can temporarily produce a 2-boat imbalance.
  if (numberOfHeats === 2 && totalBoats >= 14 && totalBoats % 4 === 2) {
    return (
      `SHRS advisory: with odd/even movement tables and ${totalBoats} boats in 2 heats, ` +
      'a temporary 2-boat imbalance between heats can occur and is expected.'
    );
  }
  return null;
}

function getRankedBoatsInHeatForRace(heat_id: number, race_id: number) {
  const rowsByRaceQuery = db.prepare(
    `SELECT
      hb.boat_id,
      sc.position,
      sc.status,
      b.country,
      b.sail_number
     FROM Heat_Boat hb
     JOIN Boats b ON b.boat_id = hb.boat_id
     LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id
     WHERE hb.heat_id = ?`,
  );

  const rows: {
    boat_id: string;
    position: number | null;
    status: string;
    country: string | null;
    sail_number: string | number | null;
  }[] = rowsByRaceQuery
    .all(race_id, heat_id)
    .map(
      (row: {
        boat_id: string;
        position: number | null;
        status: string | null;
        country: string | null;
        sail_number: string | number | null;
      }) => ({
        boat_id: row.boat_id,
        position: row.position,
        status:
          normalizeStatus(row.status) || (row.position == null ? 'DNS' : ''),
        country: row.country,
        sail_number: row.sail_number,
      }),
    );

  rows.sort(compareSeededRows);

  return rows;
}

function captureRaceAssignmentSnapshotIfMissing(
  heat_id: number,
  race_id: number,
) {
  if (raceAssignmentSnapshots.has(race_id)) {
    return;
  }

  const persisted = loadPersistedAssignmentSnapshot(race_id);
  if (persisted) {
    raceAssignmentSnapshots.set(race_id, persisted);
    return;
  }

  const rankedRows = getRankedBoatsInHeatForRace(heat_id, race_id);
  const boatIds = rankedRows.map((row) => row.boat_id);
  raceAssignmentSnapshots.set(race_id, boatIds);
  persistAssignmentSnapshot(race_id, boatIds);
}

function getAssignmentRowsForHeatRace(heat_id: number, race_id: number) {
  const snapshotBoatIds =
    raceAssignmentSnapshots.get(race_id) ??
    loadPersistedAssignmentSnapshot(race_id);
  if (snapshotBoatIds && snapshotBoatIds.length > 0) {
    raceAssignmentSnapshots.set(race_id, snapshotBoatIds);
    return snapshotBoatIds.map((boat_id) => ({ boat_id }));
  }

  const rankedRows = getRankedBoatsInHeatForRace(heat_id, race_id);
  const boatIds = rankedRows.map((row) => row.boat_id);
  raceAssignmentSnapshots.set(race_id, boatIds);
  persistAssignmentSnapshot(race_id, boatIds);
  return rankedRows.map((row) => ({ boat_id: row.boat_id }));
}

function buildAdjustedFleetLeaderboard(
  leaderboard: Array<{
    boat_id: number;
    race_points: string | null;
    race_statuses: string | null;
  }>,
  qualifyingDiscardConfig: DiscardConfig,
  applyShs43TemporarySecondDiscard = true,
): Array<{ boat_id: number; totalPoints: number }> {
  return computeAdjustedFleetTotals(leaderboard, {
    applyShs43TemporarySecondDiscard,
    getExcludeCount: (n: number) =>
      getExcludeCountForConfig(n, qualifyingDiscardConfig),
  });
}

ipcMain.handle('readAllHeats', async (event, event_id) => {
  try {
    const heats = db
      .prepare('SELECT * FROM Heats WHERE event_id = ?')
      .all(event_id);
    return heats;
  } catch (error) {
    console.error('Error reading all heats:', error);
    throw error;
  }
});

ipcMain.handle('exportEventSnapshotToFile', async (_event, event_id) => {
  try {
    const snapshot = buildEventSnapshot(Number(event_id));
    const eventNameSafe = String(
      snapshot.tables.Events?.[0]?.event_name || 'event',
    )
      .replace(/[^a-z0-9_-]/gi, '_')
      .slice(0, 60);

    const saveResult = await dialog.showSaveDialog({
      title: 'Save Event Snapshot',
      defaultPath: `${eventNameSafe}_snapshot.json`,
      filters: [{ name: 'JSON files', extensions: ['json'] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    fs.writeFileSync(
      saveResult.filePath,
      JSON.stringify(snapshot, null, 2),
      'utf-8',
    );

    return {
      success: true,
      filePath: saveResult.filePath,
    };
  } catch (error) {
    console.error('Error exporting event snapshot:', error);
    throw error;
  }
});

ipcMain.handle('restoreEventSnapshotFromFile', async (_event, event_id) => {
  try {
    const openResult = await dialog.showOpenDialog({
      title: 'Load Event Snapshot',
      properties: ['openFile'],
      filters: [{ name: 'JSON files', extensions: ['json'] }],
    });

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = openResult.filePaths[0];
    const snapshotRaw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(snapshotRaw);

    restoreEventSnapshot(Number(event_id), parsed);

    return {
      success: true,
      filePath,
    };
  } catch (error) {
    console.error('Error restoring event snapshot:', error);
    throw error;
  }
});

ipcMain.handle('insertHeat', async (event, event_id, heat_name, heat_type) => {
  try {
    const result = db
      .prepare(
        'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
      )
      .run(event_id, heat_name, heat_type);
    return { lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    console.error('Error inserting heat:', error);
    throw error;
  }
});

ipcMain.handle('insertHeatBoat', async (event, heat_id, boat_id) => {
  try {
    const heatRow = db
      .prepare(
        `SELECT h.event_id
         FROM Heats h
         WHERE h.heat_id = ?`,
      )
      .get(heat_id) as { event_id: number } | undefined;

    if (!heatRow) {
      throw new Error('Heat not found.');
    }

    const boatsInHeat = db
      .prepare('SELECT COUNT(*) as count FROM Heat_Boat WHERE heat_id = ?')
      .get(heat_id) as { count: number };

    if (boatsInHeat.count >= SHRS_MAX_BOATS_PER_HEAT) {
      throw new Error(
        `Cannot assign more than ${SHRS_MAX_BOATS_PER_HEAT} boats to one heat.`,
      );
    }

    const result = db
      .prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')
      .run(heat_id, boat_id);
    return { lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    console.error('Error inserting heat boat:', error);
    throw error;
  }
});
ipcMain.handle('deleteHeatsByEvent', async (event, event_id) => {
  try {
    // Delete Scores for all races in heats belonging to this event
    db.prepare(
      `DELETE FROM Scores WHERE race_id IN (
        SELECT r.race_id FROM Races r
        JOIN Heats h ON r.heat_id = h.heat_id
        WHERE h.event_id = ?
      )`,
    ).run(event_id);

    // Delete Races for heats belonging to this event
    db.prepare(
      `DELETE FROM Races WHERE heat_id IN (
        SELECT heat_id FROM Heats WHERE event_id = ?
      )`,
    ).run(event_id);

    // Delete Heat_Boat associations
    const result = db
      .prepare(
        'DELETE FROM Heat_Boat WHERE heat_id IN (SELECT heat_id FROM Heats WHERE event_id = ?)',
      )
      .run(event_id);
    console.log(
      `Deleted ${result.changes} row(s) from Heat_Boat for event ID ${event_id}.`,
    );

    const resultHeats = db
      .prepare('DELETE FROM Heats WHERE event_id = ?')
      .run(event_id);
    console.log(
      `Deleted ${resultHeats.changes} row(s) from Heats for event ID ${event_id}.`,
    );

    return {
      heatBoatsChanges: result.changes,
      heatsChanges: resultHeats.changes,
    };
  } catch (error) {
    console.error('Error deleting heats by event:', error);
    throw error;
  }
});
ipcMain.handle('readBoatsByHeat', async (event, heat_id) => {
  try {
    const boats = db
      .prepare(
        `
        SELECT
          b.boat_id,
          b.sail_number,
          b.country,
          b.model,
          s.name,
          s.surname,
          cat.category_name
        FROM Heat_Boat hb
        JOIN Boats b ON hb.boat_id = b.boat_id
        JOIN Sailors s ON b.sailor_id = s.sailor_id
        LEFT JOIN Categories cat ON s.category_id = cat.category_id
        WHERE hb.heat_id = ?
      `,
      )
      .all(heat_id);
    return boats;
  } catch (error) {
    console.error('Error reading boats by heat:', error);
    throw error;
  }
});
ipcMain.handle('readAllRaces', async (event, heat_id) => {
  try {
    const races = db
      .prepare('SELECT * FROM Races WHERE heat_id = ?')
      .all(heat_id);
    return races;
  } catch (error) {
    console.error('Error reading all races:', error);
    throw error;
  }
});

ipcMain.handle('insertRace', async (event, heat_id, race_number) => {
  try {
    const heatRow = db
      .prepare('SELECT event_id FROM Heats WHERE heat_id = ?')
      .get(heat_id) as { event_id?: number } | undefined;

    if (heatRow?.event_id == null) {
      throw new Error('Heat not found.');
    }

    const result = db
      .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
      .run(heat_id, race_number);
    seedRaceWithDefaultDnsScores(Number(result.lastInsertRowid), heat_id);
    return { lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    console.error('Error inserting race:', error);
    throw error;
  }
});

ipcMain.handle('readAllScores', async (event, race_id) => {
  try {
    const scores = db
      .prepare('SELECT * FROM Scores WHERE race_id = ?')
      .all(race_id);
    return scores;
  } catch (error) {
    console.error('Error reading all scores:', error);
    throw error;
  }
});

ipcMain.handle(
  'insertScore',
  async (event, race_id, boat_id, position, points, status) => {
    try {
      const raceRow = db
        .prepare(
          `SELECT h.event_id
           FROM Races r
           JOIN Heats h ON h.heat_id = r.heat_id
           WHERE r.race_id = ?`,
        )
        .get(race_id) as { event_id?: number } | undefined;

      if (raceRow?.event_id == null) {
        throw new Error('Race not found.');
      }

      const normalizedStatus = normalizeScoreStatus(status);
      const updated = db
        .prepare(
          'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
        )
        .run(position, points, normalizedStatus, race_id, boat_id);

      let result = updated;
      if (updated.changes === 0) {
        result = db
          .prepare(
            'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
          )
          .run(race_id, boat_id, position, points, normalizedStatus);
      }

      if (normalizedStatus === 'FINISHED') {
        applyRaceTieScoring(race_id);
      }
      lockDiscardProfileForRace(Number(race_id));
      return { lastInsertRowid: result.lastInsertRowid };
    } catch (error) {
      console.error('Error inserting score:', error);
      throw error;
    }
  },
);

ipcMain.handle('getMaxHeatSize', async (event, event_id, heat_type) => {
  try {
    return getMaxHeatSize(event_id, heat_type || undefined);
  } catch (error) {
    console.error('Error getting max heat size:', error);
    throw error;
  }
});

// Explain the SHRS 5.7 tie-break between two boats for the compare panel.
// The winner is taken from the same comparator the ranking uses, so the panel
// can never disagree with the actual placement. Series flag selects the
// qualifying comparator vs the combined overall (final-series) comparator.
ipcMain.handle(
  'explainTieBreak',
  async (_event, event_id, boatAId, boatBId, isFinalSeries) => {
    try {
      return explainTieBreak(
        event_id,
        String(boatAId),
        String(boatBId),
        Boolean(isFinalSeries),
      );
    } catch (error) {
      console.error('Error explaining tie-break:', error);
      throw error;
    }
  },
);

// SHRS validation of whether the Final Series can start. The renderer renders
// prompts/messages from the returned reason; all the rule logic stays here.
ipcMain.handle('getFinalSeriesEligibility', async (_event, event_id) => {
  try {
    return getFinalSeriesEligibility(event_id);
  } catch (error) {
    console.error('Error checking final series eligibility:', error);
    throw error;
  }
});

// Atomically score a whole race: create the next race for the heat, apply the
// SHRS 5.2 / RRS 44.3(c)/T1 penalty math, persist every boat's score in a
// single transaction, then recompute the relevant leaderboard. Previously this
// lived in the renderer as N sequential IPC calls, so a mid-loop failure could
// leave a half-scored race. Keeping it here makes scoring all-or-nothing and
// keeps the domain logic in the main process.
ipcMain.handle('submitHeatRaceScoresAtomic', async (_event, payload) => {
  const {
    event_id,
    heat_id,
    placeNumbers,
    isFinalSeries = false,
  } = payload as {
    event_id: number;
    heat_id: number;
    placeNumbers: Array<{
      boatNumber: string | number;
      place: number;
      status: string;
    }>;
    isFinalSeries?: boolean;
  };

  try {
    const boats = db
      .prepare(
        `SELECT b.boat_id, b.sail_number
         FROM Heat_Boat hb
         JOIN Boats b ON hb.boat_id = b.boat_id
         WHERE hb.heat_id = ?`,
      )
      .all(heat_id) as Array<{ boat_id: number; sail_number: string | number }>;

    const normalizeSail = (value: unknown) => String(value).trim();
    const boatsBySail = new Map(
      boats.map((boat) => [normalizeSail(boat.sail_number), boat]),
    );

    const unmatched = placeNumbers
      .map((entry) => entry.boatNumber)
      .filter((boatNumber) => !boatsBySail.has(normalizeSail(boatNumber)));

    // Surface a structured result so the renderer can show a targeted message
    // instead of throwing. Nothing has been written at this point.
    if (unmatched.length > 0) {
      return { ok: false as const, reason: 'UNMATCHED_SAILS', unmatched };
    }

    const heatType = isFinalSeries ? 'Final' : 'Qualifying';
    const maxHeatSize = getMaxHeatSize(event_id, heatType);
    const heatSizeForPenalty = maxHeatSize || placeNumbers.length;
    const penaltyPlace = heatSizeForPenalty + 1;

    const existingRaceCount = (
      db
        .prepare('SELECT COUNT(*) AS count FROM Races WHERE heat_id = ?')
        .get(heat_id) as { count: number }
    ).count;
    const nextRaceNumber = existingRaceCount + 1;

    let raceId = 0;
    const writeScores = db.transaction(() => {
      const raceResult = db
        .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
        .run(heat_id, nextRaceNumber);
      raceId = Number(raceResult.lastInsertRowid);
      seedRaceWithDefaultDnsScores(raceId, heat_id);

      let hasFinisher = false;
      placeNumbers.forEach(({ boatNumber, place, status }) => {
        const boat = boatsBySail.get(normalizeSail(boatNumber))!;
        const normalizedStatus = normalizeScoreStatus(status);

        let position = place;
        let points = place;
        if (normalizedStatus !== 'FINISHED') {
          if (scoringPenaltyStatuses.has(normalizedStatus)) {
            // ZFP/SCP/T1: keep finishing place, add the scoring-penalty places.
            position = place;
            points = getScoringPenaltyPoints(
              place,
              heatSizeForPenalty,
              normalizedStatus,
            );
          } else {
            // Non-scoring penalties (DNF/DNS/...) take the penalty score.
            position = place || penaltyPlace;
            points = penaltyPlace;
          }
        } else {
          hasFinisher = true;
        }

        const updated = db
          .prepare(
            'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
          )
          .run(position, points, normalizedStatus, raceId, boat.boat_id);
        if (updated.changes === 0) {
          db.prepare(
            'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
          ).run(raceId, boat.boat_id, position, points, normalizedStatus);
        }
      });

      if (hasFinisher) {
        applyRaceTieScoring(raceId);
      }
      lockDiscardProfileForRace(raceId);
    });

    writeScores();

    // Recompute leaderboards exactly as the renderer used to orchestrate it:
    // qualifying only updates once every latest heat has the same race count.
    if (isFinalSeries) {
      recomputeFinalLeaderboard(event_id);
    } else {
      let allHeatsEqual = false;
      try {
        const latestHeats = getLatestQualifyingHeats(event_id);
        const raceCounts = latestHeats.map((heat: { heat_id: number }) =>
          getRaceCountForHeat(heat.heat_id),
        );
        allHeatsEqual = raceCounts.every((count) => count === raceCounts[0]);
      } catch (countError) {
        allHeatsEqual = false;
      }
      if (allHeatsEqual) {
        recomputeEventLeaderboard(event_id);
      }
    }

    return { ok: true as const, raceNumber: nextRaceNumber, raceId };
  } catch (error) {
    console.error('Error submitting heat race scores:', error);
    throw error;
  }
});

ipcMain.handle(
  'updateScore',
  async (event, score_id, position, points, status) => {
    try {
      const normalizedStatus = normalizeScoreStatus(status);
      const row = db
        .prepare('SELECT race_id FROM Scores WHERE score_id = ?')
        .get(score_id) as { race_id?: number } | undefined;
      const result = db
        .prepare(
          'UPDATE Scores SET position = ?, points = ?, status = ? WHERE score_id = ?',
        )
        .run(position, points, normalizedStatus, score_id);
      if (row?.race_id != null) {
        lockDiscardProfileForRace(Number(row.race_id));
      }
      return { changes: result.changes };
    } catch (error) {
      console.error('Error updating score:', error);
      throw error;
    }
  },
);
ipcMain.handle('updateEventLeaderboard', async (event, event_id) => {
  try {
    recomputeEventLeaderboard(event_id);
  } catch (error) {
    console.error(
      'Error updating event leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle('updateGlobalLeaderboard', async (event, event_id) => {
  try {
    const query = `
      SELECT boat_id, RANK() OVER (ORDER BY total_points_event ASC) as final_position
      FROM Leaderboard
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all();

    const updateQuery = db.prepare(
      `INSERT INTO GlobalLeaderboard (boat_id, total_points_global)
       VALUES (?, ?)
       ON CONFLICT(boat_id) DO UPDATE SET total_points_global = total_points_global + excluded.total_points_global`,
    );
    const pointsMap = new Map<number, any[]>();
    const temporaryTable = calculateBoatScores(results, event_id, pointsMap);
    // Update the leaderboard with the sorted results
    temporaryTable.forEach((boat) => {
      updateQuery.run(boat.boat_id, boat.totalPoints);
    });

    console.log('Global leaderboard updated successfully.');
    return { success: true };
  } catch (error) {
    console.error('Error updating global leaderboard:', error);
    throw error;
  }
});

ipcMain.handle('deleteScore', async (event, score_id) => {
  try {
    const result = db
      .prepare('DELETE FROM Scores WHERE score_id = ?')
      .run(score_id);
    return { changes: result.changes };
  } catch (error) {
    console.error('Error deleting score:', error);
    throw error;
  }
});

ipcMain.handle(
  'startFinalSeriesAtomic',
  async (
    _event,
    event_id,
    allow_oversize_confirm = false,
    apply_shrs43_temporary_second_discard = true,
  ) => {
    try {
      const allHeats = db
        .prepare(
          'SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?',
        )
        .all(event_id) as {
        heat_id: number;
        heat_name: string;
        heat_type: string;
      }[];

      const finalHeats = allHeats.filter((heat) => heat.heat_type === 'Final');
      if (finalHeats.length > 0) {
        throw new Error(
          'Final series has already been started for this event.',
        );
      }

      const qualifyingHeats = allHeats.filter(
        (heat) => heat.heat_type === 'Qualifying',
      );

      const uniqueGroups = new Set(
        qualifyingHeats
          .map((heat) => {
            const m = heat.heat_name.match(/Heat ([A-Z])/);
            return m ? m[1] : null;
          })
          .filter(Boolean),
      );
      const numFinalHeats = uniqueGroups.size;

      if (numFinalHeats < 2) {
        throw new Error(
          'With fewer than 2 qualifying groups, final series cannot be started.',
        );
      }

      const latestQualifyingHeats = findLatestHeatsBySuffix(
        qualifyingHeats.map((heat) => ({
          heat_name: heat.heat_name,
          heat_id: heat.heat_id,
        })),
      );

      const raceCounts = latestQualifyingHeats.map((heat) =>
        getRaceCountForHeat(heat.heat_id),
      );
      const uniqueRaceCounts = [...new Set(raceCounts)];
      if (uniqueRaceCounts.length > 1) {
        throw new Error(
          'Cannot start final series because latest qualifying heats have different race counts.',
        );
      }

      // Repair any missing score rows as DNS first so boats without scores
      // are ranked last instead of being dropped by the leaderboard join.
      ensureCompleteRaceScoresForEvent(event_id, 'Qualifying');

      const leaderboard = db
        .prepare(
          `SELECT
          lb.boat_id,
          GROUP_CONCAT(sc.points ORDER BY r.race_number, r.race_id) AS race_points,
          GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number, r.race_id) AS race_statuses
        FROM Leaderboard lb
        LEFT JOIN Scores sc ON sc.boat_id = lb.boat_id
        LEFT JOIN Races r ON sc.race_id = r.race_id
        LEFT JOIN Heats h ON r.heat_id = h.heat_id
        WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying'
          AND sc.race_id IS NOT NULL
        GROUP BY lb.boat_id
        ORDER BY lb.place ASC`,
        )
        .all(event_id, event_id) as Array<{
        boat_id: number;
        race_points: string | null;
        race_statuses: string | null;
      }>;

      if (leaderboard.length === 0) {
        throw new Error(
          'Cannot start final series without qualifying leaderboard data.',
        );
      }

      const qualifyingDiscardConfig = getEventDiscardConfig(
        event_id,
        'qualifying',
      );
      const adjustedLeaderboard = buildAdjustedFleetLeaderboard(
        leaderboard,
        qualifyingDiscardConfig,
        apply_shrs43_temporary_second_discard === true,
      );
      const withdrawnBoatIds = new Set(
        leaderboard
          .filter((boat) => {
            const statuses = boat.race_statuses
              ? boat.race_statuses.split(',')
              : [];
            return statuses.some((s) => s.trim().toUpperCase() === 'WTH');
          })
          .map((boat) => boat.boat_id),
      );

      adjustedLeaderboard.sort((left, right) => {
        const leftWithdrawn = withdrawnBoatIds.has(left.boat_id);
        const rightWithdrawn = withdrawnBoatIds.has(right.boat_id);
        if (leftWithdrawn !== rightWithdrawn) {
          return leftWithdrawn ? 1 : -1;
        }
        return left.totalPoints - right.totalPoints;
      });

      const overflowPolicy = getEventHeatOverflowPolicy(event_id);
      let finalHeatCount = numFinalHeats;
      if (
        adjustedLeaderboard.length >
        finalHeatCount * SHRS_MAX_BOATS_PER_HEAT
      ) {
        if (overflowPolicy === 'auto-increase') {
          finalHeatCount = Math.ceil(
            adjustedLeaderboard.length / SHRS_MAX_BOATS_PER_HEAT,
          );
        } else if (!allow_oversize_confirm) {
          throw new Error(
            `Final fleets would exceed ${SHRS_MAX_BOATS_PER_HEAT} boats. Confirm oversize to continue or switch event policy to auto-increase heats.`,
          );
        }
      }

      const boatsPerFleet = Math.floor(
        adjustedLeaderboard.length / finalHeatCount,
      );
      const extraBoats = adjustedLeaderboard.length % finalHeatCount;
      const fleetNames = ['Gold', 'Silver', 'Bronze', 'Copper'];

      const transaction = db.transaction(() => {
        const insertedFinalHeatIds: number[] = [];
        for (let i = 0; i < finalHeatCount; i += 1) {
          const fleetName = fleetNames[i] || `Fleet ${i + 1}`;
          const insertResult = db
            .prepare(
              'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
            )
            .run(event_id, `Final ${fleetName}`, 'Final');
          insertedFinalHeatIds.push(Number(insertResult.lastInsertRowid));
        }

        let boatIndex = 0;
        for (let i = 0; i < insertedFinalHeatIds.length; i += 1) {
          const boatsInFleet = boatsPerFleet + (i < extraBoats ? 1 : 0);
          const fleetSlice = adjustedLeaderboard.slice(
            boatIndex,
            boatIndex + boatsInFleet,
          );
          boatIndex += boatsInFleet;

          fleetSlice.forEach((boat) => {
            db.prepare(
              'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
            ).run(insertedFinalHeatIds[i], boat.boat_id);
          });
        }

        return {
          success: true,
          createdHeats: insertedFinalHeatIds.length,
          assignedBoats: adjustedLeaderboard.length,
          overflowPolicy,
        };
      });

      return transaction();
    } catch (error) {
      console.error('Error starting final series atomically:', error);
      throw error;
    }
  },
);

ipcMain.handle('createNewHeatsBasedOnLeaderboard', async (event, event_id) => {
  try {
    const latestHeats = getLatestQualifyingHeats(event_id);
    checkRaceCountForLatestHeats(latestHeats, db);
    const raceRows = getLatestRaceRowsForHeats(latestHeats);

    const sortedLatestHeats = [...latestHeats].sort((left, right) =>
      getHeatBaseFromName(left.heat_name).localeCompare(
        getHeatBaseFromName(right.heat_name),
      ),
    );
    const heatIndexById = new Map<number, number>();
    sortedLatestHeats.forEach((heat, index) => {
      heatIndexById.set(heat.heat_id, index);
    });

    const raceByHeatId = new Map<
      number,
      { race_id: number; race_number: number }
    >();
    raceRows.forEach((row) => {
      raceByHeatId.set(row.heat_id, {
        race_id: row.race_id,
        race_number: row.race_number,
      });
    });

    // Define the new race number
    const heatNameMatch = sortedLatestHeats[0].heat_name.match(/(\d+)$/);
    const lastRaceNumber = heatNameMatch ? parseInt(heatNameMatch[1], 10) : 0;
    const raceNumber = lastRaceNumber + 1;
    console.log(raceNumber);
    // Generate names for the next round of heats
    const nextHeatNames = generateNextHeatNames(sortedLatestHeats);

    // Insert new heats into the database
    const heatIds: any[] = [];
    for (let i = 0; i < nextHeatNames.length; i += 1) {
      const heatName = nextHeatNames[i];
      const heatType = 'Qualifying';

      const { lastInsertRowid: newHeatId } = db
        .prepare(
          'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
        )
        .run(event_id, heatName, heatType);

      heatIds.push(newHeatId);
    }

    // Assign boats to new heats
    const assignmentMode = getEventQualifyingAssignmentMode(event_id);
    const assignments: { heatId: number; boatId: string }[] = [];
    if (assignmentMode === 'pre-assigned') {
      sortedLatestHeats.forEach((heat) => {
        const sourceIndex = heatIndexById.get(heat.heat_id);
        if (sourceIndex === undefined) {
          return;
        }

        const boatsInHeat = db
          .prepare(
            `SELECT hb.boat_id
             FROM Heat_Boat hb
             JOIN Boats b ON b.boat_id = hb.boat_id
             WHERE hb.heat_id = ?
             ORDER BY b.country ASC, b.sail_number ASC, hb.boat_id ASC`,
          )
          .all(heat.heat_id) as { boat_id: string }[];

        boatsInHeat.forEach((boat) => {
          assignments.push({ heatId: sourceIndex, boatId: boat.boat_id });
        });
      });
    } else {
      sortedLatestHeats.forEach((heat) => {
        const sourceIndex = heatIndexById.get(heat.heat_id);
        const raceForHeat = raceByHeatId.get(heat.heat_id);
        if (sourceIndex === undefined || !raceForHeat) {
          return;
        }

        const rankedBoats = getAssignmentRowsForHeatRace(
          heat.heat_id,
          raceForHeat.race_id,
        );
        rankedBoats.forEach((boat, rankIndex) => {
          const targetHeatIndex = getNextHeatIndexByMovementTable(
            sourceIndex,
            rankIndex + 1,
            sortedLatestHeats.length,
          );
          assignments.push({ heatId: targetHeatIndex, boatId: boat.boat_id });
        });
      });
    }
    if (assignments.length === 0) {
      const leaderboardResults = getSeedingResultsFromLastRace(
        event_id,
        sortedLatestHeats,
      );
      const fallbackAssignments = assignBoatsToNewHeatsZigZag(
        leaderboardResults,
        nextHeatNames,
        raceNumber,
      );
      fallbackAssignments.forEach((assignment) => assignments.push(assignment));
    }

    assignments.forEach(({ heatId, boatId }) => {
      db.prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)').run(
        heatIds[heatId],
        boatId,
      );
    });

    const advisory = getOddEvenMovementAdvisory(
      sortedLatestHeats.length,
      assignments.length,
    );

    if (advisory) {
      console.warn(advisory);
      return { success: true, advisory };
    }

    console.log('New heats created based on leaderboard.');
    return { success: true };
  } catch (error) {
    console.error(
      'Error creating new heats based on leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle('undoLastScoredRaceForHeat', async (event, heat_id) => {
  try {
    const heatRow = db
      .prepare(
        'SELECT h.heat_id, h.heat_name, h.event_id FROM Heats h WHERE h.heat_id = ?',
      )
      .get(heat_id) as
      | { heat_id: number; heat_name: string; event_id: number }
      | undefined;

    if (!heatRow) {
      throw new Error('Heat not found.');
    }

    const lastRace = db
      .prepare(
        `SELECT race_id, race_number
         FROM Races
         WHERE heat_id = ?
         ORDER BY race_number DESC, race_id DESC
         LIMIT 1`,
      )
      .get(heat_id) as { race_id: number; race_number: number } | undefined;

    if (!lastRace) {
      throw new Error(
        `No scored races found for heat "${heatRow.heat_name}". There is nothing to undo.`,
      );
    }

    const deleteScores = db.prepare('DELETE FROM Scores WHERE race_id = ?');
    const deleteRace = db.prepare('DELETE FROM Races  WHERE race_id = ?');

    const transaction = db.transaction(() => {
      const removedScores = deleteScores.run(lastRace.race_id).changes;
      deleteRace.run(lastRace.race_id);
      return removedScores;
    });

    const removedScores = transaction();
    clearAssignmentSnapshot(lastRace.race_id);
    recomputeEventLeaderboard(heatRow.event_id);

    return {
      success: true,
      heatName: heatRow.heat_name,
      raceNumber: lastRace.race_number,
      removedScores,
    };
  } catch (error) {
    console.error(
      'Error undoing last scored race for heat:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle('undoLastScoredRace', async (event, event_id) => {
  try {
    const latestHeats = getLatestQualifyingHeats(event_id);
    checkRaceCountForLatestHeats(latestHeats, db);

    const latestRaceByHeatQuery = db.prepare(
      `SELECT race_id, race_number
       FROM Races
       WHERE heat_id = ?
       ORDER BY race_number DESC, race_id DESC
       LIMIT 1`,
    );

    const raceRows = latestHeats.map((heat) => {
      const row = latestRaceByHeatQuery.get(heat.heat_id);
      if (!row) {
        throw new Error('No scored race found to undo.');
      }
      return row;
    });

    const raceNumbers = [...new Set(raceRows.map((row) => row.race_number))];
    if (raceNumbers.length > 1) {
      throw new Error(
        'Latest qualifying heats are not aligned on the same race number.',
      );
    }

    const raceIds = raceRows.map((row) => row.race_id);
    const deleteScoresByRace = db.prepare(
      'DELETE FROM Scores WHERE race_id = ?',
    );
    const deleteRaceById = db.prepare('DELETE FROM Races WHERE race_id = ?');

    const transaction = db.transaction(() => {
      let removedScores = 0;
      let removedRaces = 0;

      raceIds.forEach((raceId) => {
        removedScores += deleteScoresByRace.run(raceId).changes;
        removedRaces += deleteRaceById.run(raceId).changes;
      });

      return { removedScores, removedRaces };
    });

    const result = transaction();
    raceIds.forEach((raceId) => clearAssignmentSnapshot(raceId));
    recomputeEventLeaderboard(event_id);

    return {
      success: true,
      raceNumber: raceNumbers[0],
      removedScores: result.removedScores,
      removedRaces: result.removedRaces,
    };
  } catch (error) {
    console.error('Error undoing last scored race:', (error as Error).message);
    throw error;
  }
});

ipcMain.handle('undoLatestHeatRedistribution', async (event, event_id) => {
  try {
    const latestHeats = getLatestQualifyingHeats(event_id);
    const hasRaceQuery = db.prepare(
      'SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?',
    );

    const heatsWithRaces = latestHeats.filter(
      (heat) => hasRaceQuery.get(heat.heat_id).race_count > 0,
    );

    if (heatsWithRaces.length > 0) {
      throw new Error(
        'Cannot undo heat redistribution because the latest heats already contain races. Undo the last race first.',
      );
    }

    const deleteHeatBoatQuery = db.prepare(
      'DELETE FROM Heat_Boat WHERE heat_id = ?',
    );
    const deleteHeatQuery = db.prepare('DELETE FROM Heats WHERE heat_id = ?');

    const transaction = db.transaction(() => {
      let removedAssignments = 0;
      let removedHeats = 0;

      latestHeats.forEach((heat) => {
        removedAssignments += deleteHeatBoatQuery.run(heat.heat_id).changes;
        removedHeats += deleteHeatQuery.run(heat.heat_id).changes;
      });

      return { removedAssignments, removedHeats };
    });

    const result = transaction();
    return {
      success: true,
      removedAssignments: result.removedAssignments,
      removedHeats: result.removedHeats,
      removedHeatNames: latestHeats.map((heat) => heat.heat_name),
    };
  } catch (error) {
    console.error(
      'Error undoing latest heat redistribution:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle(
  'transferBoatBetweenHeats',
  async (event, from_heat_id, to_heat_id, boat_id) => {
    try {
      const deleteQuery = db.prepare(
        'DELETE FROM Heat_Boat WHERE heat_id = ? AND boat_id = ?',
      );
      const deleteInfo = deleteQuery.run(from_heat_id, boat_id);
      console.log(
        `Deleted ${deleteInfo.changes} row(s) from HeatBoats for heat ID ${from_heat_id} and boat ID ${boat_id}.`,
      );

      const insertQuery = db.prepare(
        'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
      );
      const insertInfo = insertQuery.run(to_heat_id, boat_id);
      console.log(
        `Inserted ${insertInfo.changes} row(s) with last ID ${insertInfo.lastInsertRowid} into HeatBoats for heat ID ${to_heat_id}.`,
      );

      return { success: true };
    } catch (error) {
      console.error('Error transferring boat between heats:', error);
      throw error;
    }
  },
);

ipcMain.handle(
  'updateRaceResult',
  async (
    event,
    event_id,
    race_id,
    boat_id,
    new_position,
    shift_positions,
    new_status,
  ) => {
    try {
      applyRaceResultUpdate(
        event_id,
        race_id,
        boat_id,
        new_position,
        Boolean(shift_positions),
        new_status,
      );
      lockDiscardProfileForRace(Number(race_id));
      recomputeEventLeaderboard(event_id);

      return { success: true };
    } catch (err) {
      console.error('Error updating race result:', (err as Error).message);
      throw err;
    }
  },
);

ipcMain.handle(
  'saveLeaderboardRaceResultsAtomic',
  async (
    _event,
    event_id,
    operations,
    shift_positions,
    updateFinalLeaderboard = false,
  ) => {
    try {
      const safeOperations = Array.isArray(operations) ? operations : [];
      const tx = db.transaction(() => {
        safeOperations.forEach((operation) => {
          applyRaceResultUpdate(
            event_id,
            operation.raceId,
            operation.boatId,
            operation.newPosition,
            Boolean(shift_positions),
            operation.entryStatus,
          );
          lockDiscardProfileForRace(Number(operation.raceId));
        });

        recomputeEventLeaderboard(event_id);
        if (updateFinalLeaderboard) {
          recomputeFinalLeaderboard(event_id);
        }
      });

      tx();
      return { success: true, updatedCount: safeOperations.length };
    } catch (error) {
      console.error(
        'Error saving leaderboard race results atomically:',
        (error as Error).message,
      );
      throw error;
    }
  },
);

ipcMain.handle('readLeaderboard', async (event, event_id) => {
  try {
    const repairedRows = ensureCompleteRaceScoresForEvent(
      event_id,
      'Qualifying',
    );
    if (repairedRows > 0) {
      recomputeEventLeaderboard(event_id);
    }

    const query =
      'SELECT ' +
      'lb.boat_id, ' +
      'lb.total_points_event, ' +
      'lb.place, ' +
      'b.sail_number AS boat_number, ' +
      'b.model AS boat_type, ' +
      's.name, ' +
      's.surname, ' +
      'b.country, ' +
      'GROUP_CONCAT(sc.position ORDER BY r.race_number, r.race_id) AS race_positions, ' +
      'GROUP_CONCAT(sc.points ORDER BY r.race_number, r.race_id) AS race_points, ' +
      'GROUP_CONCAT(r.race_id ORDER BY r.race_number, r.race_id) AS race_ids, ' +
      "GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number, r.race_id) AS race_statuses " +
      'FROM Leaderboard lb ' +
      'LEFT JOIN Boats b ON lb.boat_id = b.boat_id ' +
      'LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id ' +
      'LEFT JOIN Scores sc ON sc.boat_id = b.boat_id ' +
      'LEFT JOIN Races r ON sc.race_id = r.race_id ' +
      'LEFT JOIN Heats h ON r.heat_id = h.heat_id ' +
      "WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying' " +
      'AND sc.race_id IS NOT NULL ' +
      'GROUP BY lb.boat_id ' +
      'ORDER BY lb.place ASC';
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id, event_id);
    console.log(
      `[IPC -> Renderer] readLeaderboard (event_id=${event_id}): ${
        results.length
      } entries`,
    );
    return results;
  } catch (error) {
    console.error('Error reading leaderboard:', error);
    throw error;
  }
});
ipcMain.handle('readGlobalLeaderboard', async () => {
  try {
    const results = db
      .prepare(
        `
        SELECT
          gl.boat_id,
          gl.total_points_global,
          b.sail_number AS boat_number,
          b.model AS boat_type,
          s.name,
          s.surname,
          b.country
        FROM GlobalLeaderboard gl
        LEFT JOIN Boats b ON gl.boat_id = b.boat_id
        LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
        ORDER BY gl.total_points_global ASC
      `,
      )
      .all();
    return results;
  } catch (error) {
    console.error('Error reading global leaderboard:', error);
    throw error;
  }
});

ipcMain.handle('updateFinalLeaderboard', async (event, event_id) => {
  try {
    recomputeFinalLeaderboard(event_id);
    console.log('Final leaderboard updated successfully.');
    return { success: true };
  } catch (error) {
    console.error(
      'Error updating final leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle('readFinalLeaderboard', async (event, event_id) => {
  try {
    const repairedRows = ensureCompleteRaceScoresForEvent(event_id, 'Final');
    if (repairedRows > 0) {
      recomputeFinalLeaderboard(event_id);
    }

    const query =
      'SELECT ' +
      'fl.boat_id, ' +
      'fl.total_points_final, ' +
      'fl.event_id, ' +
      'fl.placement_group, ' +
      'b.sail_number AS boat_number, ' +
      'b.model AS boat_type, ' +
      's.name, ' +
      's.surname, ' +
      'b.country, ' +
      'GROUP_CONCAT(sc.position ORDER BY r.race_number, r.race_id) AS race_positions, ' +
      'GROUP_CONCAT(sc.points ORDER BY r.race_number, r.race_id) AS race_points, ' +
      'GROUP_CONCAT(r.race_id ORDER BY r.race_number, r.race_id) AS race_ids, ' +
      "GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number, r.race_id) AS race_statuses " +
      'FROM FinalLeaderboard fl ' +
      'LEFT JOIN Boats b ON fl.boat_id = b.boat_id ' +
      'LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id ' +
      'LEFT JOIN Scores sc ON sc.boat_id = b.boat_id ' +
      'LEFT JOIN Races r ON sc.race_id = r.race_id ' +
      'LEFT JOIN Heats h ON r.heat_id = h.heat_id ' +
      "WHERE fl.event_id = ? AND h.event_id = ? AND h.heat_type = 'Final' " +
      'AND sc.race_id IS NOT NULL ' +
      'GROUP BY fl.boat_id ' +
      'ORDER BY CASE fl.placement_group ' +
      "WHEN 'Gold' THEN 1 " +
      "WHEN 'Silver' THEN 2 " +
      "WHEN 'Bronze' THEN 3 " +
      "WHEN 'Copper' THEN 4 " +
      'ELSE 5 END, ' +
      'fl.total_points_final ASC';
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id, event_id);
    const entrySuffix = results.length === 1 ? 'y' : 'ies';
    console.log(
      `[IPC -> Renderer] readFinalLeaderboard (event_id=${event_id}): sending ${
        results.length
      } entr${entrySuffix} to frontend`,
      results,
    );
    return results;
  } catch (error) {
    console.error('Error reading final leaderboard:', error);
    throw error;
  }
});

/**
 * SHRS 5.4: A boat's overall series score = qualifying series score + final series score.
 * Gold fleet boats rank before Silver, Silver before Bronze, etc.
 * SHRS 1.5: If no races are completed in the Final Series, boats are ranked
 * according to their series score in the Qualifying Series.
 */
ipcMain.handle('readOverallLeaderboard', async (event, event_id) => {
  try {
    const completedFinalRaceCount = db
      .prepare(
        `SELECT COUNT(*) as cnt
       FROM Races r
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ?
         AND h.heat_type = 'Final'
         AND NOT EXISTS (
           SELECT 1
           FROM Heat_Boat hb
           WHERE hb.heat_id = h.heat_id
             AND NOT EXISTS (
               SELECT 1
               FROM Scores s
               WHERE s.race_id = r.race_id AND s.boat_id = hb.boat_id
             )
         )`,
      )
      .get(event_id) as { cnt: number };

    // SHRS 1.5: If no completed final races, rank by qualifying only.
    if (!completedFinalRaceCount || completedFinalRaceCount.cnt === 0) {
      const qualifyingResults = db
        .prepare(
          `SELECT
          lb.boat_id,
          lb.total_points_event AS overall_points,
          lb.place,
          'Qualifying' AS placement_group,
          b.sail_number AS boat_number,
          b.model AS boat_type,
          s.name,
          s.surname,
          b.country
        FROM Leaderboard lb
        LEFT JOIN Boats b ON lb.boat_id = b.boat_id
        LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
        WHERE lb.event_id = ?
        ORDER BY lb.place ASC`,
        )
        .all(event_id);
      return qualifyingResults;
    }

    // Combined overall series: qualifying score + final score
    const fleetOrder = `CASE fl.placement_group
      WHEN 'Gold' THEN 1
      WHEN 'Silver' THEN 2
      WHEN 'Bronze' THEN 3
      WHEN 'Copper' THEN 4
      ELSE 5
    END`;

    const overallQuery = db.prepare(
      `SELECT
        fl.boat_id,
        COALESCE(lb.total_points_event, 0) AS qualifying_points,
        fl.total_points_final AS final_points,
        COALESCE(lb.total_points_event, 0) + fl.total_points_final AS overall_points,
        fl.placement_group,
        fl.place AS final_place,
        b.sail_number AS boat_number,
        b.model AS boat_type,
        s.name,
        s.surname,
        b.country
      FROM FinalLeaderboard fl
      LEFT JOIN Leaderboard lb ON fl.boat_id = lb.boat_id AND lb.event_id = fl.event_id
      LEFT JOIN Boats b ON fl.boat_id = b.boat_id
      LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
      WHERE fl.event_id = ?
      ORDER BY ${fleetOrder}, overall_points ASC, fl.place ASC`,
    );

    const results = overallQuery.all(event_id);

    const tiePacketCache = new Map<any, OverallTiePacket>();
    const getTiePacket = (boatId: any) => {
      if (!tiePacketCache.has(boatId)) {
        tiePacketCache.set(boatId, buildOverallTiePacket(event_id, boatId));
      }
      return tiePacketCache.get(boatId) as OverallTiePacket;
    };

    const fleetRanks: Record<string, number> = {
      Gold: 1,
      Silver: 2,
      Bronze: 3,
      Copper: 4,
    };
    results.sort((left: any, right: any) => {
      const leftFleetRank = fleetRanks[left.placement_group] ?? 999;
      const rightFleetRank = fleetRanks[right.placement_group] ?? 999;
      if (leftFleetRank !== rightFleetRank) {
        return leftFleetRank - rightFleetRank;
      }

      if (left.overall_points !== right.overall_points) {
        return left.overall_points - right.overall_points;
      }

      return 0;
    });

    const groupedAndResolved: any[] = [];
    for (let i = 0; i < results.length; ) {
      const fleet = results[i].placement_group;
      const points = results[i].overall_points;
      const tieGroup: any[] = [];

      while (
        i < results.length &&
        results[i].placement_group === fleet &&
        results[i].overall_points === points
      ) {
        tieGroup.push(results[i]);
        i += 1;
      }

      if (tieGroup.length <= 1) {
        groupedAndResolved.push(...tieGroup);
      } else {
        groupedAndResolved.push(
          ...resolveOverallTieGroupSequentially(tieGroup, getTiePacket),
        );
      }
    }

    results.splice(0, results.length, ...groupedAndResolved);

    // Assign overall rank: Gold before Silver before Bronze before Copper
    let rank = 1;
    results.forEach((row: any) => {
      row.overall_rank = rank;
      rank += 1;
    });

    console.log(
      `[IPC -> Renderer] readOverallLeaderboard (event_id=${event_id}): ${
        results.length
      } entries`,
    );
    return results;
  } catch (error) {
    console.error(
      'Error reading overall leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});
