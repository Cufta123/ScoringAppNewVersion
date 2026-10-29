import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { heatRaceDB } from '../api/db';
import { entryKeysFor } from '../../shared/boatKeys';
import useExclusiveAction from './useExclusiveAction';
import {
  describeError,
  reportError,
  reportInfo,
  reportWarning,
} from '../utils/userFeedback';
import {
  buildPlaceNumbers,
  buildScoredRace,
  normalizeBoatNumber,
} from '../utils/finishOrder';
import type { SailNumber, ScoredBoat } from '../utils/finishOrder';
import {
  addFinishers,
  emptyFinishEntry,
  findSubmittedStrangers,
  formatPlaceDisplay,
  hasFinishEntry,
  missingBoatsLine,
  moveFinisher,
  removeFinisher,
  scoringProgress,
  setBoatPenalty,
  stillMissingBoats,
  toggleTie,
} from '../utils/finishEntry';
import type { FinishEntryState } from '../utils/finishEntry';
import { resolveTypedSails, tokenizeSailInput } from '../utils/sailInput';

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

interface Options {
  heat: ScoringHeat;
  onSubmit: (boatPlaces: ScoredBoat[]) => void | Promise<void>;
  /** Told whenever an unsubmitted finish order exists (or stops existing). */
  onDirtyChange: (dirty: boolean) => void;
}

type EntryEdit = (state: FinishEntryState) => FinishEntryState;
const applyEdit = (state: FinishEntryState, edit: EntryEdit) => edit(state);

/**
 * State and actions behind the scoring-entry screen: the boats of the heat as
 * the database has them, the finish order being typed in, and the submit.
 * The finish-order rules are in utils/finishEntry and utils/finishOrder; this
 * wires them to React and to the heat's IPC read.
 */
