import { db } from '../../../public/Database/DBManager';
import { getEventDiscardConfig } from './discardConfig';
import {
  compareQualifyingTie,
  isSingleHeatSeries,
  rankQualifyingSeries,
  RaceScore,
  RankedBoat,
} from '../../shared/scoring/series';

// Loads an event's qualifying scores and hands them to the scoring core
// (src/shared/scoring/series.ts), which holds the rules.

interface Result {
  boat_id: any;
  total_points_event: any;
  number_of_races: any;
}

interface ScoreEntry extends RaceScore {
  status: string;
}

export interface TieCandidate {
  boat_id: string;
  keptScores: number[];
}

/** A boat's qualifying race scores (worst first). */
export function getScoresForA81(event_id: any, boat_id: any): ScoreEntry[] {
  return db
    .prepare(
      `SELECT s.points, COALESCE(s.status, 'FINISHED') as status, s.race_id, r.race_number
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Qualifying'
       ORDER BY points DESC, r.race_number ASC, s.race_id ASC`,
    )
    .all(event_id, boat_id) as ScoreEntry[];
}

/** SHRS 5.7.1 vs 5.7.2 for the event (see isSingleHeatSeries). */
export function detectSingleHeatEvent(event_id: any, boatIds: string[]) {
  return isSingleHeatSeries(
    boatIds.map((boat_id) => ({ scores: getScoresForA81(event_id, boat_id) })),
  );
}

/** The qualifying tie-break the ranking uses, for the explain panel. */
export function compareQualifyingTieCandidates(
  event_id: any,
  a: TieCandidate,
  b: TieCandidate,
  isSingleHeatEvent: boolean,
): number {
  return compareQualifyingTie(
    {
      boat_id: a.boat_id,
      keptAscending: a.keptScores,
      scores: getScoresForA81(event_id, a.boat_id),
    },
    {
      boat_id: b.boat_id,
      keptAscending: b.keptScores,
      scores: getScoresForA81(event_id, b.boat_id),
    },
    isSingleHeatEvent,
  );
}

/**
 * Qualifying places for the boats in `results` (one row per boat with a
 * score). `number_of_races` gives the series length for SHRS 5.4.
 */
export default function calculateBoatScores(
  results: Result[],
  event_id: any,
): RankedBoat<any>[] {
  const seriesRaceCount = results.reduce(
    (max, row) => Math.max(max, Number(row.number_of_races) || 0),
    0,
  );
  return rankQualifyingSeries(
    results.map((row) => ({
      boat_id: row.boat_id,
      scores: getScoresForA81(event_id, row.boat_id),
    })),
    {
      discardConfig: getEventDiscardConfig(event_id, 'qualifying'),
      seriesRaceCount,
    },
  );
}
