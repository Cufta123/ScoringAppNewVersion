import { db } from '../../../public/Database/DBManager';
import calculateBoatScores from './calculateBoatScores';
import calculateFinalBoatScores from './calculateFinalBoatScores';
import { getMaxHeatSizeForEvent } from './heatQueries';
import { deriveNonFinisherPoints } from './scoreStatus';
import {
  averageRedressPoints,
  parseRedressRaceIds,
} from '../../shared/redress';

interface SeriesScoreRow {
  score_id: number;
  position: number;
  status: string;
  boat_id?: number | string | null;
  race_id?: number | null;
  points?: number | null;
  rdg_race_ids?: string | null;
  /** 0 for a race whose round is still being sailed (see CountedRaces). */
  counted?: number | boolean | null;
}

/**
 * RRS A9 average-points redress is LIVE: "the average of her points in all the
 * races in the series" changes every time she sails another race, so RDG1 and
 * RDG2 points are re-derived from the boat's other scores in this series on
 * every recompute (src/shared/redress.ts has the rule). RDG3 is a PC-set value
 * and is left alone. A redress row with nothing to average yet keeps its
 * stored value.
 */
export function refreshRedressAverages(rows: SeriesScoreRow[]) {
  const redressRows = rows.filter(
    (row) =>
      (row.status === 'RDG1' || row.status === 'RDG2') &&
      row.boat_id != null &&
      row.race_id != null,
  );
  if (redressRows.length === 0) return;

  const rowsByBoat = new Map<string, SeriesScoreRow[]>();
  rows.forEach((row) => {
    if (row.boat_id == null) return;
    const key = String(row.boat_id);
    if (!rowsByBoat.has(key)) rowsByBoat.set(key, []);
    rowsByBoat.get(key)!.push(row);
  });

  const updateStmt = db.prepare(
    'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
  );
  redressRows.forEach((row) => {
    // Average only races that count in the standings: a heat of a round still
    // being sailed must not move a counted redress score (SHRS 1.1).
    let pool = (rowsByBoat.get(String(row.boat_id)) ?? []).filter(
      (other) =>
        other.score_id !== row.score_id &&
        (other.counted == null || Boolean(other.counted)),
    );
    if (row.status === 'RDG2') {
      const chosen = parseRedressRaceIds(row.rdg_race_ids);
      if (!chosen) return; // basis unknown (saved before it was recorded)
      const chosenSet = new Set(chosen);
      pool = pool.filter((other) => chosenSet.has(Number(other.race_id)));
    }
    const average = averageRedressPoints(
      pool.map((other) => ({
        points: Number(other.points),
        status: other.status,
      })),
    );
    if (average === null || average === Number(row.points)) return;
    updateStmt.run(average, average, row.score_id);
    row.points = average;
    row.position = average;
  });
}

// Recompute and persist the qualifying and final leaderboards for an event from
// the raw Scores rows. Both rebuild their table inside a transaction so a failed
// recompute never leaves a partially-updated leaderboard behind.

// SHRS 5.2: every non-finisher score in a series must use the SAME largest-heat
// value. Points are frozen into Scores.points at write time, so a race scored
// when the largest heat was smaller keeps a stale DNF/DNS value once a later
// round grows the largest heat. Re-derive them against the current series-wide
// largest heat before aggregating, so all races in the series agree.
export function renormalizeNonFinisherScores(
  event_id: any,
  heat_type: 'Qualifying' | 'Final',
) {
  const maxBoats = getMaxHeatSizeForEvent(event_id, heat_type);
  if (!maxBoats) {
    return;
  }
  const rows = db
    .prepare(
      `SELECT s.score_id, s.position, COALESCE(s.status, 'FINISHED') AS status,
              s.boat_id, s.race_id, s.points, s.rdg_race_ids,
              (cr.race_id IS NOT NULL) AS counted
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       LEFT JOIN CountedRaces cr ON cr.race_id = s.race_id
       WHERE h.event_id = ? AND h.heat_type = ?`,
    )
    .all(event_id, heat_type) as SeriesScoreRow[];

  if (rows.length === 0) {
    return;
  }

  const updateStmt = db.prepare(
    'UPDATE Scores SET points = ? WHERE score_id = ?',
  );
  rows.forEach((row) => {
    const derived = deriveNonFinisherPoints(row.status, row.position, maxBoats);
    if (derived !== null) {
      updateStmt.run(derived, row.score_id);
      // Keep the in-memory row current: redress averages below read it.
      // eslint-disable-next-line no-param-reassign
      row.points = derived;
    }
  });

  // After the non-finisher fix-up, so averages use the corrected points.
  refreshRedressAverages(rows);
}

export function recomputeEventLeaderboard(event_id: any) {
  const deleteStmt = db.prepare('DELETE FROM Leaderboard WHERE event_id = ?');
  const query = `
    SELECT boat_id, SUM(points) as total_points_event, COUNT(DISTINCT Races.race_id) as number_of_races
    FROM Scores
    JOIN Races ON Scores.race_id = Races.race_id
    JOIN Heats ON Races.heat_id = Heats.heat_id
    JOIN CountedRaces ON CountedRaces.race_id = Scores.race_id
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
    // Re-derive frozen non-finisher points against the current series-wide
    // largest heat (SHRS 5.2) before aggregating, so SUM(points) is consistent.
    renormalizeNonFinisherScores(event_id, 'Qualifying');
    deleteStmt.run(event_id);
    const results = readQuery.all(event_id);
    if (results.length === 0) {
      return;
    }

    const temporaryTable = calculateBoatScores(results, event_id);
    temporaryTable.forEach((boat) => {
      insertStmt.run(boat.boat_id, boat.totalPoints, event_id, boat.place);
    });
  });

  tx();
}

export function recomputeFinalLeaderboard(event_id: any) {
  // Start from Heat_Boat, not Scores: SHRS 4.5 lets fleets sail different
  // numbers of races, so a fleet that has not raced yet must still keep its
  // boats on the final leaderboard (with a 0-point final series so far)
  // instead of vanishing until its first race is scored.
  const query = `
    SELECT hb.boat_id, h.heat_name, COALESCE(SUM(s.points), 0) as total_points_final
    FROM Heat_Boat hb
    JOIN Heats h ON hb.heat_id = h.heat_id
    LEFT JOIN Races r ON r.heat_id = h.heat_id
    LEFT JOIN Scores s ON s.race_id = r.race_id AND s.boat_id = hb.boat_id
    WHERE h.event_id = ? AND h.heat_type = 'Final'
    GROUP BY hb.boat_id, h.heat_name
    ORDER BY h.heat_name, total_points_final ASC
  `;
  const readQuery = db.prepare(query);

  const deleteStmt = db.prepare(
    'DELETE FROM FinalLeaderboard WHERE event_id = ?',
  );
  const updateQuery = db.prepare(
    `INSERT INTO FinalLeaderboard (boat_id, total_points_final, event_id, placement_group, place)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(boat_id, event_id) DO UPDATE SET total_points_final = excluded.total_points_final, placement_group = excluded.placement_group,  place = excluded.place`,
  );

  const tx = db.transaction(() => {
    // SHRS 5.2: re-derive frozen non-finisher points against the current
    // series-wide largest final heat before aggregating, so a Final DNF/DNS
    // does not keep a stale value once a later round grows the largest heat
    // (same fix as the Qualifying path). M2 was withdrawn: SHRS 5.2 uses a
    // single series-wide "largest heat", not a per-fleet value.
    renormalizeNonFinisherScores(event_id, 'Final');
    const results = readQuery.all(event_id);
    const groupTables = calculateFinalBoatScores(results, event_id);
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
