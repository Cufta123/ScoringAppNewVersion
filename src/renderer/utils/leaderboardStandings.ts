import { processLeaderboardEntry } from './leaderboardUtils';
import type {
  LeaderboardEntry,
  OverallLeaderboardEntry,
  RawLeaderboardEntry,
} from '../types';

export interface DiscardProfiles {
  qualifying: string;
  final: string;
}

// SHRS 5.4 (MEGA M-NEW-1): the discard count keys off the races completed in
// the series, not each boat's own race count. Qualifying is series-wide (the
// max race count across all entered boats). The Final Series is scored per
// fleet (SHRS 5.1; calculateFinalBoatScores uses fleetRaceCounts), and fleets
// may sail different numbers of races (SHRS 4.5) — so the final discard count
// is the largest race count within EACH fleet, not one max across all fleets.
const raceCountOfRow = (row: RawLeaderboardEntry): number =>
  typeof row.race_positions === 'string' && row.race_positions
    ? row.race_positions.split(',').length
    : 0;

const seriesRaceCountOf = (rows: RawLeaderboardEntry[]): number =>
  Math.max(0, ...rows.map(raceCountOfRow));

const fleetRaceCountsOf = (
  rows: RawLeaderboardEntry[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const fleet = String(row.placement_group ?? 'General');
    counts.set(fleet, Math.max(counts.get(fleet) ?? 0, raceCountOfRow(row)));
  });
  return counts;
};

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
 * Turn the rows the main process returned into display rows: discards marked
 * with the CURRENT profile, and — once the Final Series has started — the
 * overall rank and combined total merged into each final row.
 */
export function buildStandings({
  eventResults,
  finalResults,
  overallResults,
  finalSeriesStarted,
  profiles,
}: {
  eventResults: RawLeaderboardEntry[];
  finalResults: RawLeaderboardEntry[];
  overallResults: OverallLeaderboardEntry[];
  finalSeriesStarted: boolean;
  profiles: DiscardProfiles;
}): BuiltStandings {
  const eventSeriesRaceCount = seriesRaceCountOf(eventResults);
  const eventRows = eventResults
    .map((entry) =>
      processLeaderboardEntry(entry, profiles.qualifying, eventSeriesRaceCount),
    )
    .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));

  const results = finalSeriesStarted ? finalResults : eventResults;
  const finalFleetRaceCounts = finalSeriesStarted
    ? fleetRaceCountsOf(finalResults)
    : null;
  const rows = results.map((entry) =>
    processLeaderboardEntry(
      entry,
      finalSeriesStarted ? profiles.final : profiles.qualifying,
      finalSeriesStarted
        ? (finalFleetRaceCounts?.get(
            String(entry.placement_group ?? 'General'),
          ) ?? 0)
        : eventSeriesRaceCount,
    ),
  );

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
