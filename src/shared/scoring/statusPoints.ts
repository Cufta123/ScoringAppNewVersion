/**
 * Which statuses take their points from the largest heat, and how many.
 * Pure, so the recompute, the write path and the score explanation all use
 * the same rule.
 */
import {
  getScoringPenaltyPoints,
  scoringPenaltyStatuses,
} from '../scoringPenalty';

export const rdgStatuses = ['RDG1', 'RDG2', 'RDG3'];

export const penaltyStatuses = [
  'DNF',
  'DNS',
  'DSQ',
  'OCS',
  'ZFP',
  'T1',
  'RET',
  'SCP',
  'BFD',
  'UFD',
  'DNC',
  'NSC',
  'WTH',
  'DNE',
  'DGM',
  'DPI',
];
// SHRS 5.2 / RRS 44.3(c): derive the points a non-finisher status should carry
// given the current largest-heat size. Mirrors the write-time logic of
// scoreRaceColumn so a leaderboard recompute can re-derive frozen scores
// against the current series-wide largest heat (fixing stale DNF/DNS points).
// Returns null for statuses whose points are NOT a function of the largest heat
// (FINISHED keeps its place-based points; RDG keeps its redress value).
export function deriveNonFinisherPoints(
  status: string,
  position: number,
  maxBoats: number,
): number | null {
  if (rdgStatuses.includes(status)) {
    return null;
  }
  // RRS A10: DPI (discretionary penalty imposed) points are SET BY THE PROTEST
  // COMMITTEE, not a function of the largest heat. Keep the stored (PC-entered)
  // value — never auto-derive it and never renormalize it (unlike DSQ et al.).
  if (status === 'DPI') {
    return null;
  }
  if (!penaltyStatuses.includes(status)) {
    return null; // FINISHED
  }
  if (scoringPenaltyStatuses.has(status)) {
    return getScoringPenaltyPoints(position, maxBoats, status);
  }
  return maxBoats + 1;
}

/**
 * SHRS 5.2 / write-path classification: is `status` a non-scoring penalty
 * (DNF, DNS, DSQ, OCS, RET, BFD, UFD, DNC, NSC, WTH, DNE, DGM) whose finishing
 * place is discarded and whose score is fixed at (largest heat + 1)?
 *
 * Mirrors the classification `scoreRaceColumn` writes with, so the write
 * path and any re-derivation agree. RDG and DPI keep their
 * protest-committee-provided value and are NOT non-scoring; ZFP/SCP/T1 are
 * position-keeping scoring penalties and are also NOT non-scoring.
 */
export function isNonScoringPenalty(status: string): boolean {
  const keepsProvidedPoints = rdgStatuses.includes(status) || status === 'DPI';
  return (
    !keepsProvidedPoints &&
    penaltyStatuses.includes(status) &&
    !scoringPenaltyStatuses.has(status)
  );
}
