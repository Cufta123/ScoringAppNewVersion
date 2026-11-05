import { processLeaderboardEntry } from './leaderboardUtils';
import type {
  LeaderboardEntry,
  OverallLeaderboardEntry,
  RawLeaderboardEntry,
} from '../types';

/** The first row of each boat, so a lookup by boat is O(1) instead of a scan. */
const firstByBoatId = <T extends { boat_id: unknown }>(
  rows: T[],
): Map<T['boat_id'], T> => {
  const byBoat = new Map<T['boat_id'], T>();
  rows.forEach((row) => {
    if (!byBoat.has(row.boat_id)) byBoat.set(row.boat_id, row);
  });
  return byBoat;
};

export interface BuiltStandings {
  /** The qualifying standings, in place order. */
  eventRows: LeaderboardEntry[];
  /** What the page shows: the final fleets once started, else qualifying. */
  leaderboard: LeaderboardEntry[];
}

/**
 * Turn the rows the main process returned into display rows: the scores
 * regatta-core excluded marked, and — once the Final Series has started —
 * the overall rank and combined total merged into each final row.
 */
export function buildStandings({
  eventResults,
  finalResults,
  overallResults,
  finalSeriesStarted,
}: {
  eventResults: RawLeaderboardEntry[];
  finalResults: RawLeaderboardEntry[];
  overallResults: OverallLeaderboardEntry[];
  finalSeriesStarted: boolean;
}): BuiltStandings {
  const eventRows = eventResults
    .map((entry) => processLeaderboardEntry(entry))
    .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));

  const results = finalSeriesStarted ? finalResults : eventResults;
  const rows = results.map((entry) => processLeaderboardEntry(entry));

  const overallByBoat = firstByBoatId(overallResults);
  const eventByBoat = firstByBoatId(eventRows);
  const merged = rows.map((entry) => {
    if (!finalSeriesStarted) return entry;
    const overallEntry = overallByBoat.get(entry.boat_id);
    const eventEntry = eventByBoat.get(entry.boat_id);
    const total_points_combined = overallEntry
      ? overallEntry.overall_points
      : (entry.computed_total ?? 0) +
        (eventEntry ? (eventEntry.computed_total ?? 0) : 0);
    return {
      ...entry,
      total_points_combined,
      qualifying_points:
        overallEntry?.qualifying_points ?? eventEntry?.computed_total ?? 0,
      overall_rank: overallEntry?.overall_rank,
    };
  });

  merged.sort((a, b) =>
    finalSeriesStarted
      ? (a.overall_rank ?? Infinity) - (b.overall_rank ?? Infinity)
      : (a.place ?? Infinity) - (b.place ?? Infinity),
  );

  return { eventRows, leaderboard: merged };
}
