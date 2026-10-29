import { POSITION_KEEPING_PENALTIES } from './penaltyOrder';
import {
  getOrderedBoatNumbers,
  normalizeBoatNumber,
  pruneTies,
  reorderBoats,
  tieKey,
} from './finishOrder';
import type { SailNumber } from './finishOrder';

/**
 * What the scorer has entered for one heat so far, and the edits that change
 * it. Every edit is a pure function of the previous state, so the scoring
 * screen can apply them through a reducer: two quick clicks in one tick each
 * see the other's result, which a handler closing over the last render cannot
 * promise.
 *
 * Finishing places are NOT stored: they follow from the order and the ties
 * (`buildPlaceNumbers`), so they cannot disagree with them.
 */
export interface FinishEntryState {
  /** The finish order, SHRS 5.3 penalty ordering already applied. */
  boatNumbers: SailNumber[];
  /** Penalty code per boat (a boat with none has no key). */
  penalties: Record<string, string>;
  /** RRS A7 dead heats: keys are `tieKey(lower, upper)`, see finishOrder. */
  ties: Set<string>;
  /**
   * Boats (normalised) that are in the order ONLY because a penalty was picked
   * for them — never clicked or typed. Clearing the penalty takes them out
   * again instead of leaving them behind as orphan finishers.
   */
  autoAdded: Set<string>;
}

export const emptyFinishEntry = (): FinishEntryState => ({
  boatNumbers: [],
  penalties: {},
  ties: new Set(),
  autoAdded: new Set(),
});

/** An entered-but-unsubmitted result exists (a place or a penalty counts). */
export const hasFinishEntry = (state: FinishEntryState): boolean =>
  state.boatNumbers.length > 0 || Object.keys(state.penalties).length > 0;

const without = (set: Set<string>, value: string): Set<string> => {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
};

/**
 * Add boats to the finish order. Comparison is on normalised values, so typed
 * input ("101") matches sail numbers stored as numbers or strings; boats that
 * are not in the heat, or already listed, are left out.
 */
export function addFinishers(
  state: FinishEntryState,
  validBoats: SailNumber[],
  sailNumbers: SailNumber[],
): FinishEntryState {
  const existing = new Set(state.boatNumbers.map(normalizeBoatNumber));
  const validSet = new Set(validBoats.map(normalizeBoatNumber));
  const validNew = sailNumbers.filter((n) => {
    const normalized = normalizeBoatNumber(n);
    if (existing.has(normalized) || !validSet.has(normalized)) return false;
    existing.add(normalized);
    return true;
  });
  if (validNew.length === 0) return state;

  // An explicit add overrides any penalty-only auto-add bookkeeping.
  const autoAdded = new Set(state.autoAdded);
  validNew.forEach((n) => autoAdded.delete(normalizeBoatNumber(n)));

  return {
    ...state,
    boatNumbers: getOrderedBoatNumbers(
      [...state.boatNumbers, ...validNew],
      state.penalties,
    ),
    autoAdded,
  };
}

export function removeFinisher(
  state: FinishEntryState,
  index: number,
): FinishEntryState {
  if (index < 0 || index >= state.boatNumbers.length) return state;
  const remaining = [...state.boatNumbers];
  const [removed] = remaining.splice(index, 1);

  const penalties = { ...state.penalties };
  delete penalties[removed];

  const boatNumbers = getOrderedBoatNumbers(remaining, penalties);
  return {
    boatNumbers,
    penalties,
    ties: pruneTies(boatNumbers, penalties, state.ties),
    autoAdded: without(state.autoAdded, normalizeBoatNumber(removed)),
  };
}

/** Move a boat within the order; unchanged when the move is not possible. */
export function moveFinisher(
  state: FinishEntryState,
  fromIndex: number,
  toIndex: number,
): FinishEntryState {
  const next = reorderBoats(
    state.boatNumbers,
    state.penalties,
    state.ties,
    fromIndex,
    toIndex,
  );
  if (!next) return state;
  return { ...state, boatNumbers: next.boats, ties: next.ties };
}

/**
 * Set or clear a boat's penalty. Picking one adds a boat that is not in the
 * order yet (and remembers that the penalty alone put it there); clearing it
 * takes such a boat out again, but keeps a boat that was added as a finisher.
 */
