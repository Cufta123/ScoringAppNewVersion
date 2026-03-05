/* eslint-disable prettier/prettier */
/* eslint-disable camelcase */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath =
  process.env.NODE_ENV === 'development'
    ? './data/scoring_app.db'
    : path.join(process.resourcesPath, './data/scoring_app.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const readAllHeats = (event_id) => {
  try {
    const query = `
      SELECT
        heat_id, event_id, heat_name, heat_type
      FROM Heats
      WHERE event_id = ?
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id);
    console.log('Raw results from readAllHeats:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading all heats from the database:', err.message);
    return [];
  }
};
const readBoatsByHeat = (heat_id) => {
  try {
    const query = `
      SELECT b.boat_id, b.sail_number, b.country, b.model, s.name, s.surname
      FROM HeatBoats hb
      JOIN Boats b ON hb.boat_id = b.boat_id
      JOIN Sailors s ON b.sailor_id = s.sailor_id
      WHERE hb.heat_id = ?
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(heat_id);
    console.log('Raw results from readBoatsByHeat:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading boats by heat from the database:', err.message);
    return [];
  }
};
const insertHeat = (event_id, heat_name, heat_type) => {
  try {
    const insertQuery = db.prepare(
      `INSERT INTO Heats (event_id, heat_name, heat_type)
       VALUES (?, ?, ?)`,
    );
    const info = insertQuery.run(event_id, heat_name, heat_type);
    console.log(
      `Inserted ${info.changes} row(s) with last ID ${info.lastInsertRowid} into Heats.`,
    );
    return { lastInsertRowid: info.lastInsertRowid };
  } catch (err) {
    console.error('Error inserting heat into the database:', err.message);
    throw err;
  }
};

const updateEventLeaderboard = (event_id) => {
  try {
    const query = `
      SELECT boat_id, SUM(points) as total_points_event, COUNT(DISTINCT Races.race_id) as number_of_races
      FROM Scores
      JOIN Races ON Scores.race_id = Races.race_id
      JOIN Heats ON Races.heat_id = Heats.heat_id
      WHERE Heats.event_id = ?
      GROUP BY boat_id
      ORDER BY total_points_event ASC
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id);

    const updateQuery = db.prepare(
      `INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(boat_id, event_id) DO UPDATE SET total_points_event = excluded.total_points_event, place = excluded.place`,
    );

    results.forEach(result => {
      updateQuery.run(result.boat_id, result.total_points_event, event_id);
    });

    console.log('Event leaderboard updated successfully.');
  } catch (err) {
    console.error('Error updating event leaderboard:', err.message);
    throw err;
  }
};


const updateGlobalLeaderboard = (event_id) => {
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
       ON CONFLICT(boat_id) DO UPDATE SET total_points_global = total_points_global + excluded.total_points_global`
    );

    results.forEach(result => {
      updateQuery.run(result.boat_id, result.final_position);
    });

    console.log('Global leaderboard updated successfully.');
  } catch (err) {
    console.error('Error updating global leaderboard:', err.message);
    throw err;
  }
};

