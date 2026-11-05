import { roundPoints } from './points';
import { roundToTenthHalfUp } from './redress';

// Scoring-penalty math shared by the main process (score persistence) and the
// renderer (edit-mode preview). Kept here so the RRS 44.3(c)/Appendix T1 rule
// has a single source of truth — the two processes must score these penalties
// identically or the preview total drifts from the persisted total.

export const scoringPenaltyStatuses = new Set(['ZFP', 'SCP', 'T1']);

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
  /** The score she would have had: her place, or the shared points of a tie. */
  finishingPosition: number,
  maxBoats: number,
  status?: string,
): number {
  const dnfScore = maxBoats + 1;
  const penalty = roundToTenthHalfUp(dnfScore * (status === 'T1' ? 0.3 : 0.2));
  return Math.min(roundPoints(finishingPosition + penalty), dnfScore);
}
