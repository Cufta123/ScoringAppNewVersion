/* eslint-disable camelcase */

/**
 * Ordering of the Final Series leaderboard (SHRS 1.5 + 5.5).
 *
 * Kept out of the IPC handler so the two rules it encodes can be unit-tested
 * without a database.
 */
import { fleetRank } from '../../shared/fleetNames';

export interface FinalLeaderboardRow {
  placement_group?: unknown;
  total_points_final?: unknown;
  qualifying_points?: unknown;
  /** CSV of the boat's final-series race ids; empty/absent when she has none. */
  race_ids?: unknown;
}

/**
 * SHRS 1.5: "If no races are completed in the Final Series boats will be ranked
 * according to their series score in the Qualifying Series."
 *
 * A final race is "completed" for ranking purposes once it has been SAILED —
 * i.e. once ANY boat has a final-series score — not only when every boat in the
 * heat has a score. A partially-scored final race is still a completed race,
 * so `hasAnyCompletedFinalRace` keys on the presence of a final score (a
 * non-empty `race_ids` CSV) and not on full coverage.
 */
export const hasAnyCompletedFinalRace = (
  rows: readonly FinalLeaderboardRow[],
): boolean =>
  rows.some((row) => !!row.race_ids && String(row.race_ids).length > 0);

/**
 * True only when NOT ONE boat has a final-series score. While that holds every
 * `total_points_final` is 0, so sorting on it leaves the rows in whatever order
 * the database produced (RULE-M15).
 */
export const hasNoCompletedFinalRaces = (
  rows: readonly FinalLeaderboardRow[],
): boolean => !hasAnyCompletedFinalRace(rows);

const hasFinalScore = (row: FinalLeaderboardRow): boolean =>
  !!row.race_ids && String(row.race_ids).length > 0;

/**
 * The `fleetRank`s of the fleets that have sailed at least one final race.
 *
 * SHRS 1.5 is decided per FLEET, not per event: fleets do not have to start
 * their Final Series together (postponement, staggered starts, the SHRS 4.5
 * time limit), so one fleet racing must not change how another fleet — which
 * has not sailed yet — is ranked. Deciding this event-wide made every boat in
 * an unraced fleet fall back on `total_points_final = 0`, which ties them all
 * and leaves the fleet in raw database order instead of qualifying order.
 */
export const fleetsWithCompletedFinalRace = (
  rows: readonly FinalLeaderboardRow[],
): Set<number> => {
  const sailed = new Set<number>();
  rows.forEach((row) => {
    if (hasFinalScore(row)) sailed.add(fleetRank(row.placement_group));
  });
  return sailed;
};

const numeric = (value: unknown): number => Number(value) || 0;

/**
 * Sort final-leaderboard rows in place.
 *
 * SHRS 5.5 fleet precedence always wins (Gold, Silver, Bronze, Copper "and so
 * on" — `fleetRank` also orders the 5th and later fleets, which used to share a
 * single catch-all rank, RULE-m2). Within a fleet the sort key is that fleet's
 * final series score, or its qualifying series score while THAT fleet has no
 * completed final races (SHRS 1.5).
 */
export function orderFinalLeaderboardRows<T extends FinalLeaderboardRow>(
  rows: T[],
): T[] {
  const sailedFleets = fleetsWithCompletedFinalRace(rows);

  return rows.sort((left, right) => {
    const leftFleet = fleetRank(left.placement_group);
    const fleetDelta = leftFleet - fleetRank(right.placement_group);
    if (fleetDelta !== 0) return fleetDelta;

    // Same fleet, so one lookup decides the key for both rows.
    return sailedFleets.has(leftFleet)
      ? numeric(left.total_points_final) - numeric(right.total_points_final)
      : numeric(left.qualifying_points) - numeric(right.qualifying_points);
  });
}

export default orderFinalLeaderboardRows;