export default function useScoringInput({
  heat,
  onSubmit,
  onDirtyChange,
}: Options) {
  const [entry, edit] = useReducer(applyEdit, undefined, emptyFinishEntry);
  const [validBoats, setValidBoats] = useState<SailNumber[]>([]);
  const [invalidBoatNumbers, setInvalidBoatNumbers] = useState<string[]>([]);
  // The boats the last failed submit named as missing, and a counter that
  // changes with every failed submit (the boat table scrolls to the first one
  // each time). A boat is shown as missing only while it still has neither a
  // place nor a penalty (see `missingSails` below).
  const [missingMarked, setMissingMarked] = useState<SailNumber[]>([]);
  const [missingToken, setMissingToken] = useState(0);
  // Inline error state so a boat-fetch failure shows a persistent banner with a
  // Retry button, not just a fleeting toast.
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Bumped by Retry to re-trigger the fetch effect without changing the heat.
  const [fetchToken, setFetchToken] = useState(0);
  // Guards against a double-submit writing the same heat twice (SHRS
  // integrity): locked from the first click until the atomic write settles.
  const { busy: submitting, runExclusive } = useExclusiveAction();

  // The name each boat is entered by: her sail number, or "ITA 12" when
  // another boat in the heat is also 12.
  const heatKeys = useMemo(() => entryKeysFor(heat.boats), [heat.boats]);
  const entryKeyOf = useCallback(
    (boat: ScoringBoat): string =>
      heatKeys.get(String(boat.boat_id)) ?? String(boat.sail_number),
    [heatKeys],
  );
  const boatByKey = useMemo(() => {
    const byKey = new Map<string, ScoringBoat>();
    heat.boats.forEach((boat) => {
      const key = entryKeyOf(boat);
      if (!byKey.has(key)) byKey.set(key, boat);
    });
    return byKey;
  }, [heat.boats, entryKeyOf]);

  // Reset and load the heat's boats whenever the heat changes (or on Retry).
  useEffect(() => {
    let isActive = true;

    edit(() => emptyFinishEntry());
    setValidBoats([]);
    setInvalidBoatNumbers([]);
    setMissingMarked([]);
    setFetchError(null);

    const fetchBoats = async () => {
      try {
        const boats = await heatRaceDB.readBoatsByHeat(heat.heat_id);
        if (!isActive) return;
        const keys = entryKeysFor(boats);
        setValidBoats(boats.map((boat) => keys.get(String(boat.boat_id))!));
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
  const dirty = hasFinishEntry(entry);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const placeNumbers = useMemo(
    () => buildPlaceNumbers(entry.boatNumbers, entry.ties),
    [entry.boatNumbers, entry.ties],
  );
  const progress = useMemo(
    () => scoringProgress(validBoats, entry),
    [validBoats, entry],
  );
  const missingSails = useMemo(
    () =>
      new Set(stillMissingBoats(missingMarked, entry).map(normalizeBoatNumber)),
    [missingMarked, entry],
  );
  const isMissingSail = useCallback(
    (sailNumber: SailNumber): boolean =>
      missingSails.has(normalizeBoatNumber(sailNumber)),
    [missingSails],
  );
  const invalidSails = useMemo(
    () => new Set(invalidBoatNumbers.map(normalizeBoatNumber)),
    [invalidBoatNumbers],
  );
  const isInvalidSail = useCallback(
    (sailNumber: SailNumber): boolean =>
      invalidSails.has(normalizeBoatNumber(sailNumber)),
    [invalidSails],
  );

  const getPlaceDisplay = (sailNumber: SailNumber): string =>
    formatPlaceDisplay(placeNumbers[sailNumber], entry.penalties[sailNumber]);

  // Clicking a row immediately adds the boat — no separate button needed.
  const addBoat = useCallback(
    (sailNumber: SailNumber) =>
      edit((state) => addFinishers(state, validBoats, [sailNumber])),
    [validBoats],
  );

  /** Add what was typed into the sail-number field ("101 205 ITA 12"). */
  const addTyped = (text: string) => {
    const { validKeys, ambiguous, unknown } = resolveTypedSails(
      tokenizeSailInput(text),
      heat.boats.map((boat) => ({ ...boat, key: entryKeyOf(boat) })),
    );
    if (ambiguous.length > 0) {
      reportWarning(
        ambiguous
          .map(
            ({ number, options }) =>
              `Sail ${number} is in ${heat.heat_name} more than once: type ${options.join(' or ')}, or click the boat in the list.`,
          )
          .join('\n'),
        'Which boat?',
      );
    }
    if (unknown.length > 0) {
      reportWarning(
        `These sail numbers are not in ${heat.heat_name}: ${unknown.join(', ')}.\n\n` +
          'Check the boat list on the left for valid sail numbers, or verify the heat assignment.',
        'Unknown sail numbers',
      );
    }
    const alreadyInOrder = new Set(entry.boatNumbers.map(normalizeBoatNumber));
    const newlyAdded = validKeys.filter((key) => !alreadyInOrder.has(key));
    // Every typed number was valid but already scored, and nothing else was
    // added — without this note the input just clears and the action looks
    // like it silently failed.
    if (
      newlyAdded.length === 0 &&
      validKeys.length > 0 &&
      unknown.length === 0 &&
      ambiguous.length === 0
    ) {
      reportInfo(
        `Already in the finish order: ${validKeys.join(', ')}`,
        'No change',
      );
    }
    edit((state) => addFinishers(state, validBoats, newlyAdded));
  };

  const removeBoat = useCallback(
    (index: number) => edit((state) => removeFinisher(state, index)),
    [],
  );
  const moveBoat = useCallback(
    (fromIndex: number, toIndex: number) =>
      edit((state) => moveFinisher(state, fromIndex, toIndex)),
    [],
  );
  const changePenalty = useCallback(
    (boatNumber: SailNumber, penalty: string) =>
      edit((state) => setBoatPenalty(state, boatNumber, penalty)),
    [],
  );
  const toggleBoatTie = useCallback(
    (boatNumber: SailNumber, index: number) =>
      edit((state) => toggleTie(state, boatNumber, index)),
    [],
  );

  const retryFetch = () => {
    setFetchError(null);
    setFetchToken((token) => token + 1);
  };

  const submit = async () => {
    // Ignore re-entrant clicks while a submit is already in flight.
    if (submitting) return;
    // Prevent creating an empty race when the heat has no boats.
    if (validBoats.length === 0) {
      reportInfo(
        'This heat has no boats assigned — nothing to score.',
        'Empty heat',
      );
      return;
    }
    const strangers = findSubmittedStrangers(validBoats, entry);
    if (strangers.length > 0) {
      setInvalidBoatNumbers(strangers);
      reportWarning(
        `These sail numbers are not in ${heat.heat_name}: ${strangers.join(', ')}.\n\n` +
          'Remove them from finish order and score only boats in this heat.',
        'Invalid sail numbers',
      );
      return;
    }
    setInvalidBoatNumbers([]);

    const { boatPlaces, missingBoats } = buildScoredRace({
      boatNumbers: entry.boatNumbers,
      penalties: entry.penalties,
      placeNumbers,
      validBoats,
    });
    if (missingBoats.length > 0) {
      // The boat table marks and scrolls to the missing boats, so the warning
      // only has to say which ones and what to do about them.
      setMissingMarked(missingBoats);
      setMissingToken((token) => token + 1);
      reportWarning(
        `${missingBoatsLine(missingBoats)}\n` +
          'Give each a place (click its row) or a penalty such as DNS.',
        'Some boats are not scored yet',
      );
      return;
    }
    setMissingMarked([]);

    try {
      // On success the parent unmounts this view; on a warning/error path it
      // stays mounted, so the button comes back either way.
      await runExclusive(async () => onSubmit(boatPlaces));
    } catch (error) {
      reportError('Could not save race scores.', error);
    }
  };

  return {
    boatNumbers: entry.boatNumbers,
    penalties: entry.penalties,
    ties: entry.ties,
    placeNumbers,
    ...progress,
    validBoats,
    invalidBoatNumbers,
    fetchError,
    submitting,
    entryKeyOf,
    boatByKey,
    isInvalidSail,
    isMissingSail,
    missingToken,
    getPlaceDisplay,
    addBoat,
    addTyped,
    removeBoat,
    moveBoat,
    changePenalty,
    toggleBoatTie,
    retryFetch,
    submit,
  };
}

export type ScoringInputState = ReturnType<typeof useScoringInput>;
