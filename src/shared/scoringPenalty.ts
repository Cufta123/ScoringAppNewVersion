// Scoring-penalty math shared by the main process (score persistence) and the
// renderer (edit-mode preview). Kept here so the RRS 44.3(c)/Appendix T1 rule
// has a single source of truth — the two processes must score these penalties
// identically or the preview total drifts from the persisted total.

export const scoringPenaltyStatuses = new Set(['ZFP', 'SCP', 'T1']);

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + Number.EPSILON);
}

export function getScoringPenaltyPoints(
  finishingPosition: number,
  maxBoats: number,
  status?: string,
): number {
  // RRS 44.3(c): ZFP/SCP = 20% of boats, rounded to nearest whole number
  // (0.5 rounded up). RRS Appendix T1 = 30%, calculated the same way.
  const penaltyRate = status === 'T1' ? 0.3 : 0.2;
  const penaltyPlaces = roundHalfUp(maxBoats * penaltyRate);
  return Math.min(finishingPosition + penaltyPlaces, maxBoats + 1);
}
