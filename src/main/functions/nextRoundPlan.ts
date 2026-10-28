/**
 * Which boat goes into which heat of the next qualifying round (SHRS 3.1 /
 * 3.2). Pure: the handler reads the latest heats and their results, asks for a
 * plan here, and writes the new heats and assignments in one transaction.
 */
import type { QualifyingAssignmentMode } from '../../shared/eventSettings';
import {
  compareByCountryThenSail,
  generateNextHeatNames,
  getNextHeatIndexByMovementTable,
} from './creatingNewHeatsUtls';
import { getHeatBaseFromName } from './scoreStatus';

export interface LatestHeat {
  heat_id: number;
  heat_name: string;
}

export interface PreAssignedBoat {
  boat_id: number;
  country: string | null;
  sail_number: string | number | null;
}

export interface NextRoundInput {
  /** The heats of the round just sailed (one per heat letter, highest suffix). */
  latestHeats: readonly LatestHeat[];
  mode: QualifyingAssignmentMode;
  /** `pre-assigned`: the boats of each of those heats. */
  boatsByHeatId: ReadonlyMap<number, readonly PreAssignedBoat[]>;
  /**
   * `progressive`: each heat's boats in finishing order (SHRS 5.3, with any
   * SHRS 3.1.5 protest shield applied). A heat missing from the map has no
   * result to move boats from.
   */
  rankedBoatIdsByHeatId: ReadonlyMap<number, readonly number[]>;
}

export type NextRoundPlan =
  | {
      ok: true;
      /** The number the new round will have ("Heat A2" is round 2). */
      roundNumber: number;
      /** Names of the new heats, in the order the assignments refer to. */
      heatNames: string[];
      /** `heatIndex` points into `heatNames`. */
      assignments: Array<{ heatIndex: number; boatId: number }>;
      heatCount: number;
    }
  | { ok: false; refusal: string };

/**
 * Plan the next round.
 *
 * - `progressive` (SHRS 3.1): every boat moves by the Heat Movement Table from
 *   the heat she sailed in and the place she finished.
 * - `pre-assigned` (SHRS 3.2): boats stay with their heat letter, in the
 *   seeding order used for the first round.
 *
 * There is no fallback to a fresh draw: if nothing could be assigned, the
 * round is refused so the race office repairs the previous round instead.
 */
export default function planNextRound(input: NextRoundInput): NextRoundPlan {
  const { latestHeats, mode, boatsByHeatId, rankedBoatIdsByHeatId } = input;

  const sortedHeats = [...latestHeats].sort((left, right) =>
    getHeatBaseFromName(left.heat_name).localeCompare(
      getHeatBaseFromName(right.heat_name),
    ),
  );
  if (sortedHeats.length === 0) {
    return {
      ok: false,
      refusal:
        'This event has no qualifying heats yet. Create the heats first.',
    };
  }
  const heatNames = generateNextHeatNames(sortedHeats);

  // The round number is the suffix of the heats just sailed, plus one.
  const suffix = sortedHeats[0].heat_name.match(/(\d+)$/);
  const roundNumber = (suffix ? parseInt(suffix[1], 10) : 0) + 1;

  const assignments: Array<{ heatIndex: number; boatId: number }> = [];
  sortedHeats.forEach((heat, sourceIndex) => {
    if (mode === 'pre-assigned') {
      // Sort with the shared SHRS 3 comparator (numeric-aware sail numbers) so
      // the next round seeds boats in the same order as the first round; SQL
      // ORDER BY sorts "10" before "9".
      const boats = [...(boatsByHeatId.get(heat.heat_id) ?? [])].sort(
        (left, right) =>
          compareByCountryThenSail(left, right) ||
          String(left.boat_id).localeCompare(String(right.boat_id)),
      );
      boats.forEach((boat) => {
        assignments.push({ heatIndex: sourceIndex, boatId: boat.boat_id });
      });
      return;
    }

    const rankedBoatIds = rankedBoatIdsByHeatId.get(heat.heat_id);
    if (!rankedBoatIds) return;
    rankedBoatIds.forEach((boatId, rankIndex) => {
      assignments.push({
        heatIndex: getNextHeatIndexByMovementTable(
          sourceIndex,
          rankIndex + 1,
          sortedHeats.length,
        ),
        boatId,
      });
    });
  });

  if (assignments.length === 0) {
    const heatList = sortedHeats.map((heat) => heat.heat_name).join(', ');
    const cause =
      mode === 'pre-assigned'
        ? 'Those heats have no boats assigned to them.'
        : 'Those heats have no recorded results to move boats from.';
    return {
      ok: false,
      refusal: `Cannot build round ${roundNumber}: no boats could be assigned from ${heatList}. ${cause} Check that the previous round is fully scored before redistributing.`,
    };
  }

  return {
    ok: true,
    roundNumber,
    heatNames,
    assignments,
    heatCount: sortedHeats.length,
  };
}
