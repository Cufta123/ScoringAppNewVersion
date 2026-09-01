/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import {
  DiscardConfig,
  getExcludeCountForConfig,
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
} from '../../shared/discardProfile';

// SHRS 5.4 profile parsing and the exclusion count itself are PURE and live in
// src/shared/discardProfile so the renderer's edit-mode preview computes the
// discard count from the same implementation instead of its own copy.
// Re-exported here to keep this module the single import surface for the main
// process's discard logic.
export type { DiscardConfig };
export {
  getExcludeCountForConfig,
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
};

export function getEventDiscardConfig(
  event_id: any,
  series: 'qualifying' | 'final',
): DiscardConfig {
  const column =
    series === 'qualifying'
      ? 'shrs_discard_profile_qualifying'
      : 'shrs_discard_profile_final';

  const row = db
    .prepare(
      `SELECT ${column} as discard_profile FROM Events WHERE event_id = ?`,
    )
    .get(event_id) as { discard_profile?: string } | undefined;

  return normalizeDiscardConfig(row?.discard_profile ?? 'standard');
}

/**
 * SHRS 5.4 keys the discard count off the number of races COMPLETED IN THE
 * SERIES — a series-wide constant for qualifying, and a fleet-wide constant for
 * each final fleet (5.1 scores fleets separately; 4.5 lets fleets sail
 * different numbers of races). It is NOT each boat's own race count.
 *
 * This returns the correct denominator for a given series/fleet so the
 * tie-break A8.1 "kept scores" vector and the explain panel derive the same
 * discard count the totals use (via capExcludeCountForBoat). Matches the
 * `seriesRaceCount` in calculateBoatScores.ts and `fleetRaceCounts` in
 * calculateFinalBoatScores.ts.
 *
 * `heat_name` (required for the final series) is the fleet's heat name, e.g.
 * "Final Gold".
 */
export function getSeriesDiscardRaceCount(
  event_id: any,
  heat_type: 'Qualifying' | 'Final',
  heat_name?: string | null,
): number {
  const heatNameFilter = heat_name ? 'AND h.heat_name = ?' : '';
  const params: any[] = heat_name
    ? [event_id, heat_type, heat_name]
    : [event_id, heat_type];

  const row = db
    .prepare(
      `SELECT MAX(race_count) AS max_count FROM (
         SELECT COUNT(*) AS race_count
         FROM Scores s
         JOIN Races r ON s.race_id = r.race_id
         JOIN Heats h ON r.heat_id = h.heat_id
         WHERE h.event_id = ? AND h.heat_type = ? ${heatNameFilter}
         GROUP BY s.boat_id
       )`,
    )
    .get(...params) as { max_count: number | null } | undefined;

  return row?.max_count ?? 0;
}
