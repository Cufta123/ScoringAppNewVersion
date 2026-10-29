import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { eventDB, heatRaceDB } from '../api/db';
import { minimumHeatsForEntries } from '../../shared/heatSizing';
import {
  confirmAction,
  getErrorMessage,
  reportError,
  reportInfo,
  reportWarning,
} from '../utils/userFeedback';
import {
  BOAT_DRAG_MIME,
  boatMoveQuestion,
  isHeatRecreateRefusal,
  isHeatSetupRefusal,
  parseBoatDrop,
} from '../utils/heatView';
import type { HeatWithBoats } from '../utils/heatView';
import type { HeatBoatRow } from '../types';

interface Options {
  eventId: number;
  refreshToken: number;
  heats: HeatWithBoats[];
  numQualifyingGroups: number;
  /** A race has been scored or the Final Series has started: heats are frozen. */
  heatsLocked: boolean;
  reloadHeats: () => Promise<void>;
  runExclusive: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * Setting up the heats: the number-of-heats choice, creating and recreating
 * them, and moving a boat between heats by drag and drop. Each action is meant
 * to be run through the caller's exclusive-action runner.
 */
export default function useHeatManagement({
  eventId,
  refreshToken,
  heats,
  numQualifyingGroups,
  heatsLocked,
  reloadHeats,
  runExclusive,
}: Options) {
  const heatsCreated = heats.length > 0;

  // SHRS 2.1, "the number of heats shall be as few as possible". This used to
  // default to 5 whatever the entry list said, so a club event of a dozen boats
  // got five heats of two or three unless someone thought to change it. The
  // shown count is the user's choice if they made one, else the split the
  // heats are already on (the useful default for "Recreate Heats"), else the
  // fewest heats the entry list allows. A choice is never overwritten.
  const [chosenHeatCount, setChosenHeatCount] = useState<number | null>(null);
  const [entryListHeatCount, setEntryListHeatCount] = useState(1);
  const hasChosen = chosenHeatCount !== null;

  // Seed the entry-list default. Runs while no heats exist (the only time the
  // default is shown) and stops as soon as the user picks a value, so adding a
  // boat cannot move a choice they already made.
  useEffect(() => {
    if (hasChosen || heatsCreated) return undefined;

    let cancelled = false;
    // Defensive on both sides: this is a convenience default, so neither a
    // read that rejects nor an unavailable channel should take the component
    // down. Worst case the dropdown keeps its current value, and the main
    // process still refuses a split that breaks SHRS 2.3.
    const seedFromEntryList = async () => {
      try {
        const entries = await eventDB.readBoatsByEvent(eventId);
        if (cancelled) return;
        const count = Array.isArray(entries) ? entries.length : 0;
        setEntryListHeatCount(minimumHeatsForEntries(count));
      } catch {
        // Keep whatever the control already shows.
      }
    };
    seedFromEntryList();
    return () => {
      cancelled = true;
    };
  }, [eventId, hasChosen, heatsCreated, refreshToken]);

  let numHeats = entryListHeatCount;
  if (chosenHeatCount !== null) numHeats = chosenHeatCount;
  else if (heatsCreated && numQualifyingGroups > 0) {
    numHeats = numQualifyingGroups;
  }

  const createHeats = useCallback(async () => {
    if (heatsLocked) {
      reportInfo(
        'Cannot create heats after a race has happened.',
        'Action blocked',
      );
      return;
    }

    try {
      // Validation (boats exist, SHRS 20-boat cap), SHRS 3 seeding order and
      // the SHRS 3.1 serpentine assignment all run in the main process inside
      // one transaction — a failure can never leave half-created heats.
      await heatRaceDB.createInitialHeatsAtomic(eventId, numHeats);
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('Heats already exist')) {
        reportInfo('Heats already exist for this event.', 'Action blocked');
        // Show them: the list on screen was evidently out of date.
        await reloadHeats();
        return;
      }
      // Surface the main process's plain-language validation messages
      // verbatim so the user knows exactly what to change, instead of a
      // generic "could not create" that hides the reason. Anything else is a
      // technical error and goes through reportError (detail to console only).
      if (isHeatSetupRefusal(message)) {
        reportWarning(message, 'Cannot create heats');
        return;
      }
      reportError('Could not create heats.', error);
      return;
    }
    reportInfo('Heats created successfully!', 'Success');
    await reloadHeats();
  }, [heatsLocked, eventId, numHeats, reloadHeats]);

