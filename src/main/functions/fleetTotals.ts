/**
 * SHRS 4.3 fleet-assignment ranking: applies the event's discard profile to
 * each boat's qualifying scores, including the temporary second-worst
 * exclusion used for ranking only when 6 or 7 races have been completed.
 */
import { computeAdjustedFleetTotals } from '../../shared/fleetAssignment';
import { DiscardConfig, getExcludeCountForConfig } from './discardConfig';

export default function buildAdjustedFleetLeaderboard(
  leaderboard: Array<{
    boat_id: number;
    race_points: string | null;
    race_statuses: string | null;
  }>,
  qualifyingDiscardConfig: DiscardConfig,
  applyShs43TemporarySecondDiscard = true,
): Array<{ boat_id: number; totalPoints: number }> {
  return computeAdjustedFleetTotals(leaderboard, {
    applyShs43TemporarySecondDiscard,
    getExcludeCount: (n: number) =>
      getExcludeCountForConfig(n, qualifyingDiscardConfig),
  });
}
