/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import calculateBoatScores from './calculateBoatScores';
import calculateFinalBoatScores from './calculateFinalBoatScores';

// Recompute and persist the qualifying and final leaderboards for an event from
// the raw Scores rows. Both rebuild their table inside a transaction so a failed
// recompute never leaves a partially-updated leaderboard behind.

export function recomputeEventLeaderboard(event_id: any) {
  const deleteStmt = db.prepare('DELETE FROM Leaderboard WHERE event_id = ?');
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
  const insertStmt = db.prepare(
    `INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(boat_id, event_id) DO UPDATE SET total_points_event = excluded.total_points_event, place = excluded.place`,
  );

  const tx = db.transaction(() => {
    deleteStmt.run(event_id);
    const results = readQuery.all(event_id);
    if (results.length === 0) {
      return;
    }

    const pointsMap = new Map<number, any[]>();
    const temporaryTable = calculateBoatScores(results, event_id, pointsMap);
    temporaryTable.forEach((boat) => {
      insertStmt.run(boat.boat_id, boat.totalPoints, event_id, boat.place);
    });
  });

  tx();
}

export function recomputeFinalLeaderboard(event_id: any) {
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

  const deleteStmt = db.prepare(
    'DELETE FROM FinalLeaderboard WHERE event_id = ?',
  );
  const updateQuery = db.prepare(
    `INSERT INTO FinalLeaderboard (boat_id, total_points_final, event_id, placement_group, place)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(boat_id, event_id) DO UPDATE SET total_points_final = excluded.total_points_final, placement_group = excluded.placement_group,  place = excluded.place`,
  );

  const tx = db.transaction(() => {
    deleteStmt.run(event_id);
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
  });

  tx();
}
