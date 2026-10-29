import { useCallback, useEffect, useRef, useState } from 'react';
import { heatRaceDB } from '../api/db';
import {
  confirmAction,
  reportError,
  reportInfo,
  reportWarning,
} from '../utils/userFeedback';
import { raceAgainWarning, unmatchedSailsMessage } from '../utils/heatRounds';
import type { ScoredBoat } from '../utils/finishOrder';
import type { EventRow } from '../types';
import type { ScoringHeat } from './useScoringInput';

interface SubmitResult {
  ok?: boolean;
  reason?: string;
  unmatched?: Array<string | number>;
  raceNumber?: number;
}

interface Options {
  event: EventRow | null;
  finalSeriesStarted: boolean;
  numQualifyingGroups: number;
}

/**
 * The scoring view of the Heat Race page: which heat is selected, whether its
 * score-entry screen is open, whether a finish order has been typed but not
 * submitted, the submit itself, and the guards that stop that finish order
 * being thrown away by accident (leaving the view, closing the window).
 */
export default function useScoringSession({
  event,
  finalSeriesStarted,
  numQualifyingGroups,
}: Options) {
  const [selectedHeat, setSelectedHeat] = useState<ScoringHeat | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  // True while the scoring view holds an entered-but-not-yet-submitted finish
  // order. Guards "Back to Heats" so a misclick can't silently discard it.
  const [hasUnsavedEntry, setHasUnsavedEntry] = useState(false);
  // Holds the in-flight submit so an exit path can await its REAL outcome
  // instead of guessing. Null whenever no submit is pending.
  const submitInFlightRef = useRef<Promise<boolean> | null>(null);
  // Mirrors the ref for rendering (a ref alone would not re-render the button).
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startScoring = useCallback(() => {
    setHasUnsavedEntry(false);
    setIsScoring(true);
  }, []);

  /** Leave the scoring view without asking (the heat itself changed). */
  const closeScoring = useCallback(() => {
    setIsScoring(false);
    setSelectedHeat(null);
    setHasUnsavedEntry(false);
  }, []);

  // Shared guard for any exit from the scoring view that would drop an
  // entered-but-unsubmitted finish order. Returns true when it is safe to leave.
  const confirmDiscardEntry = async (): Promise<boolean> => {
    // The user may have hit Submit and then immediately tried to leave. Wait
    // for the save to actually resolve rather than assuming it succeeded: on
    // success there is nothing left to discard, and on failure the entered
    // order must stay on screen, because it lives only in the scoring
    // component's local state and unmounting would lose it for good.
    const inFlight = submitInFlightRef.current;
    if (inFlight) return inFlight;
    if (!isScoring || !hasUnsavedEntry) return true;
    return confirmAction(
      'You have entered a finish order that has not been submitted yet. ' +
        'Leaving will discard it.',
      'Discard finish order?',
      {
        confirmLabel: 'Discard',
        cancelLabel: 'Keep scoring',
        confirmClassName: 'btn-danger',
      },
    );
  };

  // Navigate away from the scoring view, confirming first if there is unsaved
  // work. Used by the breadcrumbs and the Navbar brand so every exit path —
  // not just "Back to Heats" — is protected.
  const guardedNavigate = async (navigateAway: () => void) => {
    if (!(await confirmDiscardEntry())) return;
    setHasUnsavedEntry(false);
    navigateAway();
  };

  const backToHeats = async () => {
    if (!(await confirmDiscardEntry())) return;
    setHasUnsavedEntry(false);
    setIsScoring(false);
  };

  // Warn before closing/reloading the window while a finish order is entered
  // but not submitted, so it can't be lost to an accidental close.
  useEffect(() => {
    if (!(isScoring && hasUnsavedEntry)) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isScoring, hasUnsavedEntry]);

  const submitScores = async (placeNumbers: ScoredBoat[]) => {
    if (!selectedHeat || !event) return;
    // Resolves true only when the scores are actually persisted, so a
    // concurrent exit attempt can wait on the real result.
    const runSubmit = async (): Promise<boolean> => {
      // SHRS 3.2 warning: in a multi-heat qualifying series each heat group
      // should only ever race once before redistribution. Warn any time the
      // user tries to score a second (or later) race on a qualifying heat.
      if (!finalSeriesStarted && numQualifyingGroups >= 2) {
        const races = await heatRaceDB.readAllRaces(selectedHeat.heat_id);
        if (races.length >= 1) {
          const proceed = await confirmAction(
            raceAgainWarning(selectedHeat.heat_name, races.length),
            'Scoring warning',
            { confirmLabel: 'Score anyway' },
          );
          if (!proceed) return false;
        }
      }

      // Penalty math, race + score inserts, and the leaderboard recompute all
      // happen atomically in the main process (see submitHeatRaceScoresAtomic).
      const result = (await heatRaceDB.submitHeatRaceScoresAtomic({
        event_id: event.event_id,
        heat_id: selectedHeat.heat_id,
        placeNumbers,
        isFinalSeries: finalSeriesStarted,
      })) as SubmitResult;

      if (result?.ok === false) {
        if (result.reason === 'UNMATCHED_SAILS') {
          reportWarning(
            unmatchedSailsMessage(
              selectedHeat.heat_name,
              result.unmatched ?? [],
            ),
            'Invalid sail number mapping',
          );
        } else {
          // Not a refusal the app knows: treat it as a fault (code + log).
          reportError(
            'Could not save race scores. Nothing was saved.',
            new TypeError(`submit refused: ${String(result.reason)}`),
          );
        }
        return false;
      }

      setHasUnsavedEntry(false);
      setIsScoring(false);
      setSelectedHeat({ ...selectedHeat, raceNumber: result.raceNumber });
      reportInfo(
        `Race scores for "${selectedHeat.heat_name}" were saved.`,
        'Scores submitted',
      );
      return true;
    };

    // Publish the promise BEFORE awaiting it: runSubmit() only runs up to its
    // first await synchronously, so no click can interleave before the guard
    // can see it.
    const pending = runSubmit().catch((error) => {
      reportError('Could not save race scores.', error);
      return false;
    });
    submitInFlightRef.current = pending;
    setIsSubmitting(true);
    try {
      await pending;
    } finally {
      submitInFlightRef.current = null;
      setIsSubmitting(false);
    }
  };

  return {
    selectedHeat,
    selectHeat: setSelectedHeat,
    isScoring,
    isSubmitting,
    setHasUnsavedEntry,
    startScoring,
    closeScoring,
    backToHeats,
    guardedNavigate,
    submitScores,
  };
}