  const recreateHeats = useCallback(async () => {
    if (heatsLocked) {
      reportInfo(
        'Cannot recreate heats after a race has happened.',
        'Action blocked',
      );
      return;
    }

    const confirmed = await confirmAction(
      'Recreate all heats?\n\nThe current heats and any manual boat moves between heats will be discarded, and boats will be re-assigned from scratch.',
      'Recreate heats',
      {
        confirmLabel: 'Recreate heats',
        cancelLabel: 'Keep current heats',
        confirmClassName: 'btn-danger',
      },
    );
    if (!confirmed) return;

    try {
      // One atomic call, not delete-then-create. Splitting it put the
      // destructive half first, so anything that made the create fail — a
      // duplicate sail number added since, an entry list that no longer fits
      // the chosen heat count — left the event with NO heats.
      await heatRaceDB.recreateInitialHeatsAtomic(eventId, numHeats);
    } catch (error) {
      const message = getErrorMessage(error);
      // The main process authors plain-language validation messages for these;
      // surface them verbatim so the user knows what to change. The heats they
      // already had are untouched either way.
      if (isHeatRecreateRefusal(message)) {
        reportWarning(message, 'Heats not changed');
        return;
      }
      reportError('Could not recreate heats.', error);
      return;
    }
    reportInfo('Heats recreated successfully!', 'Success');
    await reloadHeats();
  }, [heatsLocked, eventId, numHeats, reloadHeats]);

  const transferBoat = useCallback(
    async (boat: HeatBoatRow, fromHeatId: number, toHeatId: number) => {
      if (heatsLocked) {
        reportInfo(
          'Cannot transfer boats after a race has happened.',
          'Action blocked',
        );
        return;
      }

      // A drag-and-drop can happen by accident, and this reassigns a
      // competitor's heat — confirm first, like every other heat-mutating
      // action here.
      const fromHeat = heats.find((h) => h.heat_id === fromHeatId);
      const toHeat = heats.find((h) => h.heat_id === toHeatId);
      const confirmed = await confirmAction(
        boatMoveQuestion(boat, fromHeat?.heat_name, toHeat?.heat_name),
        'Move boat between heats',
        { confirmLabel: 'Move boat', confirmClassName: 'btn-success' },
      );
      if (!confirmed) return;

      try {
        await heatRaceDB.transferBoatBetweenHeats(
          fromHeatId,
          toHeatId,
          boat.boat_id,
        );
      } catch (error) {
        reportError('Could not transfer boat between heats.', error);
        return;
      }
      reportInfo('Boat transferred successfully!', 'Success');
      await reloadHeats();
    },
    [heatsLocked, heats, reloadHeats],
  );

  const dropBoat = useCallback(
    async (e: React.DragEvent, toHeatId: number) => {
      e.preventDefault();
      // Only accept payloads created by the drag start — dropping anything
      // foreign (text, files) must be ignored, not crash the handler.
      const dropped = parseBoatDrop(e.dataTransfer.getData(BOAT_DRAG_MIME));
      if (!dropped) return;
      if (dropped.fromHeatId === toHeatId) return; // dropped back onto its own heat
      await runExclusive(() =>
        transferBoat(dropped.boat, dropped.fromHeatId, toHeatId),
      );
    },
    [runExclusive, transferBoat],
  );

  return {
    numHeats,
    chooseHeatCount: setChosenHeatCount,
    createHeats,
    recreateHeats,
    dropBoat,
  };
}