export function setBoatPenalty(
  state: FinishEntryState,
  boatNumber: SailNumber,
  penalty: string,
): FinishEntryState {
  const norm = normalizeBoatNumber(boatNumber);
  const wasAutoAdded = state.autoAdded.has(norm);
  const wasInList = state.boatNumbers.some(
    (b) => normalizeBoatNumber(b) === norm,
  );

  const autoAdded = new Set(state.autoAdded);
  let { boatNumbers } = state;
  if (penalty) {
    if (!wasInList) {
      autoAdded.add(norm);
      boatNumbers = [...boatNumbers, boatNumber];
    }
  } else {
    autoAdded.delete(norm);
    if (wasAutoAdded) {
      boatNumbers = boatNumbers.filter((b) => normalizeBoatNumber(b) !== norm);
    }
  }

  const penalties = { ...state.penalties, [boatNumber]: penalty };
  if (!penalty) delete penalties[boatNumber];

  const ordered = getOrderedBoatNumbers(boatNumbers, penalties);
  return {
    boatNumbers: ordered,
    penalties,
    ties: pruneTies(ordered, penalties, state.ties),
    autoAdded,
  };
}

/**
 * Toggle an RRS A7 dead heat: mark or unmark this boat as tied with the boat
 * directly above it in the finish order.
 */
export function toggleTie(
  state: FinishEntryState,
  boatNumber: SailNumber,
  index: number,
): FinishEntryState {
  if (index < 1 || index >= state.boatNumbers.length) return state;
  const key = tieKey(boatNumber, state.boatNumbers[index - 1]);
  const ties = new Set(state.ties);
  if (ties.has(key)) ties.delete(key);
  else ties.add(key);
  return { ...state, ties };
}

export interface ScoringProgress {
  scoredCount: number;
  totalBoats: number;
  /** Every boat of the heat has a place or a penalty. */
  allScored: boolean;
  /** The heat has no boats at all. */
  isEmpty: boolean;
}

/** Every boat (normalised) that has a place or a penalty entered. */
const enteredBoats = (
  state: Pick<FinishEntryState, 'boatNumbers' | 'penalties'>,
): Set<string> =>
  new Set(
    [...state.boatNumbers, ...Object.keys(state.penalties)].map(
      normalizeBoatNumber,
    ),
  );

/** How many of the heat's boats already have a place or a penalty. */
export function scoringProgress(
  validBoats: SailNumber[],
  state: Pick<FinishEntryState, 'boatNumbers' | 'penalties'>,
): ScoringProgress {
  const assigned = enteredBoats(state);
  const scoredCount = validBoats.filter((sail) =>
    assigned.has(normalizeBoatNumber(sail)),
  ).length;
  const totalBoats = validBoats.length;
  return {
    scoredCount,
    totalBoats,
    allScored: totalBoats > 0 && scoredCount === totalBoats,
    isEmpty: totalBoats === 0,
  };
}

/**
 * The boats that were reported missing by a failed submit AND still have
 * neither a place nor a penalty. A boat leaves the list the moment it gets
 * one (and comes back if that is taken away again before the next submit).
 */
export function stillMissingBoats(
  marked: SailNumber[],
  state: Pick<FinishEntryState, 'boatNumbers' | 'penalties'>,
): SailNumber[] {
  if (marked.length === 0) return marked;
  const assigned = enteredBoats(state);
  return marked.filter((sail) => !assigned.has(normalizeBoatNumber(sail)));
}

/** How many missing boats the warning names before it says "and N more". */
const MAX_NAMED_MISSING = 6;

/**
 * The short line a failed submit shows: which boats are still missing. The
 * boat table marks every one of them, so a long list is cut off here.
 */
export function missingBoatsLine(missing: SailNumber[]): string {
  const named = missing
    .slice(0, MAX_NAMED_MISSING)
    .map((sail) => `sail ${sail}`)
    .join(', ');
  const more = missing.length - MAX_NAMED_MISSING;
  return more > 0
    ? `Still missing: ${named} and ${more} more.`
    : `Still missing: ${named}.`;
}

/** Entered boats (places or penalties) that are not boats of the heat. */
export function findSubmittedStrangers(
  validBoats: SailNumber[],
  state: Pick<FinishEntryState, 'boatNumbers' | 'penalties'>,
): string[] {
  const valid = new Set(validBoats.map(normalizeBoatNumber));
  return [...enteredBoats(state)].filter((boat) => !valid.has(boat));
}

export interface PlaceFormat {
  sep?: string;
  placeSuffix?: string;
  emptyFallback?: string;
}

/**
 * A boat's finishing place + penalty code. Position-keeping penalties
 * (ZFP/SCP/T1) retain the finishing place, so it is shown alongside the code;
 * other penalties have no finishing place, so the code alone is correct.
 * `sep`/`placeSuffix`/`emptyFallback` adapt it to each display context.
 */
export function formatPlaceDisplay(
  place: number | undefined,
  penalty: string | undefined,
  { sep = ' · ', placeSuffix = '', emptyFallback = '—' }: PlaceFormat = {},
): string {
  const placeText = `${place}${placeSuffix}`;
  if (penalty) {
    return POSITION_KEEPING_PENALTIES.has(penalty) && place
      ? `${placeText}${sep}${penalty}`
      : penalty;
  }
  return place ? placeText : emptyFallback;
}
