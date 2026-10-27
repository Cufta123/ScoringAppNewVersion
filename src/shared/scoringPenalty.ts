import { roundPoints } from './points';
import { roundToTenthHalfUp } from './redress';

// Scoring-penalty math shared by the main process (score persistence) and the
// renderer (edit-mode preview). Kept here so the RRS 44.3(c)/Appendix T1 rule
// has a single source of truth — the two processes must score these penalties
// identically or the preview total drifts from the persisted total.

export const scoringPenaltyStatuses = new Set(['ZFP', 'SCP', 'T1']);

/**
 * RRS A6.1: "If a boat is disqualified from a race or retires after finishing,
 * each boat with a worse finishing place shall be moved up one place."
 *
 * These are the statuses that remove a boat that HAD finished from the
 * finishing order, so the boats behind her must be promoted. Shared with the
 * renderer's edit preview so the promotion the scorer sees matches the one the
 * main process persists (RULE-M16).
 */
export const mandatoryDisplaceStatuses = new Set(['DSQ', 'RET', 'DNE', 'DGM']);

const rdgStatuses = new Set(['RDG1', 'RDG2', 'RDG3']);

/**
 * RRS A6.1: does changing a boat's status from `previousStatus` to `newStatus`
 * remove a boat that HAD finished — including a position-keeping penalty
 * (ZFP/SCP/T1), which holds a real finishing place — so that every boat behind
 * her must be moved up one place?
 *
 * RDG/DPI never displace anyone (RRS A6.2 / A10), so those new-statuses are
 * excluded. The PREVIOUS status counts as "had finished" when it is FINISHED or
 * a position-keeping penalty; those boats occupied a finishing slot, so a later
 * DSQ/RET/DNE/DGM must vacate that slot and promote the boats behind it.
 *
 * Shared by the main process (scoreStatus re-export) and the renderer edit
 * preview (useLeaderboard) so the promotion the scorer sees matches the one the
 * main process persists (RULE-M16).
 */
export function promotesBoatsBehind(
  previousStatus: string,
  newStatus: string,
): boolean {
  const keepsProvidedPoints = rdgStatuses.has(newStatus) || newStatus === 'DPI';
  const hadFinished =
    previousStatus === 'FINISHED' || scoringPenaltyStatuses.has(previousStatus);
  return (
    !keepsProvidedPoints &&
    hadFinished &&
    mandatoryDisplaceStatuses.has(newStatus)
  );
}

/**
 * RRS 44.3(c) (2025–2028): a Scoring Penalty worsens the score by a
 * percentage of the score for Did Not Finish, "rounded to the nearest tenth
 * of a point (0.05 rounded upward)", and never past the DNF score. ZFP is a
 * 20% penalty (rule 30.2), SCP 20% unless the notice of race says otherwise,
 * and a Post-Race Penalty 30% (Appendix T1(b)). Under SHRS 5.2 the DNF score
 * is the largest heat + 1.
 *
 * The 2021–2024 rules rounded the penalty to a whole number; this used to as
 * well, so a 16-boat heat added 3 points instead of 3.4.
 */
export function getScoringPenaltyPoints(
  finishingPosition: number,
  maxBoats: number,
  status?: string,
): number {
  const dnfScore = maxBoats + 1;
  const penalty = roundToTenthHalfUp(dnfScore * (status === 'T1' ? 0.3 : 0.2));
  return Math.min(roundPoints(finishingPosition + penalty), dnfScore);
}
