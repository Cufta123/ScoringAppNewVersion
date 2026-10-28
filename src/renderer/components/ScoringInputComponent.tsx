/* eslint-disable no-nested-ternary */
import React, { useState, useEffect } from 'react';
import {
  reportError,
  reportInfo,
  reportWarning,
  describeError,
} from '../utils/userFeedback';
import { POSITION_KEEPING_PENALTIES } from '../utils/penaltyOrder';
import {
  buildPlaceNumbers,
  buildScoredRace,
  getOrderedBoatNumbers,
  normalizeBoatNumber,
  pruneTies,
  reorderBoats,
  tieKey,
} from '../utils/finishOrder';
import type { ScoredBoat, SailNumber } from '../utils/finishOrder';
import {
  FINISH_ENTRY_PENALTY_CODES,
  penaltyLabel,
} from '../constants/penaltyLabels';
import { heatRaceDB } from '../api/db';
import {
  boatsByEntryName,
  entryKeysFor,
  normalizeEntryKey,
} from '../../shared/boatKeys';

export type { ScoredBoat };

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
    const typed = draft?.trim() ?? '';
    setDraft(null);
    if (draft === null || typed === '' || typed === String(place)) return;
    // Never guess: 2.5, 0 or a place past the last boat would move the boat
    // somewhere the scorer did not ask for, so the order stays as it was.
    if (!/^\d+$/.test(typed)) {
      reportWarning(
        `"${typed}" is not a place. Type a whole number from 1 to ${max}.`,
        'Place not changed',
      );
      return;
    }
    const parsed = Number(typed);
    if (parsed < 1 || parsed > max) {
      reportWarning(
        `There are ${max} boats in the finish order, so the place must be 1 to ${max}. Sail ${sail} stays at place ${place}.`,
        'Place not changed',
      );
      return;
    }
    onCommit(parsed);
  };

  return (
    // A text field, not type="number": a number field changes on the mouse
    // wheel and the arrow keys, which moved boats by accident.
    <input
      className="finish-place-input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={3}
      role="spinbutton"
      aria-valuemin={1}
      aria-valuemax={max}
      aria-valuenow={place}
      value={value}
      aria-label={`Finishing place for sail ${sail} (currently ${place})`}
      title={`Type a place from 1 to ${max} and press Enter to move this boat there`}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setDraft(null);
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

  const heatKeys = React.useMemo(() => entryKeysFor(heat.boats), [heat.boats]);
  const entryKeyOf = (boat: ScoringBoat): string =>
    heatKeys.get(String(boat.boat_id)) ?? String(boat.sail_number);

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
        const keys = entryKeysFor(boats);
        setValidBoats(boats.map((boat) => keys.get(String(boat.boat_id))!));
        setFetchError(null);
      } catch (error) {
        if (!isActive) return;
        setFetchError(describeError(error, 'loading the boats of a heat'));
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
    // "ITA 12" may be typed with a space, so letters join the number after.
    const tokens: string[] = [];
    inputValue
      .split(/[\s,;]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .forEach((token) => {
        const previous = tokens[tokens.length - 1];
        if (previous && /^[A-Za-z]{2,3}$/.test(previous) && /^\d/.test(token)) {
          tokens[tokens.length - 1] = `${previous} ${token}`;
        } else {
          tokens.push(token);
        }
      });
    // Every name that identifies a boat of this heat (sail number where it is
    // unique, national letters + number always) -> her entry key.
    const byName = boatsByEntryName(
      heat.boats.map((boat) => ({ ...boat, key: entryKeyOf(boat) })),
    );
    const unique = [...new Set(tokens.map(normalizeEntryKey))];
    // A number two boats share needs the national letters.
    const ambiguous = unique.filter(
      (n) =>
        !byName.has(n) &&
        heat.boats.filter((boat) => normalizeEntryKey(boat.sail_number) === n)
          .length > 1,
    );
    if (ambiguous.length > 0) {
      reportWarning(
        ambiguous
          .map(
            (n) =>
              `Sail ${n} is in ${heat.heat_name} more than once: type ${heat.boats
                .filter((boat) => normalizeEntryKey(boat.sail_number) === n)
                .map(entryKeyOf)
                .join(' or ')}, or click the boat in the list.`,
          )
          .join('\n'),
        'Which boat?',
      );
    }
    const invalidInput = unique.filter(
      (n) => !byName.has(n) && !ambiguous.includes(n),
    );
    if (invalidInput.length > 0) {
      reportWarning(
        `These sail numbers are not in ${heat.heat_name}: ${invalidInput.join(', ')}.\n\n` +
          'Check the boat list on the left for valid sail numbers, or verify the heat assignment.',
        'Unknown sail numbers',
      );
    }
    const alreadyInOrder = new Set(boatNumbers.map(normalizeBoatNumber));
    const validKeys = [
      ...new Set(
        unique.filter((n) => byName.has(n)).map((n) => byName.get(n)!.key),
      ),
    ];
    const newlyAdded = validKeys.filter((key) => !alreadyInOrder.has(key));
    // Every typed number was valid but already scored, and nothing else was
    // added — without this note the input just clears and the action looks
    // like it silently failed.
    if (
      newlyAdded.length === 0 &&
      validKeys.length > 0 &&
      invalidInput.length === 0 &&
      ambiguous.length === 0
    ) {
      reportInfo(
        `Already in the finish order: ${validKeys.join(', ')}`,
        'No change',
      );
    }
    addBoatsToList(newlyAdded);
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
    const next = reorderBoats(boatNumbers, penalties, ties, fromIndex, toIndex);
    if (!next) return;
    setBoatNumbers(next.boats);
    setPlaceNumbers(next.places);
    setTies(next.ties);
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

    const { boatPlaces, missingBoats } = buildScoredRace({
      boatNumbers,
      penalties,
      placeNumbers,
      validBoats,
    });

    if (missingBoats.length === 0) {
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
                    // The name this boat is entered by: her sail number, or
                    // "ITA 12" when another boat in the heat is also 12.
                    const key = entryKeyOf(boat);
                    const added = boatNumbers.includes(key);
                    const invalid = isInvalidSail(key);
                    return (
                      <tr
                        key={boat.boat_id}
                        onClick={() => handleBoatClick(key)}
                        className={`${added ? 'is-added' : ''}${invalid ? ' is-invalid' : ''}`}
                        title={
                          added
                            ? `Already added at place ${getPlaceDisplay(key)}`
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
                          {getPlaceDisplay(key)}
                        </td>
                        <td>
                          <select
                            className="penalty-select"
                            value={penalties[key] || ''}
                            onChange={(e) =>
                              handlePenaltyChange(key, e.target.value)
                            }
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Penalty for sail ${key}`}
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
                  <span className="finish-sail">Sail #{number}</span>
                  {(() => {
                    const boat = heat.boats.find(
                      (b) => entryKeyOf(b) === String(number),
                    );
                    const name = boat
                      ? `${boat.name ?? ''} ${boat.surname ?? ''}`.trim()
                      : '';
                    return name ? (
                      <span className="finish-name">{name}</span>
                    ) : null;
                  })()}
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
