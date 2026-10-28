/**
 * What one boat's entry on the scoring screen becomes in `Scores`: her place,
 * points and status (SHRS 5.2, RRS 44.3(c)/T1). Pure, so the rule can be
 * tested without a database; the handler writes the result.
 */
import {
  getScoringPenaltyPoints,
  normalizeScoreStatus,
  scoringPenaltyStatuses,
} from './scoreStatus';
import { sanitizePositiveInteger } from './validation';

export interface SubmittedBoatResult {
  /** The sail the officer typed (used only to name the boat in a message). */
  boatNumber: string | number;
  /** The place typed; only used for FINISHED and ZFP/SCP/T1. */
  place: unknown;
  status: unknown;
}

export interface BoatRaceScore {
  status: string;
  position: number;
  points: number;
  /** True when the boat finished and so takes part in the A7 tie scoring. */
  finished: boolean;
}

/**
 * The size to base penalties on (SHRS 5.2: the largest heat of the series
 * plus one). Before any heat size is known, the number of boats scored.
 */
export function penaltyHeatSize(
  maxHeatSize: number,
  scoredBoatCount: number,
): number {
  return maxHeatSize || scoredBoatCount;
}

/**
 * - FINISHED: the place typed is the position and the points.
 * - ZFP / SCP / T1: keep the finishing place and add the penalty places.
 * - Every other code (DNF, DNS, DSQ, RET, RDG, ...): the largest heat size + 1
 *   as both position and points (SHRS 5.2); the place typed is ignored, so it
 *   may be empty or 0 and is not checked.
 */
export default function scoreSubmittedBoat(
  result: SubmittedBoatResult,
  heatSizeForPenalty: number,
): BoatRaceScore {
  const status = normalizeScoreStatus(result.status);
  const context = `The place of sail ${String(result.boatNumber)}`;

  if (status === 'FINISHED') {
    // BK-6: a FINISHED place must be a positive integer; a 0 / NaN place
    // would otherwise be written straight to Scores.position/points.
    const place = sanitizePositiveInteger(result.place, context);
    return { status, position: place, points: place, finished: true };
  }

  if (scoringPenaltyStatuses.has(status)) {
    const place = sanitizePositiveInteger(result.place, context);
    return {
      status,
      position: place,
      points: getScoringPenaltyPoints(place, heatSizeForPenalty, status),
      finished: false,
    };
  }

  // BK-3: the frontend always sends a sequential `place` (>=1), so these
  // boats must not take it: they share the penalty position.
  const penaltyPlace = heatSizeForPenalty + 1;
  return {
    status,
    position: penaltyPlace,
    points: penaltyPlace,
    finished: false,
  };
}
