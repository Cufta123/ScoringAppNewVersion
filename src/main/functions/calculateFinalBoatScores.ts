import { db } from '../../../public/Database/DBManager';
import { getEventDiscardConfig } from './discardConfig';
import {
  rankFinalSeries,
  RaceScore,
  RankedBoat,
} from '../../shared/scoring/series';

// Loads an event's final-series scores and hands them to the scoring core
// (src/shared/scoring/series.ts), which holds the rules.

interface Result<Id> {
  boat_id: Id;
  total_points_final: number;
  heat_name: string;
}

function getFinalScores(
  event_id: number,
  boat_id: number | string,
  heat_name: string,
): RaceScore[] {
  return db
    .prepare(
      `SELECT s.points, COALESCE(s.status, 'FINISHED') as status, s.race_id, r.race_number
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Final' AND h.heat_name = ?
       ORDER BY points DESC, r.race_number ASC, s.race_id ASC`,
    )
    .all(event_id, boat_id, heat_name) as RaceScore[];
}

/** "Final Gold" -> "Gold". */
const fleetOf = (heat_name: unknown) =>
  (typeof heat_name === 'string'
    ? heat_name.match(/^Final\s+(.+)$/i)?.[1]
    : undefined) ?? String(heat_name);

/** Places within each final fleet, keyed by fleet name. */
export default function calculateFinalBoatScores<Id extends number | string>(
  results: Result<Id>[],
  event_id: number,
): Map<string, RankedBoat<Id>[]> {
  return rankFinalSeries(
    results.map((row) => ({
      boat_id: row.boat_id,
      fleet: fleetOf(row.heat_name),
      scores: getFinalScores(event_id, row.boat_id, row.heat_name),
    })),
    { discardConfig: getEventDiscardConfig(event_id, 'final') },
  );
}