const deleteHeatsByEvent = (event_id) => {
  try {
    // Delete associated HeatBoats entries first
    const deleteHeatBoatsQuery = db.prepare(
      `DELETE FROM HeatBoats WHERE heat_id IN (SELECT heat_id FROM Heats WHERE event_id = ?)`
    );
    const heatBoatsInfo = deleteHeatBoatsQuery.run(event_id);
    console.log(
      `Deleted ${heatBoatsInfo.changes} row(s) from HeatBoats for event ID ${event_id}.`
    );

    // Delete Heats entries
    const deleteHeatsQuery = db.prepare(
      `DELETE FROM Heats WHERE event_id = ?`
    );
    const heatsInfo = deleteHeatsQuery.run(event_id);
    console.log(
      `Deleted ${heatsInfo.changes} row(s) from Heats for event ID ${event_id}.`
    );

    return { heatBoatsChanges: heatBoatsInfo.changes, heatsChanges: heatsInfo.changes };
  } catch (err) {
    console.error('Error deleting heats and heat boats from the database:', err.message);
    throw err;
  }
};
const insertHeatBoat = (heat_id, boat_id) => {
  try {
    const insertQuery = db.prepare(
      `INSERT INTO HeatBoats (heat_id, boat_id)
       VALUES (?, ?)`,
    );
    const info = insertQuery.run(heat_id, boat_id);
    console.log(
      `Inserted ${info.changes} row(s) with last ID ${info.lastInsertRowid} into HeatBoats.`,
    );
    return { lastInsertRowid: info.lastInsertRowid };
  }
};
const readAllRaces = (heat_id) => {
  try {
    const query = `
      SELECT
        race_id, heat_id, race_number
      FROM Races
      WHERE heat_id = ?
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(heat_id);
    console.log('Raw results from readAllRaces:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading all races from the database:', err.message);
    return [];
  }
};

const insertRace = (heat_id, race_number) => {
  try {
    const insertQuery = db.prepare(
      `INSERT INTO Races (heat_id, race_number)
       VALUES (?, ?)`,
    );
    const info = insertQuery.run(heat_id, race_number);
    console.log(
      `Inserted ${info.changes} row(s) with last ID ${info.lastInsertRowid} into Races.`,
    );
    return { lastInsertRowid: info.lastInsertRowid };
  } catch (err) {
    console.error('Error inserting race into the database:', err.message);
    throw err;
  }
};

const readAllScores = (race_id) => {
  try {
    const query = `
      SELECT
        score_id, race_id, boat_id, position, points, status
      FROM Scores
      WHERE race_id = ?
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(race_id);
    console.log('Raw results from readAllScores:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading all scores from the database:', err.message);
    return [];
  }
};

