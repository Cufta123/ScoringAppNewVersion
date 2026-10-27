import {
  POSITION_KEEPING_PENALTIES,
  orderBoatsByPenalty,
} from './penaltyOrder';

/**
 * The finish-order rules behind the scoring-entry screen: how a typed running
 * order becomes finishing places (RRS A7 ties included), which tie markers stay
 * valid as the order is edited, and what gets submitted for a race.
 *
 * These were plain functions inside ScoringInputComponent, so the RRS A7
 * adjacency rules and the SHRS 5.3 penalty ordering could only be exercised by
 * rendering the component and driving the DOM. They depend on nothing but their
 * arguments, so they live here and are directly testable.
 */

export type SailNumber = string | number;

/** One boat's scored result, as submitted for a race. */
export interface ScoredBoat {
  boatNumber: SailNumber;
  place: number;
  status: string;
}

export const normalizeBoatNumber = (value: SailNumber): string =>
  value != null ? String(value).trim() : '';

/**
 * Identity key for an RRS A7 tie between two ADJACENT boats. Encoding both
 * boats (not just the lower one) means a tie can never silently rebind to a
 * different boat when the boat above is removed or displaced.
 */
export const tieKey = (lower: SailNumber, upper: SailNumber): string =>
  `${normalizeBoatNumber(lower)}::${normalizeBoatNumber(upper)}`;

