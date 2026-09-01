/* eslint-disable no-nested-ternary */
import React, { useState, useEffect } from 'react';
import { reportError, reportInfo, reportWarning } from '../utils/userFeedback';
import {
  POSITION_KEEPING_PENALTIES,
  orderBoatsByPenalty,
} from '../utils/penaltyOrder';
import {
  FINISH_ENTRY_PENALTY_CODES,
  penaltyLabel,
} from '../constants/penaltyLabels';
import { heatRaceDB } from '../api/db';

type SailNumber = string | number;

export interface ScoringBoat {
  boat_id: number;
  name: string;
  surname: string;
  country: string | null;
  sail_number: SailNumber;
}

export interface ScoringHeat {
  heat_id: number;
  heat_name: string;
  raceNumber?: number;
  boats: ScoringBoat[];
}

/** One boat's scored result, emitted to onSubmit. */
export interface ScoredBoat {
  boatNumber: SailNumber;
  place: number;
  status: string;
}

interface ScoringInputComponentProps {
  heat: ScoringHeat;
  onSubmit: (boatPlaces: ScoredBoat[]) => void | Promise<void>;
  /** Notifies the parent when a not-yet-submitted finish order exists, so it
   * can guard navigation away from the scoring view. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface FormatPlaceOptions {
  sep?: string;
  placeSuffix?: string;
  emptyFallback?: string;
}

// Plain-language labels so non-expert scorers know what each code means. Sourced
// from the shared penaltyLabels module so entry and leaderboard-edit stay in sync.
const PENALTY_OPTIONS = FINISH_ENTRY_PENALTY_CODES.map((value) => ({
  value,
  label: penaltyLabel(value),
}));

/**
 * Editable finishing-place field for a plain finisher: type a number and press
 * Enter (or blur) to move that boat directly to that place, instead of clicking
 * ↑/↓ one step at a time. Commits on blur/Enter so typing "12" doesn't reorder
 * on the intermediate "1".
 */
function FinishPlaceInput({
  place,
  max,
  sail,
  onCommit,
}: {
  place: number;
  max: number;
  sail: SailNumber;
  onCommit: (newPlace: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(place);

  const commit = () => {
    if (draft !== null && draft !== '') {
      const parsed = parseInt(draft, 10);
      if (!Number.isNaN(parsed)) {
        // Warn if the parsed value differs from what the user typed (e.g.
        // decimal "3.5" silently truncated to 3, or scientific "2e1"→2).
        if (String(parsed) !== draft.trim()) {
          reportWarning(
            `"${draft}" was interpreted as place ${parsed}. Type a whole number.`,
            'Place adjusted',
          );
        }
        onCommit(parsed);
      }
    }
    setDraft(null);
  };

  return (
    <input
      className="finish-place-input"
      type="number"
      min={1}
      max={max}
      value={value}
      aria-label={`Finishing place for sail ${sail} (currently ${place})`}
      title="Type a place and press Enter to move this boat there"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function ScoringInputComponent({
  heat,
  onSubmit,
  onDirtyChange = () => {},
}: ScoringInputComponentProps) {
  const [inputValue, setInputValue] = useState('');
  const [boatNumbers, setBoatNumbers] = useState<SailNumber[]>([]);
  const [validBoats, setValidBoats] = useState<SailNumber[]>([]);
  const [placeNumbers, setPlaceNumbers] = useState<Record<string, number>>({});
  const [penalties, setPenalties] = useState<Record<string, string>>({});
  // RRS A7 dead heats: boats tied with the boat above share a finishing place.
  // Keys are normalized sail numbers; presence means "tied with the boat above".
  const [ties, setTies] = useState<Set<string>>(new Set());
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [invalidBoatNumbers, setInvalidBoatNumbers] = useState<SailNumber[]>(
    [],
  );
  // Guards against a double-submit writing the same heat twice (SHRS integrity):
  // the button is locked from the first click until the atomic write settles.
  const [submitting, setSubmitting] = useState(false);
  // Inline error state so a boat-fetch failure shows a persistent banner with a
  // Retry button, not just a fleeting toast.
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Bumped from the error banner's Retry button to re-trigger the fetch effect
  // without changing heat.heat_id.
  const [fetchToken, setFetchToken] = useState(0);
  // Tracks boats that were added to the finish order SOLELY by selecting a
  // penalty (never explicitly clicked or typed). When the penalty is cleared,
  // these boats are removed from the finish order instead of becoming orphan
  // finishers.
  const autoAddedByPenalty = React.useRef<Set<string>>(new Set());
  // Focus the sail-number input as soon as a heat opens for scoring, so an RO can
  // read the finish order aloud and type straight away without reaching for the
  // mouse. Re-runs when switching heats.
  const addInputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    addInputRef.current?.focus();
  }, [heat.heat_id]);

  const normalizeBoatNumber = (value: SailNumber): string =>
    value != null ? String(value).trim() : '';
  // Identity key for an RRS A7 tie between two ADJACENT boats. Encoding both
  // boats (not just the lower one) means a tie can never silently rebind to a
  // different boat when the boat above is removed or displaced.
  const tieKey = (lower: SailNumber, upper: SailNumber): string =>
    `${normalizeBoatNumber(lower)}::${normalizeBoatNumber(upper)}`;
  const compareBoatNumbers = (a: SailNumber, b: SailNumber): number =>
    normalizeBoatNumber(a).localeCompare(normalizeBoatNumber(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  const buildPlaceNumbers = (
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

  // Drop tie markers that are no longer valid: boats removed from the finish
  // order, or boats that now carry a displacing penalty (they are no longer
  // "tied at the finishing line" — SHRS 5.3 sends them to the end).
  const pruneTies = (
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
  const getOrderedBoatNumbers = (
    boats: SailNumber[],
    penaltiesByBoat: Record<string, string>,
  ): SailNumber[] =>
    orderBoatsByPenalty(boats, penaltiesByBoat, compareBoatNumbers);
  const isValidBoatNumber = (boatNumber: SailNumber): boolean =>
    validBoats
      .map((value) => normalizeBoatNumber(value))
      .includes(normalizeBoatNumber(boatNumber));

  useEffect(() => {
    let isActive = true;

    setInputValue('');
    setBoatNumbers([]);
    setValidBoats([]);
    setPlaceNumbers({});
    setPenalties({});
    setTies(new Set());
    setDraggingIndex(null);
    setDropIndex(null);
    setInvalidBoatNumbers([]);
    setFetchError(null);
    autoAddedByPenalty.current = new Set();

    const fetchBoats = async () => {
      try {
        const boats = await heatRaceDB.readBoatsByHeat(heat.heat_id);
        if (!isActive) return;
        setValidBoats(boats.map((boat) => boat.sail_number));
        setFetchError(null);
      } catch (error) {
        if (!isActive) return;
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        setFetchError(message);
        reportError('Could not load boats for selected heat.', error);
      }
    };

    fetchBoats();

    return () => {
      isActive = false;
    };
  }, [heat.heat_id, fetchToken]);

  // Tell the parent whenever an unsubmitted finish order exists so it can warn
  // before navigating away (a place or a penalty counts as work-in-progress).
  useEffect(() => {
    onDirtyChange(boatNumbers.length > 0 || Object.keys(penalties).length > 0);
  }, [boatNumbers, penalties, onDirtyChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  // Shared logic: add a list of sail numbers to the ranked list.
  // Comparison is done on normalized values so typed input ("101") matches
  // sail numbers stored as either numbers or strings.
  const addBoatsToList = (sailNumbers: SailNumber[]) => {
    const existing = new Set(boatNumbers.map(normalizeBoatNumber));
    const validSet = new Set(validBoats.map(normalizeBoatNumber));
    const validNew = sailNumbers.filter((n) => {
      const normalized = normalizeBoatNumber(n);
      if (existing.has(normalized) || !validSet.has(normalized)) return false;
      existing.add(normalized);
      return true;
    });
    if (validNew.length === 0) return;

    const merged = [...boatNumbers, ...validNew];
    const ordered = getOrderedBoatNumbers(merged, penalties);
    setBoatNumbers(ordered);
    setPlaceNumbers(buildPlaceNumbers(ordered, ties));
  };

  // Clicking a row immediately adds the boat — no separate button press needed
  const handleBoatClick = (sailNumber: SailNumber) => {
    if (boatNumbers.includes(sailNumber)) return;
    // Explicit click overrides any penalty-only auto-add tracking.
    autoAddedByPenalty.current.delete(normalizeBoatNumber(sailNumber));
    addBoatsToList([sailNumber]);
  };

  const handleAddBoats = () => {
    const tokens = inputValue
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const unique = [...new Set(tokens.map(normalizeBoatNumber))];
    // Map typed values to the canonical sail number from this heat so that
    // the rest of the component works with one consistent value per boat.
    const canonicalBySail = new Map(
      validBoats.map((value) => [normalizeBoatNumber(value), value]),
    );
    const invalidInput = unique.filter((n) => !canonicalBySail.has(n));
    if (invalidInput.length > 0) {
      reportWarning(
        `These sail numbers are not in ${heat.heat_name}: ${invalidInput.join(', ')}.\n\n` +
          'Check the boat list on the left for valid sail numbers, or verify the heat assignment.',
        'Unknown sail numbers',
      );
    }
    const alreadyInOrder = new Set(boatNumbers.map(normalizeBoatNumber));
    const validCanonical = unique.filter((n) => canonicalBySail.has(n));
    const newlyAdded = validCanonical.filter((n) => !alreadyInOrder.has(n));
    // Every typed number was valid but already scored, and nothing else was
    // added — without this note the input just clears and the action looks
    // like it silently failed.
    if (
      newlyAdded.length === 0 &&
      validCanonical.length > 0 &&
      invalidInput.length === 0
    ) {
      reportInfo(
        `Already in the finish order: ${validCanonical
          .map((n) => canonicalBySail.get(n))
          .join(', ')}`,
        'No change',
      );
    }
    addBoatsToList(newlyAdded.map((n) => canonicalBySail.get(n) as SailNumber));
    setInputValue('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddBoats();
    }
  };

  const handleRemoveBoat = (index: number) => {
    const updatedBoatNumbers = [...boatNumbers];
    const removedBoat = updatedBoatNumbers.splice(index, 1)[0];

    const updatedPenalties = { ...penalties };
    delete updatedPenalties[removedBoat];

    const ordered = getOrderedBoatNumbers(updatedBoatNumbers, updatedPenalties);
    const prunedTies = pruneTies(ordered, updatedPenalties, ties);
    setBoatNumbers(ordered);
    setPlaceNumbers(buildPlaceNumbers(ordered, prunedTies));
    setTies(prunedTies);
    setPenalties(updatedPenalties);
  };

  const handleReorderBoat = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex > boatNumbers.length || fromIndex === toIndex) {
      return;
    }
    const updatedBoatNumbers = [...boatNumbers];
    const [movedBoat] = updatedBoatNumbers.splice(fromIndex, 1);
    updatedBoatNumbers.splice(toIndex, 0, movedBoat);
    const ordered = getOrderedBoatNumbers(updatedBoatNumbers, penalties);
    // A reorder can break an RRS A7 tie's adjacency, so prune stale ties (as
    // remove/penalty already do) before recomputing places.
    const prunedTies = pruneTies(ordered, penalties, ties);
    setBoatNumbers(ordered);
    setPlaceNumbers(buildPlaceNumbers(ordered, prunedTies));
    setTies(prunedTies);
  };

  const handleDragStart = (index: number) => {
    setDraggingIndex(index);
  };

  const handleDragOver =
    (index: number) => (e: React.DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      // The <ul> also has an onDragOver for the tail zone (drop after the last
      // item). Without stopping propagation, that handler fires after this one
      // and overwrites dropIndex with boatNumbers.length, so every drop lands at
      // the end and the per-item indicator never shows.
      e.stopPropagation();
      setDropIndex(index);
    };

  const handleDrop = () => {
    if (draggingIndex !== null && dropIndex !== null) {
      handleReorderBoat(draggingIndex, dropIndex);
    }
    setDraggingIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDropIndex(null);
  };

  const handlePenaltyChange = (boatNumber: SailNumber, penalty: string) => {
    const norm = normalizeBoatNumber(boatNumber);
    const wasAutoAdded = autoAddedByPenalty.current.has(norm);
    const wasInList = boatNumbers.some((b) => normalizeBoatNumber(b) === norm);

    if (penalty) {
      // Auto-add the boat if it's not already in the finish order.
      if (!wasInList) {
        autoAddedByPenalty.current.add(norm);
      }
    } else {
      // Penalty cleared. If the boat was auto-added (only present because of
      // a penalty selection), remove it entirely; otherwise keep it as a
      // finisher (it was explicitly added via click/type).
      autoAddedByPenalty.current.delete(norm);
    }

    let nextBoatNumbers = [...boatNumbers];
    if (penalty && !wasInList) {
      nextBoatNumbers = [...boatNumbers, boatNumber];
    } else if (!penalty && wasAutoAdded) {
      nextBoatNumbers = boatNumbers.filter(
        (b) => normalizeBoatNumber(b) !== norm,
      );
    }

    const newPenalties = { ...penalties, [boatNumber]: penalty };
    if (!penalty) delete newPenalties[boatNumber];

    const ordered = getOrderedBoatNumbers(nextBoatNumbers, newPenalties);
    const prunedTies = pruneTies(ordered, newPenalties, ties);
    setBoatNumbers(ordered);
    setPlaceNumbers(buildPlaceNumbers(ordered, prunedTies));
    setTies(prunedTies);
    setPenalties(newPenalties);
  };

  // Toggle an RRS A7 dead heat: mark/unmark this boat as tied with the boat
  // directly above it in the finish order, then recompute the shared places.
  const handleToggleTie = (boatNumber: SailNumber, index: number) => {
    if (index < 1) return;
    const key = tieKey(boatNumber, boatNumbers[index - 1]);
    const next = new Set(ties);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setTies(next);
    setPlaceNumbers(buildPlaceNumbers(boatNumbers, next));
  };

  // Synchronous guard so rapid clicks that all hit the warning path (before
  // setSubmitting(true) runs) don't produce duplicate toasts.
  const submitGuardRef = React.useRef(false);

  const handleSubmit = async () => {
    // Ignore re-entrant clicks while a submit is already in flight.
    if (submitting || submitGuardRef.current) return;
    submitGuardRef.current = true;
    // Prevent creating an empty race when the heat has no boats.
    if (validBoats.length === 0) {
      reportInfo(
        'This heat has no boats assigned — nothing to score.',
        'Empty heat',
      );
      submitGuardRef.current = false;
      return;
    }
    const submittedBoatNumbers = [
      ...new Set(
        [...boatNumbers, ...Object.keys(penalties)].map(normalizeBoatNumber),
      ),
    ];
    const invalidSubmitted = submittedBoatNumbers.filter(
      (boatNumber) => !isValidBoatNumber(boatNumber),
    );

    if (invalidSubmitted.length > 0) {
      setInvalidBoatNumbers(invalidSubmitted.map((v) => Number(v) || v));
      reportWarning(
        `These sail numbers are not in ${heat.heat_name}: ${invalidSubmitted.join(', ')}.\n\n` +
          'Remove them from finish order and score only boats in this heat.',
        'Invalid sail numbers',
      );
      submitGuardRef.current = false;
      return;
    }

    setInvalidBoatNumbers([]);

    const allBoats = [...new Set([...boatNumbers, ...validBoats])];
    const orderedBoatNumbers = getOrderedBoatNumbers(boatNumbers, penalties);
    const boatPlaces: ScoredBoat[] = [];
    const includedBoats = new Set<SailNumber>();
    let finishingPlace = 1;
    let penaltyPlace: number | null = null;

    orderedBoatNumbers.forEach((boatNumber) => {
      includedBoats.add(boatNumber);
      const penalty = penalties[boatNumber];
      if (!penalty) {
        boatPlaces.push({
          boatNumber,
          // RRS A7: use the tie-aware place so boats dead-heated at the line
          // submit the same place (the next boat skips to place + 1).
          place: placeNumbers[boatNumber],
          status: 'FINISHED',
        });
        finishingPlace += 1;
        return;
      }

      if (POSITION_KEEPING_PENALTIES.has(penalty)) {
        // A position-keeping penalty (ZFP/SCP/T1) keeps its finishing place —
        // which, when the boat is tied, is the shared place, not the running
        // counter (RRS A7).
        boatPlaces.push({
          boatNumber,
          place: placeNumbers[boatNumber],
          status: penalty,
        });
        finishingPlace += 1;
        return;
      }

      if (penaltyPlace === null) {
        penaltyPlace = finishingPlace;
      }

      boatPlaces.push({
        boatNumber,
        place: penaltyPlace,
        status: penalty,
      });
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
      [...boatNumbers, ...Object.keys(penalties)].map((value) =>
        normalizeBoatNumber(value),
      ),
    );
    const allBoatsAccountedFor = allBoats.every((boatNumber) =>
      assignedBoatNumbers.has(normalizeBoatNumber(boatNumber)),
    );

    if (allBoatsAccountedFor) {
      setSubmitting(true);
      try {
        await onSubmit(boatPlaces);
      } finally {
        // On success the parent unmounts this view; on a warning/error path it
        // stays mounted, so re-enable the button either way.
        setSubmitting(false);
        submitGuardRef.current = false;
      }
    } else {
      const missingBoats = allBoats.filter(
        (boatNumber) =>
          !assignedBoatNumbers.has(normalizeBoatNumber(boatNumber)),
      );
      reportWarning(
        `Still missing: sail ${missingBoats.join(', sail ')}.\n\n` +
          'Every boat needs a finishing place or a penalty before you can submit. ' +
          'Click the missing boats in the left table to add them, or pick a penalty (e.g. DNS if a boat did not start).',
        'Some boats are not scored yet',
      );
      submitGuardRef.current = false;
    }
  };

  // Render a boat's finishing place + penalty code. Position-keeping penalties
  // (ZFP/SCP/T1) retain the finishing place, so show it alongside the code;
  // other penalties have no finishing place, so the code alone is correct.
  // `sep`/`placeSuffix`/`emptyFallback` adapt it to each display context.
  const formatPlaceDisplay = (
    sailNumber: SailNumber,
    {
      sep = ' · ',
      placeSuffix = '',
      emptyFallback = '—',
    }: FormatPlaceOptions = {},
  ): string => {
    const place = placeNumbers[sailNumber];
    const placeText = `${place}${placeSuffix}`;
    const penalty = penalties[sailNumber];
    if (penalty) {
      return POSITION_KEEPING_PENALTIES.has(penalty) && place
        ? `${placeText}${sep}${penalty}`
        : penalty;
    }
    return place ? placeText : emptyFallback;
  };

  const getPlaceDisplay = (sailNumber: SailNumber): string =>
    formatPlaceDisplay(sailNumber);

  const isInvalidSail = (sailNumber: SailNumber): boolean =>
    invalidBoatNumbers
      .map((n) => normalizeBoatNumber(n))
      .includes(normalizeBoatNumber(sailNumber));

  const assignedSet = new Set(
    [...boatNumbers, ...Object.keys(penalties)].map((value) =>
      normalizeBoatNumber(value),
    ),
  );
  const scoredCount = validBoats.filter((sail) =>
    assignedSet.has(normalizeBoatNumber(sail)),
  ).length;
  const totalBoats = validBoats.length;
  const allScored = totalBoats > 0 && scoredCount === totalBoats;
  const isEmpty = totalBoats === 0;

  return (
    <div className="scoring-layout">
      {/* Left panel — boat list */}
      <div className="scoring-panel">
        <h2 className="scoring-panel-title">{heat.heat_name} — Boats</h2>
        {fetchError && (
          <div role="alert" className="fetch-error-banner">
            <p>Could not load boats: {fetchError}</p>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setFetchError(null);
                setFetchToken((t) => t + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {!fetchError && (
          <>
            <p className="scoring-hint">
              Click a row or select a penalty to include the boat in scoring
            </p>
            <div className="scoring-table-wrap">
              <table className="scoring-table">
                <thead>
                  <tr>
                    <th scope="col">Sailor</th>
                    <th scope="col">Country</th>
                    <th scope="col">Sail #</th>
                    <th scope="col" className="scoring-place-cell">
                      Place
                    </th>
                    <th scope="col">Penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {heat.boats.map((boat) => {
                    const added = boatNumbers.includes(boat.sail_number);
                    const invalid = isInvalidSail(boat.sail_number);
                    return (
                      <tr
                        key={boat.boat_id}
                        onClick={() => handleBoatClick(boat.sail_number)}
                        className={`${added ? 'is-added' : ''}${invalid ? ' is-invalid' : ''}`}
                        title={
                          added
                            ? `Already added at place ${getPlaceDisplay(boat.sail_number)}`
                            : 'Click to add to finish order'
                        }
                      >
                        <td>
                          {boat.name} {boat.surname}
                          {/* Always rendered (hidden until added) so adding the
                          check never reflows the row. */}
                          <span
                            className={`scoring-added-check${added ? '' : ' is-placeholder'}`}
                            aria-hidden={!added}
                          >
                            ✓
                          </span>
                        </td>
                        <td>{boat.country}</td>
                        <td className="scoring-sail-cell">
                          {boat.sail_number}
                        </td>
                        <td
                          className={`scoring-place-cell${added ? ' is-added' : ''}`}
                        >
                          {getPlaceDisplay(boat.sail_number)}
                        </td>
                        <td>
                          <select
                            className="penalty-select"
                            value={penalties[boat.sail_number] || ''}
                            onChange={(e) =>
                              handlePenaltyChange(
                                boat.sail_number,
                                e.target.value,
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Penalty for sail ${boat.sail_number}`}
                          >
                            <option value="">None</option>
                            {PENALTY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Right panel — finish order */}
      <div className="scoring-panel scoring-panel-right">
        <h2 className="scoring-panel-title">
          Finish Order
          {typeof heat.raceNumber === 'number'
            ? ` — Race ${heat.raceNumber + 1}`
            : ''}
        </h2>

        {/* Sticky action bar: progress + submit stay visible no matter how
            long the finish list grows. */}
        <div className="finish-actionbar">
          {/* Progress indicator so the user always knows how many boats remain */}
          <p
            id="finish-progress-status"
            aria-live="polite"
            className={`finish-progress${allScored ? ' is-done' : ''}`}
          >
            {isEmpty
              ? 'No boats in this heat'
              : allScored
                ? `All ${totalBoats} boats scored — ready to submit ✓`
                : `${scoredCount} of ${totalBoats} boats scored — ${totalBoats - scoredCount} remaining`}
          </p>
          {/* The button stays actionable even when not all boats are scored: a
              click surfaces a warning naming the missing boats, which is more
              helpful than a dead disabled control. So it must NOT claim
              aria-disabled (that would tell assistive tech it's inert while it
              still acts). Readiness is conveyed by the aria-live status above,
              referenced here via aria-describedby. */}
          <button
            type="button"
            className={`btn-success submit-scores-btn${allScored ? '' : ' is-unavailable'}`}
            aria-describedby="finish-progress-status"
            disabled={submitting}
            title={
              isEmpty
                ? 'No boats to score in this heat'
                : allScored
                  ? undefined
                  : 'Score every boat (a place or a penalty) before submitting'
            }
            onClick={handleSubmit}
          >
            {submitting ? 'Saving…' : 'Submit Scores'}
          </button>
        </div>

        {/* Manual number input */}
        <div className="finish-add-row">
          <input
            ref={addInputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder="Type sail numbers (e.g. 101 205 88), press Enter"
            aria-label="Add sail numbers manually"
          />
          <button
            type="button"
            className="finish-add-btn"
            onClick={handleAddBoats}
            aria-label="Add sail number to finish order"
          >
            Add
          </button>
        </div>

        {/* Ranked list */}
        <ul
          className="finish-list"
          onDragOver={(e) => {
            e.preventDefault();
            // Allow dropping at the very end of the list (after the last item).
            setDropIndex(boatNumbers.length);
          }}
        >
          {boatNumbers.map((number, index) => (
            <React.Fragment key={number}>
              {dropIndex === index && <div className="drop-indicator" />}
              <li
                data-invalid={isInvalidSail(number)}
                className={`finish-item${isInvalidSail(number) ? ' is-invalid' : ''}`}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={handleDragOver(index)}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
              >
                {penalties[number] ? (
                  <span className="finish-place">
                    {formatPlaceDisplay(number, { sep: ' ', placeSuffix: '.' })}
                  </span>
                ) : (
                  <FinishPlaceInput
                    place={placeNumbers[number]}
                    max={boatNumbers.length}
                    sail={number}
                    onCommit={(newPlace) =>
                      handleReorderBoat(
                        index,
                        Math.min(Math.max(newPlace, 1), boatNumbers.length) - 1,
                      )
                    }
                  />
                )}
                <span className="finish-label">
                  Sail #{number}
                  {isInvalidSail(number) && (
                    <span className="finish-not-in-heat">Not in this heat</span>
                  )}
                </span>
                {(() => {
                  const p = penalties[number];
                  const isDisplacing = Boolean(
                    p && !POSITION_KEEPING_PENALTIES.has(p),
                  );
                  const isTied =
                    index > 0 &&
                    ties.has(tieKey(number, boatNumbers[index - 1]));
                  return (
                    <>
                      <button
                        type="button"
                        className="finish-move-btn"
                        aria-label={`Move sail ${number} up`}
                        onClick={() => handleReorderBoat(index, index - 1)}
                        disabled={index === 0 || isDisplacing}
                        title={
                          isDisplacing
                            ? `Boats with ${p} stay at the end of the finish order (SHRS 5.3)`
                            : 'Move up'
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="finish-move-btn"
                        aria-label={`Move sail ${number} down`}
                        onClick={() => handleReorderBoat(index, index + 1)}
                        disabled={
                          index === boatNumbers.length - 1 || isDisplacing
                        }
                        title={
                          isDisplacing
                            ? `Boats with ${p} stay at the end of the finish order (SHRS 5.3)`
                            : 'Move down'
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={`finish-tie-btn${isTied ? ' is-tied' : ''}`}
                        aria-label={`Sail ${number} tied with the boat above`}
                        aria-pressed={isTied}
                        onClick={() => handleToggleTie(number, index)}
                        disabled={index === 0 || isDisplacing}
                        title={
                          index === 0
                            ? 'The first boat cannot be tied with a boat above'
                            : isDisplacing
                              ? 'Penalised boats are not tied at the finishing line'
                              : isTied
                                ? 'Untie from the boat above (RRS A7 dead heat)'
                                : 'Tie with the boat above (RRS A7 dead heat)'
                        }
                      >
                        =
                      </button>
                    </>
                  );
                })()}
                <button
                  type="button"
                  className="finish-remove-btn"
                  onClick={() => handleRemoveBoat(index)}
                  aria-label={`Remove sail ${number} from finish order`}
                  title="Remove"
                >
                  ✕
                </button>
              </li>
            </React.Fragment>
          ))}
          {dropIndex === boatNumbers.length && (
            <div className="drop-indicator" />
          )}
        </ul>

        {invalidBoatNumbers.length > 0 && (
          <div role="alert" className="invalid-count-pill">
            {invalidBoatNumbers.length} invalid sail
            {invalidBoatNumbers.length === 1 ? '' : 's'} in finish order
          </div>
        )}
      </div>
    </div>
  );
}

export default ScoringInputComponent;