const insertScore = (race_id, boat_id, position, points, status) => {
  try {
    const insertQuery = db.prepare(
      `INSERT INTO Scores (race_id, boat_id, position, points, status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const info = insertQuery.run(race_id, boat_id, position, points, status);
    console.log(
      `Inserted ${info.changes} row(s) with last ID ${info.lastInsertRowid} into Scores.`,
    );
    return { lastInsertRowid: info.lastInsertRowid };
  } catch (err) {
    console.error('Error inserting score into the database:', err.message);
    throw err;
  }
};

const updateScore = (score_id, position, points, status) => {
  try {
    const updateQuery = db.prepare(
      `UPDATE Scores
       SET position = ?, points = ?, status = ?
       WHERE score_id = ?`,
    );
    const info = updateQuery.run(position, points, status, score_id);
    console.log(
      `Updated ${info.changes} row(s) with ID ${score_id} in Scores.`,
    );
    return { changes: info.changes };
  } catch (err) {
    console.error('Error updating score in the database:', err.message);
    throw err;
  }
};

const deleteScore = (score_id) => {
  try {
    const deleteQuery = db.prepare(
      `DELETE FROM Scores
       WHERE score_id = ?`,
    );
    const info = deleteQuery.run(score_id);
    console.log(
      `Deleted ${info.changes} row(s) with ID ${score_id} from Scores.`,
    );
    return { changes: info.changes };
  } catch (err) {
    console.error('Error deleting score from the database:', err.message);
    throw err;
  }
};
const createNewHeatsBasedOnLeaderboard = (event_id) => {
  try {
    // Read the current leaderboard for the specific event
    const leaderboardQuery = `
      SELECT boat_id
      FROM Leaderboard
      WHERE event_id = ?
      ORDER BY total_points_event ASC
    `;
    const readLeaderboardQuery = db.prepare(leaderboardQuery);
    const leaderboardResults = readLeaderboardQuery.all(event_id);
    console.log('Leaderboard results:', leaderboardResults); // Log the leaderboard results

    // Read the existing heats for the event
    const existingHeatsQuery = db.prepare(
      `db WHERE event_id = ?`,
    );
    const existingHeats = existingHeatsQuery.all(event_id);
    console.log('Existing heats:', existingHeats); // Log the existing heats

    // Find the latest heats by suffix
    const latestHeats = existingHeats.reduce(
      (
        acc,
        heat,
      ) => {
        const match = heat.heat_name.match(/Heat ([A-Z]+)(\d*)/);
        if (match) {
          const [_, base, suffix] = match;
          const numericSuffix = suffix ? parseInt(suffix, 10) : 0;
          acc[base] = acc[base] || { suffix: 0, heat: null };
          if (numericSuffix > acc[base].suffix) {
            acc[base] = { suffix: numericSuffix, heat };
          }
        }
        return acc;
      },
      {},
    );
    console.log('Latest heats:', latestHeats); // Log the latest heats

    // Extract only the latest heats
    const lastHeats = Object.values(latestHeats).map(
      (entry) =>
        (
          entry
        ).heat,
    );
    console.log('Last heats:', lastHeats); // Log the last heats

    // Check race count for the latest heats
    const raceCountQuery = db.prepare(
      `SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?`,
    );

    const heatRaceCounts = lastHeats.map((heat) => {
      const raceCount = raceCountQuery.get(heat.heat_id).race_count;
       console.log(`Heat ${heat.heat_name} has ${raceCount} races`);
      return { heat_name: heat.heat_name, raceCount };
    });
    console.log('Heat race counts:', heatRaceCounts); // Log the heat race counts

    // Ensure all latest heats have the same number of races
    const uniqueRaceCounts = [
      ...new Set(heatRaceCounts.map((item) => item.raceCount)),
    ];
    console.log('Unique race counts:', uniqueRaceCounts); // Log the unique race counts

    if (uniqueRaceCounts.length > 1) {
      console.error('Latest heats do not have the same number of races.');
      return {
        success: false,
        message:
          'The latest heats must have the same number of races before creating new heats.',
      };
    }

    // Generate names for the next round of heats
    const nextHeatNames = Object.keys(latestHeats).map(
      (base) => `Heat ${base}${latestHeats[base].suffix + 1}`,
    );
    console.log('Next heat names:', nextHeatNames); // Log the next heat names


    // Create new heats and assign boats to them
    for (let i = 0; i < nextHeatNames.length; i++) {
      const heatName = nextHeatNames[i];
      const heatType = 'Qualifying';

      // Insert the new heat into the database
      const { lastInsertRowid: newHeatId } = db
        .prepare(
          'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
        )
        .run(event_id, heatName, heatType);
      console.log(`Inserted new heat: ${heatName} with ID: ${newHeatId}`); // Log the new heat insertion

      // Assign boats to the new heat
      for (
        let j = i;
        j < leaderboardResults.length;
        j += nextHeatNames.length
      ) {
        const boatId = leaderboardResults[j].boat_id;
        db.prepare(
          'INSERT INTO HeatBoats (heat_id, boat_id) VALUES (?, ?)',
        ).run(newHeatId, boatId);
        console.log(`Assigned boat ID: ${boatId} to heat ID: ${newHeatId}`); // Log the boat assignment
      }
    }

    console.log('New heats created based on leaderboard.');
    return { success: true };
  } catch (err) {
    console.error('Error creating new heats based on leaderboard:', err.message);
    throw err;
  }
};

const transferBoatBetweenHeats = (from_heat_id, to_heat_id, boat_id) => {
  try {
    const deleteQuery = db.prepare(
      `DELETE FROM HeatBoats WHERE heat_id = ? AND boat_id = ?`
    );
    const deleteInfo = deleteQuery.run(from_heat_id, boat_id);
    console.log(
      `Deleted ${deleteInfo.changes} row(s) from HeatBoats for heat ID ${from_heat_id} and boat ID ${boat_id}.`
    );

    const insertQuery = db.prepare(
      `INSERT INTO HeatBoats (heat_id, boat_id) VALUES (?, ?)`
    );
    const insertInfo = insertQuery.run(to_heat_id, boat_id);
    console.log(
      `Inserted ${insertInfo.changes} row(s) with last ID ${insertInfo.lastInsertRowid} into HeatBoats for heat ID ${to_heat_id}.`
    );

    return { success: true };
  } catch (err) {
    console.error('Error transferring boat between heats:', err.message);
    throw err;
  }
};

const readLeaderboard = (event_id) => {
  try {
    const query = `
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
    `;


    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id);
    console.log('Raw results from readLeaderboard:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading leaderboard from the database:', err.message);
    return [];
  }
};
const updateRaceResult = (race_id, boat_id, new_position, shift_positions) => {
  try {
    const currentResult = db.prepare(
      `SELECT position FROM Scores WHERE race_id = ? AND boat_id = ?`
    ).get(race_id, boat_id);

    if (!currentResult) {
      throw new Error('Race result not found.');
    }

    const currentPosition = currentResult.position;

    const updateQuery = db.prepare(
      `UPDATE Scores SET position = ? WHERE race_id = ? AND boat_id = ?`
    );
    updateQuery.run(new_position, race_id, boat_id);

    if (shift_positions) {
      const shiftQuery = db.prepare(
        `UPDATE Scores SET position = position + 1 WHERE race_id = ? AND position >= ? AND boat_id != ?`
      );
      shiftQuery.run(race_id, new_position, boat_id);
    }

    console.log(`Updated race result for boat ID ${boat_id} in race ID ${race_id}.`);
    return { success: true };
  } catch (err) {
    console.error('Error updating race result:', err.message);
    throw err;
  }
};

const readGlobalLeaderboard = () => {
  try {
    const query = `
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
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all();
    console.log('Raw results from readGlobalLeaderboard:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading global leaderboard from the database:', err.message);
    return [];
  }
};
const updateFinalLeaderboard = (event_id) => {
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

    const updateQuery = db.prepare(
      `INSERT INTO FinalLeaderboard (boat_id, total_points_final, event_id, placement_group)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(boat_id, event_id) DO UPDATE SET total_points_final = excluded.total_points_final, placement_group = excluded.placement_group`,
    );

    results.forEach((result) => {
      const placementGroup = result.heat_name.split(' ')[1]; // Extract the group name (e.g., Gold, Silver)
      updateQuery.run(result.boat_id, result.total_points_final, event_id, placementGroup);
    });

    console.log('Final leaderboard updated successfully.');
  } catch (err) {
    console.error('Error updating final leaderboard:', err.message);
    throw err;
  }
};

const readFinalLeaderboard = (event_id) => {
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
        b.country
      FROM FinalLeaderboard fl
      LEFT JOIN Boats b ON fl.boat_id = b.boat_id
      LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
      WHERE fl.event_id = ?
      ORDER BY fl.placement_group, fl.total_points_final ASC
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id);
    console.log('Final leaderboard results:', results);
    return results;
  } catch (err) {
    console.error('Error reading final leaderboard from the database:', err.message);
    return [];
  }
};

module.exports = {
  readAllHeats,
  insertHeat,
  readAllRaces,
  insertRace,
  readAllScores,
  insertScore,
  updateScore,
  deleteScore,
  insertHeatBoat,
  readBoatsByHeat,
  deleteHeatsByEvent,
  updateEventLeaderboard,
  updateGlobalLeaderboard,
  createNewHeatsBasedOnLeaderboard,
  transferBoatBetweenHeats,
  readLeaderboard,
  readGlobalLeaderboard,
  updateFinalLeaderboard,
  readFinalLeaderboard,
  updateRaceResult,
};
