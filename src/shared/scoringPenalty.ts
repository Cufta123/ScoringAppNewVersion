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
  // RRS 44.3(c): ZFP/SCP worsen the score by 20% of the score for DNF, rounded
  // to the nearest whole number (0.5 up). RRS Appendix T1 = 30%, same method.
  // Under SHRS 5.2 the score for DNF is (boats in the largest heat) + 1, so the
  // percentage base is maxBoats + 1 — NOT maxBoats. The cap below already uses
  // maxBoats + 1 as the DNF score; the base must match it.
  const penaltyRate = status === 'T1' ? 0.3 : 0.2;
  const dnfScore = maxBoats + 1;
  const penaltyPlaces = roundHalfUp(dnfScore * penaltyRate);
  return Math.min(finishingPosition + penaltyPlaces, dnfScore);
}