export const compareBoatNumbers = (a: SailNumber, b: SailNumber): number =>
  normalizeBoatNumber(a).localeCompare(normalizeBoatNumber(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

export const buildPlaceNumbers = (
  orderedBoats: SailNumber[],
  tiesSet: Set<string> = new Set(),
): Record<string, number> => {
  const newPlaceNumbers: Record<string, number> = {};
  let nextPlace = 1;
  orderedBoats.forEach((boat, index) => {
    // RRS A7: a boat tied with the one above shares its place. The skipped
    // place is recovered because `nextPlace` advances past every boat, tied
    // or not, so the next distinct finisher gets the correct place (e.g. two
    // boats tied for 1st → the next boat is 3rd).
    if (index > 0 && tiesSet.has(tieKey(boat, orderedBoats[index - 1]))) {
      newPlaceNumbers[boat] = newPlaceNumbers[orderedBoats[index - 1]];
    } else {
      newPlaceNumbers[boat] = nextPlace;
    }
    nextPlace += 1;
  });
  return newPlaceNumbers;
};

/**
 * Drop tie markers that are no longer valid: boats removed from the finish
 * order, or boats that now carry a displacing penalty (they are no longer
 * "tied at the finishing line" — SHRS 5.3 sends them to the end).
 */
export const pruneTies = (
  boats: SailNumber[],
  penaltiesByBoat: Record<string, string>,
  tiesSet: Set<string>,
): Set<string> => {
  const remaining = new Set(boats.map(normalizeBoatNumber));
  // Position of each boat in the (ordered) list. Tie keys are directional
  // adjacency pairs (`lower::upper`), so a tie is only valid while `upper`
  // sits directly above `lower` in the finish order.
  const indexOf = new Map<string, number>();
  boats.forEach((boat, index) => {
    indexOf.set(normalizeBoatNumber(boat), index);
  });
  const pruned = new Set<string>();
  tiesSet.forEach((key) => {
    const [lower, upper] = key.split('::');
    if (!remaining.has(lower) || !remaining.has(upper)) return;
    const lowerPenalty = penaltiesByBoat[lower];
    const upperPenalty = penaltiesByBoat[upper];
    if (
      (lowerPenalty && !POSITION_KEEPING_PENALTIES.has(lowerPenalty)) ||
      (upperPenalty && !POSITION_KEEPING_PENALTIES.has(upperPenalty))
    ) {
      return;
    }
    // A reorder can separate a tied pair; once they are no longer directly
    // adjacent the tie must be dropped, otherwise it silently re-activates if
    // adjacency is restored later.
    const lowerIndex = indexOf.get(lower);
    const upperIndex = indexOf.get(upper);
    if (lowerIndex === undefined || upperIndex === undefined) return;
    if (lowerIndex !== upperIndex + 1) return;
    pruned.add(key);
  });
  return pruned;
};

export const getOrderedBoatNumbers = (
  boats: SailNumber[],
  penaltiesByBoat: Record<string, string>,
): SailNumber[] =>
  orderBoatsByPenalty(boats, penaltiesByBoat, compareBoatNumbers);

/**
 * Move a boat within the finish order, re-applying SHRS 5.3 penalty ordering
 * and dropping tie markers the move invalidated.
 */
export const reorderBoats = (
  boats: SailNumber[],
  penaltiesByBoat: Record<string, string>,
  tiesSet: Set<string>,
  fromIndex: number,
  toIndex: number,
): {
  boats: SailNumber[];
  ties: Set<string>;
  places: Record<string, number>;
} | null => {
  if (toIndex < 0 || toIndex > boats.length || fromIndex === toIndex) {
    return null;
  }
  const moved = [...boats];
  const [boat] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, boat);
  const ordered = getOrderedBoatNumbers(moved, penaltiesByBoat);
  // A reorder can break an RRS A7 tie's adjacency, so prune stale ties (as
  // remove/penalty already do) before recomputing places.
  const ties = pruneTies(ordered, penaltiesByBoat, tiesSet);
  return { boats: ordered, ties, places: buildPlaceNumbers(ordered, ties) };
};

export interface ScoredRaceInput {
  /** The typed finish order. */
  boatNumbers: SailNumber[];
  penalties: Record<string, string>;
  /** Tie-aware places, from buildPlaceNumbers. */
  placeNumbers: Record<string, number>;
  /** Every boat assigned to the heat. */
  validBoats: SailNumber[];
}

export interface ScoredRace {
  boatPlaces: ScoredBoat[];
  /** Boats with neither a finishing place nor a penalty; empty means ready. */
  missingBoats: SailNumber[];
}

/**
 * Turn the entry screen's state into the payload submitted for a race.
 *
 * Finishers take their tie-aware place. Position-keeping penalties (ZFP/SCP/T1)
 * keep their finishing place too (RRS 44.3(c)/T1) — which, when the boat is
 * tied, is the shared place rather than the running counter. Every other
 * penalty holds no finishing place, so those boats are numbered consecutively
 * from the first penalty slot (SHRS 5.3 sends them after the finishers).
 */
export const buildScoredRace = ({
  boatNumbers,
  penalties,
  placeNumbers,
  validBoats,
}: ScoredRaceInput): ScoredRace => {
  const allBoats = [...new Set([...boatNumbers, ...validBoats])];
  const orderedBoatNumbers = getOrderedBoatNumbers(boatNumbers, penalties);
  const boatPlaces: ScoredBoat[] = [];
  const includedBoats = new Set<SailNumber>();
  let finishingPlace = 1;
  let penaltyPlace: number | null = null;

  orderedBoatNumbers.forEach((boatNumber) => {
    includedBoats.add(boatNumber);
    const penalty = penalties[boatNumber];

    if (!penalty || POSITION_KEEPING_PENALTIES.has(penalty)) {
      boatPlaces.push({
        boatNumber,
        place: placeNumbers[boatNumber],
        status: penalty || 'FINISHED',
      });
      finishingPlace += 1;
      return;
    }

    if (penaltyPlace === null) {
      penaltyPlace = finishingPlace;
    }
    boatPlaces.push({ boatNumber, place: penaltyPlace, status: penalty });
    penaltyPlace += 1;
  });

  // Defensive safety net: if a penalty exists for a valid boat that is not in
  // the ordered list, still include it in the submitted payload.
  validBoats.forEach((boatNumber) => {
    if (includedBoats.has(boatNumber) || !penalties[boatNumber]) return;
    if (penaltyPlace === null) {
      penaltyPlace = finishingPlace;
    }
    boatPlaces.push({
      boatNumber,
      place: penaltyPlace,
      status: penalties[boatNumber],
    });
    penaltyPlace += 1;
  });

  const assignedBoatNumbers = new Set(
    [...boatNumbers, ...Object.keys(penalties)].map(normalizeBoatNumber),
  );
  const missingBoats = allBoats.filter(
    (boatNumber) => !assignedBoatNumbers.has(normalizeBoatNumber(boatNumber)),
  );

  return { boatPlaces, missingBoats };
};
