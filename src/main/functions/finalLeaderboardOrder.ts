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

const numeric = (value: unknown): number => Number(value) || 0;

/**
 * Sort final-leaderboard rows in place.
 *
 * SHRS 5.5 fleet precedence always wins (Gold, Silver, Bronze, Copper "and so
 * on" — `fleetRank` also orders the 5th and later fleets, which used to share a
 * single catch-all rank, RULE-m2). Within a fleet the sort key is the final
 * series score, or the qualifying series score while the Final Series has no
 * completed races (SHRS 1.5).
 */
export function orderFinalLeaderboardRows<T extends FinalLeaderboardRow>(
  rows: T[],
): T[] {
  const rankByQualifying = hasNoCompletedFinalRaces(rows);

  return rows.sort((left, right) => {
    const fleetDelta =
      fleetRank(left.placement_group) - fleetRank(right.placement_group);
    if (fleetDelta !== 0) return fleetDelta;

    return rankByQualifying
      ? numeric(left.qualifying_points) - numeric(right.qualifying_points)
      : numeric(left.total_points_final) - numeric(right.total_points_final);
  });
}

export default orderFinalLeaderboardRows;
