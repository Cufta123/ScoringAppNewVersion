/**
 * How the boats are split into Final Series fleets (SHRS 4.1, 4.2, 2.3).
 * Pure: takes the qualifying ranking and returns the fleets, or the reason
 * they cannot be made. The handler reads the ranking, calls this, and writes
 * the fleets in one transaction.
 */
import type { HeatOverflowPolicy } from '../../shared/eventSettings';
import { SHRS_MAX_BOATS_PER_HEAT } from '../../shared/heatSizing';

export interface FleetCandidate {
  boat_id: number;
  /** Qualifying series total used to rank for the split (SHRS 4.3). */
  totalPoints: number;
}

export type FinalFleetPlan =
  | {
      ok: true;
      /** Boat ids, best fleet first; within a fleet, best boat first. */
      fleets: number[][];
    }
  | { ok: false; refusal: string };

export const NO_QUALIFYING_RESULTS_REFUSAL =
  'Cannot start the Final Series: there are no qualifying results yet. Score the qualifying races first.';

/**
 * Boats that withdrew (WTH) in any qualifying race. `race_statuses` is the
 * boat's statuses joined with commas, as the leaderboard query returns them.
 */
export function findWithdrawnBoatIds(
  rows: Array<{ boat_id: number; race_statuses: string | null }>,
): Set<number> {
  return new Set(
    rows
      .filter((row) => {
        const statuses = row.race_statuses ? row.race_statuses.split(',') : [];
        return statuses.some((status) => status.trim().toUpperCase() === 'WTH');
      })
      .map((row) => row.boat_id),
  );
}

/**
 * Split the qualifying ranking into Final Series fleets.
 *
 * - Withdrawn boats rank after everyone else (SHRS 4.1), each group by
 *   qualifying total; equal totals keep the order they came in.
 * - There start out as many fleets as there were qualifying heats (SHRS 4.1).
 *   If that would put more than 20 boats in a fleet (SHRS 2.3), the event's
 *   overflow policy decides: `auto-increase` adds fleets, otherwise the race
 *   officer has to confirm oversize fleets (`allowOversize`).
 * - Never more fleets than boats, so no fleet is empty (SHRS 4.1 allows the
 *   number of fleets to be reduced).
 * - Fleets are as equal as possible; the earlier fleets take the remainder
 *   (SHRS 4.1 / 4.2).
 */
export default function planFinalFleets(
  rankedBoats: readonly FleetCandidate[],
  withdrawnIds: ReadonlySet<number>,
  qualifyingHeatCount: number,
  overflowPolicy: HeatOverflowPolicy,
  allowOversize: boolean,
): FinalFleetPlan {
  const ordered = [...rankedBoats].sort((left, right) => {
    const leftWithdrawn = withdrawnIds.has(left.boat_id);
    const rightWithdrawn = withdrawnIds.has(right.boat_id);
    if (leftWithdrawn !== rightWithdrawn) {
      return leftWithdrawn ? 1 : -1;
    }
    return left.totalPoints - right.totalPoints;
  });

  if (ordered.length === 0) {
    return { ok: false, refusal: NO_QUALIFYING_RESULTS_REFUSAL };
  }

  let fleetCount = Math.max(1, Math.floor(qualifyingHeatCount));
  if (ordered.length > fleetCount * SHRS_MAX_BOATS_PER_HEAT) {
    if (overflowPolicy === 'auto-increase') {
      fleetCount = Math.ceil(ordered.length / SHRS_MAX_BOATS_PER_HEAT);
    } else if (!allowOversize) {
      return {
        ok: false,
        refusal: `Final fleets would exceed ${SHRS_MAX_BOATS_PER_HEAT} boats. Confirm oversize to continue or switch event policy to auto-increase heats.`,
      };
    }
  }

  // RULE-M23 / SHRS 4.1: never create more final fleets than there are boats.
  fleetCount = Math.min(fleetCount, ordered.length);

  const boatsPerFleet = Math.floor(ordered.length / fleetCount);
  const extraBoats = ordered.length % fleetCount;
  const fleets: number[][] = [];
  let boatIndex = 0;
  for (let i = 0; i < fleetCount; i += 1) {
    const size = boatsPerFleet + (i < extraBoats ? 1 : 0);
    fleets.push(
      ordered.slice(boatIndex, boatIndex + size).map((boat) => boat.boat_id),
    );
    boatIndex += size;
  }
  return { ok: true, fleets };
}
