/* eslint-disable camelcase */
import { ipcMain } from 'electron';
import { db } from '../../../public/Database/DBManager';
import calculateBoatScores from '../functions/calculateBoatScores';

import {
  assignBoatsToNewHeatsZigZag,
  checkRaceCountForLatestHeats,
  findLatestHeatsBySuffix,
  generateNextHeatNames,
  getNextHeatIndexByMovementTable,
} from '../functions/creatingNewHeatsUtls';
import calculateFinalBoatScores from '../functions/calculateFinalBoatScores';

console.log('HeatRaceHandler.ts loaded');

const isEventLocked = (event_id: any) => {
  const query = `SELECT is_locked FROM Events WHERE event_id = ?`;
  const checkQuery = db.prepare(query);
  const result = checkQuery.get(event_id);
  return result.is_locked === 1;
};

const statusOrder = [
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNS',
  'DNC',
  'WTH',
  'UFD',
  'BFD',
  'DSQ',
  'DNE',
];

const statusRankMap = new Map<string, number>(
  statusOrder.map((status, index) => [status, index]),
);

function normalizeStatus(status: unknown): string {
  if (typeof status !== 'string') {
    return '';
  }
  return status.trim().toUpperCase();
}

function buildAlphanumericKey(country: unknown, sail_number: unknown): string {
  const countryCode = String(country ?? '').toUpperCase();
  const sail = String(sail_number ?? '').toUpperCase();
  return `${countryCode}-${sail}`;
}

function getHeatBaseFromName(heat_name: string): string {
  const match = heat_name.match(/Heat\s+([A-Z]+)/);
  if (!match) {
    throw new Error(`Invalid heat name format: ${heat_name}`);
  }
  return match[1];
}

function getLatestQualifyingHeats(event_id: any) {
  const existingHeatsQuery = db.prepare(
    `SELECT heat_name, heat_id FROM Heats WHERE event_id = ? AND heat_type = 'Qualifying'`,
  );
  const existingHeats = existingHeatsQuery.all(event_id);
  const latestHeats = findLatestHeatsBySuffix(existingHeats);
  if (latestHeats.length === 0) {
    throw new Error('No qualifying heats found for this event.');
  }
  return latestHeats;
}

function getRaceCountForHeat(heat_id: number): number {
  const raceCountQuery = db.prepare(
    `SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?`,
  );
  return raceCountQuery.get(heat_id).race_count;
}

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
    throw new Error('Latest qualifying heats are not aligned on the same race number.');
  }

  return raceRows;
}

function recomputeEventLeaderboard(event_id: any) {
  db.prepare('DELETE FROM Leaderboard WHERE event_id = ?').run(event_id);

  const query = `
    SELECT boat_id, SUM(points) as total_points_event, COUNT(DISTINCT Races.race_id) as number_of_races
    FROM Scores
    JOIN Races ON Scores.race_id = Races.race_id
    JOIN Heats ON Races.heat_id = Heats.heat_id
    WHERE Heats.event_id = ? AND Heats.heat_type = 'Qualifying'
    GROUP BY boat_id
    ORDER BY total_points_event ASC
  `;
  const readQuery = db.prepare(query);
  const results = readQuery.all(event_id);
  if (results.length === 0) {
    return;
  }

  const updateQuery = db.prepare(
    `INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(boat_id, event_id) DO UPDATE SET total_points_event = excluded.total_points_event, place = excluded.place`,
  );

  const pointsMap = new Map<number, any[]>();
  const temporaryTable = calculateBoatScores(results, event_id, pointsMap);
  temporaryTable.forEach((boat) => {
    updateQuery.run(boat.boat_id, boat.totalPoints, event_id, boat.place);
  });
}

/**
 * SHRS 5.2: Get the number of boats in the largest heat for an event.
 * Used for penalty scoring (DNS, DSQ, RET, etc. = largest heat size + 1).
 */
function getMaxHeatSize(event_id: any, heat_type?: string): number {
  const heatTypeFilter = heat_type
    ? `AND h.heat_type = ?`
    : '';
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
    ? (db.prepare(sql).get(event_id, heat_type) as { max_boats: number | null } | undefined)
    : (db.prepare(sql).get(event_id) as { max_boats: number | null } | undefined);
  return row?.max_boats ?? 0;
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

  seedingRows.sort((left, right) => {
    const leftStatusRank = statusRankMap.get(left.status);
    const rightStatusRank = statusRankMap.get(right.status);
    const leftIsFinisher = leftStatusRank === undefined;
    const rightIsFinisher = rightStatusRank === undefined;

    if (leftIsFinisher && rightIsFinisher) {
      const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
      if (leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
      }
    } else if (leftIsFinisher !== rightIsFinisher) {
      return leftIsFinisher ? -1 : 1;
    } else {
      const leftRank = leftStatusRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rightStatusRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
    }

    return buildAlphanumericKey(left.country, left.sail_number).localeCompare(
      buildAlphanumericKey(right.country, right.sail_number),
    );
  });

  return seedingRows.map((row) => ({ boat_id: row.boat_id }));
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

  rows.sort((left, right) => {
    const leftStatusRank = statusRankMap.get(left.status);
    const rightStatusRank = statusRankMap.get(right.status);
    const leftIsFinisher = leftStatusRank === undefined;
    const rightIsFinisher = rightStatusRank === undefined;

    if (leftIsFinisher && rightIsFinisher) {
      const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
      if (leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
      }
    } else if (leftIsFinisher !== rightIsFinisher) {
      return leftIsFinisher ? -1 : 1;
    } else {
      const leftRank = leftStatusRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rightStatusRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
    }

    return buildAlphanumericKey(left.country, left.sail_number).localeCompare(
      buildAlphanumericKey(right.country, right.sail_number),
    );
  });

  return rows;
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

ipcMain.handle('insertHeat', async (event, event_id, heat_name, heat_type) => {
  if (isEventLocked(event_id)) {
    throw new Error('Cannot insert heat for locked event.');
  }
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
    const result = db
      .prepare('INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')
      .run(heat_id, boat_id);
  } catch (error) {
    console.error('Error inserting heat boat:', error);
    throw error;
  }
});
ipcMain.handle('deleteHeatsByEvent', async (event, event_id) => {
  if (isEventLocked(event_id)) {
    throw new Error('Cannot insert heat for locked event.');
  }
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
        SELECT b.boat_id, b.sail_number, b.country, b.model, s.name, s.surname
        FROM Heat_Boat hb
        JOIN Boats b ON hb.boat_id = b.boat_id
        JOIN Sailors s ON b.sailor_id = s.sailor_id
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
    const result = db
      .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
      .run(heat_id, race_number);
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
      const result = db
        .prepare(
          'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(race_id, boat_id, position, points, status);
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

ipcMain.handle(
  'updateScore',
  async (event, score_id, position, points, status) => {
    try {
      const result = db
        .prepare(
          'UPDATE Scores SET position = ?, points = ?, status = ? WHERE score_id = ?',
        )
        .run(position, points, status, score_id);
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
  if (isEventLocked(event_id)) {
    throw new Error('Cannot insert heat for locked event.');
  }
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

ipcMain.handle('createNewHeatsBasedOnLeaderboard', async (event, event_id) => {
  if (isEventLocked(event_id)) {
    throw new Error('Cannot insert heat for locked event.');
  }
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

    const raceByHeatId = new Map<number, { race_id: number; race_number: number }>();
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
    const assignments: { heatId: number; boatId: string }[] = [];
    sortedLatestHeats.forEach((heat) => {
      const sourceIndex = heatIndexById.get(heat.heat_id);
      const raceForHeat = raceByHeatId.get(heat.heat_id);
      if (sourceIndex === undefined || !raceForHeat) {
        return;
      }

      const rankedBoats = getRankedBoatsInHeatForRace(
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
      .prepare('SELECT h.heat_id, h.heat_name, h.event_id FROM Heats h WHERE h.heat_id = ?')
      .get(heat_id) as { heat_id: number; heat_name: string; event_id: number } | undefined;

    if (!heatRow) {
      throw new Error('Heat not found.');
    }

    if (isEventLocked(heatRow.event_id)) {
      throw new Error('Cannot undo a race for a locked event.');
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
      throw new Error(`No scored races found for heat "${heatRow.heat_name}". There is nothing to undo.`);
    }

    const deleteScores = db.prepare('DELETE FROM Scores WHERE race_id = ?');
    const deleteRace   = db.prepare('DELETE FROM Races  WHERE race_id = ?');

    const transaction = db.transaction(() => {
      const removedScores = deleteScores.run(lastRace.race_id).changes;
      deleteRace.run(lastRace.race_id);
      return removedScores;
    });

    const removedScores = transaction();
    recomputeEventLeaderboard(heatRow.event_id);

    return {
      success: true,
      heatName: heatRow.heat_name,
      raceNumber: lastRace.race_number,
      removedScores,
    };
  } catch (error) {
    console.error('Error undoing last scored race for heat:', (error as Error).message);
    throw error;
  }
});

ipcMain.handle('undoLastScoredRace', async (event, event_id) => {
  if (isEventLocked(event_id)) {
    throw new Error('Cannot undo race for locked event.');
  }

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
  if (isEventLocked(event_id)) {
    throw new Error('Cannot undo heat redistribution for locked event.');
  }

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
  async (event, event_id, race_id, boat_id, new_position, shift_positions, new_status) => {
    try {
      const status = typeof new_status === 'string' && new_status.trim() !== '' && new_status.trim() !== 'FINISHED'
        ? new_status.trim().toUpperCase()
        : 'FINISHED';

      const rdgStatuses = ['RDG1', 'RDG2', 'RDG3'];
      const isRdg = rdgStatuses.includes(status);

      // For penalty statuses use largest-heat size + 1 per SHRS 5.2;
      // RDG statuses keep the pre-computed average/manual value from the frontend
      let finalPosition = Number(new_position);
      if (status !== 'FINISHED' && !isRdg) {
        // Determine the heat type for this race
        const heatRow = db
          .prepare(
            `SELECT h.heat_type FROM Heats h
             JOIN Races r ON r.heat_id = h.heat_id
             WHERE r.race_id = ?`,
          )
          .get(race_id) as { heat_type: string } | undefined;
        const heatType = heatRow?.heat_type ?? 'Qualifying';
        const maxBoats = getMaxHeatSize(event_id, heatType);
        finalPosition = maxBoats + 1;
      }
      const points = finalPosition;

      // Step 1: Get the current position for shift logic
      const currentResult = db
        .prepare(`SELECT position FROM Scores WHERE race_id = ? AND boat_id = ?`)
        .get(race_id, boat_id) as { position: number } | undefined;

      if (!currentResult) {
        throw new Error(`Current result not found for race_id: ${race_id}, boat_id: ${boat_id}`);
      }
      const currentPosition = currentResult.position;

      // Step 2: Update position, points and status
      db.prepare(`UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?`)
        .run(finalPosition, points, status, race_id, boat_id);

      // Step 3: Optionally shift other finishers
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

      // Step 4: Recompute event leaderboard with correct exclusion logic
      recomputeEventLeaderboard(event_id);

      return { success: true };
    } catch (err) {
      console.error('Error updating race result:', (err as Error).message);
      throw err;
    }
  },
);

ipcMain.handle('readLeaderboard', async (event, event_id) => {
  try {
    const query = `
      SELECT
        lb.boat_id,
        lb.total_points_event,
        lb.place,
        b.sail_number AS boat_number,
        b.model AS boat_type,
        s.name,
        s.surname,
        b.country,
        GROUP_CONCAT(sc.position ORDER BY r.race_number) AS race_positions,
        GROUP_CONCAT(r.race_id ORDER BY r.race_number) AS race_ids,
        GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number) AS race_statuses
      FROM Leaderboard lb
      LEFT JOIN Boats b ON lb.boat_id = b.boat_id
      LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
      LEFT JOIN Scores sc ON sc.boat_id = b.boat_id
      LEFT JOIN Races r ON sc.race_id = r.race_id
      LEFT JOIN Heats h ON r.heat_id = h.heat_id
      WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying'
        AND sc.race_id IS NOT NULL
      GROUP BY lb.boat_id
      ORDER BY lb.place ASC
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id, event_id);
    console.log(`[IPC → Renderer] readLeaderboard (event_id=${event_id}): ${results.length} entries`);
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
  if (isEventLocked(event_id)) {
    throw new Error('Cannot update final leaderboard for locked event.');
  }
  try {
    const query = `
      SELECT boat_id, heat_name, SUM(points) as total_points_final
      FROM Scores
      JOIN Races ON Scores.race_id = Races.race_id
      JOIN Heats ON Races.heat_id = Heats.heat_id
      WHERE Heats.event_id = ? AND Heats.heat_type = 'Final'
      GROUP BY boat_id, heat_name
      ORDER BY heat_name, total_points_final ASC
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id);

    const groupTables = calculateFinalBoatScores(results, event_id);

    const updateQuery = db.prepare(
      `INSERT INTO FinalLeaderboard (boat_id, total_points_final, event_id, placement_group, place)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(boat_id, event_id) DO UPDATE SET total_points_final = excluded.total_points_final, placement_group = excluded.placement_group,  place = excluded.place`,
    );

    groupTables.forEach((table, groupName) => {
      table.forEach((boat) => {
        updateQuery.run(
          boat.boat_id,
          boat.totalPoints,
          event_id,
          groupName,
          boat.place,
        );
      });
    });
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
    const query = `
      SELECT
        fl.boat_id,
        fl.total_points_final,
        fl.event_id,
        fl.placement_group,
        b.sail_number AS boat_number,
        b.model AS boat_type,
        s.name,
        s.surname,
        b.country,
        GROUP_CONCAT(sc.position ORDER BY r.race_number) AS race_positions,
        GROUP_CONCAT(r.race_id ORDER BY r.race_number) AS race_ids,
        GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number) AS race_statuses
      FROM FinalLeaderboard fl
      LEFT JOIN Boats b ON fl.boat_id = b.boat_id
      LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
      LEFT JOIN Scores sc ON sc.boat_id = b.boat_id
      LEFT JOIN Races r ON sc.race_id = r.race_id
      LEFT JOIN Heats h ON r.heat_id = h.heat_id
      WHERE fl.event_id = ? AND h.event_id = ? AND h.heat_type = 'Final'
        AND sc.race_id IS NOT NULL
      GROUP BY fl.boat_id
      ORDER BY
        CASE fl.placement_group
          WHEN 'Gold' THEN 1
          WHEN 'Silver' THEN 2
          WHEN 'Bronze' THEN 3
          WHEN 'Copper' THEN 4
          ELSE 5
        END,
        fl.total_points_final ASC
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id, event_id);
    console.log(
      `[IPC → Renderer] readFinalLeaderboard (event_id=${event_id}): sending ${results.length} entr${results.length === 1 ? 'y' : 'ies'} to frontend`,
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
    // Check whether any Final Series races exist
    const finalRaceCount = db.prepare(
      `SELECT COUNT(*) as cnt
       FROM Races r
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ? AND h.heat_type = 'Final'`,
    ).get(event_id) as { cnt: number };

    // SHRS 1.5: If no final races completed, fall back to qualifying standings
    if (!finalRaceCount || finalRaceCount.cnt === 0) {
      const qualifyingResults = db.prepare(
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
      ).all(event_id);
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

    // Assign overall rank: Gold before Silver before Bronze before Copper
    let rank = 1;
    results.forEach((row: any) => {
      row.overall_rank = rank;
      rank += 1;
    });

    console.log(`[IPC → Renderer] readOverallLeaderboard (event_id=${event_id}): ${results.length} entries`);
    return results;
  } catch (error) {
    console.error('Error reading overall leaderboard:', (error as Error).message);
    throw error;
  }
});
