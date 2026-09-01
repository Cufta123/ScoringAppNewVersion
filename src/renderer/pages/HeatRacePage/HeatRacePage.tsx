/* eslint-disable camelcase */
import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import HeatComponent from '../../components/HeatComponent';
import ScoringInputComponent, {
  type ScoringHeat,
  type ScoredBoat,
} from '../../components/ScoringInputComponent';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import LoadingState from '../../components/shared/LoadingState';
import './HeatRacePage.css';
import {
  confirmAction,
  reportError,
  reportInfo,
  reportWarning,
} from '../../utils/userFeedback';
import { eventDB, heatRaceDB } from '../../api/db';
import type { EventRow } from '../../types';

function HeatRacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { eventName } = useParams();
  const [event, setEvent] = useState<EventRow | null>(
    (location.state as { event?: EventRow } | null)?.event || null,
  );
  const [selectedHeat, setSelectedHeat] = useState<ScoringHeat | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  // True while the scoring view holds an entered-but-not-yet-submitted finish
  // order. Guards "Back to Heats" so a misclick can't silently discard it.
  const [hasUnsavedEntry, setHasUnsavedEntry] = useState(false);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  // Bumped to tell HeatComponent to re-fetch its heats after a round-level
  // action (create-from-leaderboard, undo) without forcing a full remount.
  const [heatsRefreshToken, setHeatsRefreshToken] = useState(0);
  const [numQualifyingGroups, setNumQualifyingGroups] = useState(0);

  const refreshHeats = useCallback(() => {
    setHeatsRefreshToken((token) => token + 1);
  }, []);

  // Refresh-safe: resolve the event from the URL when router state is gone.
  useEffect(() => {
    if (event) return undefined;
    let isActive = true;

    const findEventByName = async () => {
      try {
        const events = await eventDB.readAllEvents();
        if (!isActive) return;
        const match = (events || []).find((e) => e.event_name === eventName);
        if (match) {
          setEvent(match);
        } else {
          reportInfo(
            'This event could not be found. It may have been deleted or renamed.',
            'Event not found',
          );
          navigate('/');
        }
      } catch (error) {
        if (!isActive) return;
        reportError('Could not load event details.', error);
        navigate('/');
      }
    };

    findEventByName();
    return () => {
      isActive = false;
    };
  }, [event, eventName, navigate]);

  const handleHeatSelect = (heat: ScoringHeat) => {
    setSelectedHeat(heat);
  };

  const handleStartScoring = () => {
    setHasUnsavedEntry(false);
    setIsScoring(true);
  };

  // Holds the in-flight submit so an exit path can await its REAL outcome
  // instead of guessing. Null whenever no submit is pending.
  const submitInFlightRef = React.useRef<Promise<boolean> | null>(null);
  // Mirrors the ref for rendering (a ref alone would not re-render the button).
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Shared guard for any exit from the scoring view that would drop an
  // entered-but-unsubmitted finish order. Returns true when it is safe to leave.
  const confirmDiscardEntry = async (): Promise<boolean> => {
    // The user may have hit Submit and then immediately tried to leave. Wait
    // for the save to actually resolve rather than assuming it succeeded: on
    // success there is nothing left to discard, and on failure the entered
    // order must stay on screen, because it lives only in the scoring
    // component's local state and unmounting would lose it for good.
    const inFlight = submitInFlightRef.current;
    if (inFlight) {
      return inFlight;
    }
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
  // work. Used by the breadcrumbs and the Navbar brand so every exit path — not
  // just "Back to Heats" — is protected.
  const guardedNavigate = async (navFn: () => void) => {
    if (!(await confirmDiscardEntry())) return;
    setHasUnsavedEntry(false);
    navFn();
  };

  const handleBackToHeats = async () => {
    if (!(await confirmDiscardEntry())) return;
    setHasUnsavedEntry(false);
    setIsScoring(false);
  };

  const handleSubmitScores = async (placeNumbers: ScoredBoat[]) => {
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
          const nextRaceNumber = races.length + 1;
          const proceed = await confirmAction(
            `Warning: "${selectedHeat.heat_name}" has already completed Race ${races.length}.\n\n` +
              `According to SHRS 3.2 boats should be redistributed before racing again.\n\n` +
              `Press OK to score Race ${nextRaceNumber} anyway, or Cancel to go back and use "Create New Heats from Leaderboard" first.`,
            'Scoring warning',
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
      })) as {
        ok?: boolean;
        reason?: string;
        unmatched?: Array<string | number>;
        raceNumber?: number;
      };

      if (result?.ok === false) {
        if (result.reason === 'UNMATCHED_SAILS') {
          reportWarning(
            `Cannot save scores because these sail numbers are not in ${selectedHeat.heat_name}: ${(result.unmatched ?? []).join(', ')}.\n\n` +
              'What to do:\n' +
              '1) Go back to heats and re-open scoring for this heat.\n' +
              '2) Check that each sail number belongs to the selected heat.\n' +
              '3) Re-enter the race results and submit again.',
            'Invalid sail number mapping',
          );
        } else {
          reportError(
            `Could not save scores: ${result.reason || 'unknown error'}.`,
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

  const handleCreateNewHeatsBasedOnLeaderboard = async () => {
    if (!event) return;
    if (finalSeriesStarted) {
      reportInfo(
        'Cannot create new heats based on leaderboard after the final series has started.',
        'Action blocked',
      );
      return;
    }

    const confirmed = await confirmAction(
      'Create new heats based on the current leaderboard?\n\nAll heats in the current round must have the same number of races.',
      'Create New Heats',
    );
    if (!confirmed) return;

    try {
      const result = (await heatRaceDB.createNewHeatsBasedOnLeaderboard(
        event.event_id,
      )) as { advisory?: string } | null;
      if (result?.advisory) {
        reportInfo(result.advisory, 'SHRS advisory');
      }
      refreshHeats();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('No races found for heat')) {
        reportInfo(
          'The current round has not been raced yet — score each heat before creating the next round.',
          'Nothing to redistribute',
        );
        return;
      }
      reportError('Could not create new heats from leaderboard.', error);
    }
  };

  // Contextual action: invoked from inside the selected heat card.
  const handleUndoLastScoredRace = async (heat: ScoringHeat) => {
    // If a later round was already built from this round's results, the user
    // must know the redistribution will NOT be undone with the race.
    let laterRoundWarning = '';
    if (event) {
      try {
        const allHeats = await heatRaceDB.readAllHeats(event.event_id);
        const nameMatch = heat.heat_name.match(/Heat ([A-Z]+)(\d+)/);
        if (nameMatch) {
          const [, base, suffixText] = nameMatch;
          const suffix = parseInt(suffixText, 10);
          const hasLaterRound = (allHeats || []).some((other) => {
            const otherMatch = other.heat_name.match(/Heat ([A-Z]+)(\d+)/);
            return (
              otherMatch != null &&
              otherMatch[1] === base &&
              parseInt(otherMatch[2], 10) > suffix
            );
          });
          if (hasLaterRound) {
            laterRoundWarning =
              '\n\nWarning: a later round of heats was already created from ' +
              "this round's results. Undoing this race does NOT undo that " +
              'redistribution, so the next round will no longer match the ' +
              'results it was seeded from. Consider "Undo Heat ' +
              'Redistribution" first.';
          }
        }
      } catch (_error) {
        // Best-effort warning only — the confirm below still protects.
      }
    }

    const confirmed = await confirmAction(
      `Undo the last scored race in "${heat.heat_name}"?\n\nThis will permanently delete that race's scores.${laterRoundWarning}`,
      'Undo Last Race',
      { confirmLabel: 'Undo race', confirmClassName: 'btn-danger' },
    );
    if (!confirmed) return;

    try {
      const result = (await heatRaceDB.undoLastScoredRaceForHeat(
        heat.heat_id,
      )) as { raceNumber?: number; heatName?: string; removedScores?: number };
      refreshHeats();
      reportInfo(
        `Race ${result.raceNumber} in "${result.heatName}" has been undone.\n${result.removedScores} score(s) removed.`,
        'Success',
      );
    } catch (error) {
      reportError('Could not undo last race for selected heat.', error);
    }
  };

  const handleUndoLatestHeatRedistribution = async () => {
    if (!event) return;
    const confirmed = await confirmAction(
      'Undo latest heat redistribution?\n\nThis will delete the latest qualifying heats and all their boat assignments. This cannot be undone.',
      'Undo Heat Redistribution',
      { confirmLabel: 'Undo redistribution', confirmClassName: 'btn-danger' },
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = (await heatRaceDB.undoLatestHeatRedistribution(
        event.event_id,
      )) as { removedHeats?: number; removedAssignments?: number };
      refreshHeats();
      reportInfo(
        `Heat redistribution undone. Removed ${result.removedHeats} heats and ${result.removedAssignments} assignments.`,
        'Success',
      );
    } catch (error) {
      reportError('Could not undo latest heat redistribution.', error);
    }
  };

  const checkFinalSeriesStarted = useCallback(async () => {
    if (!event?.event_id) return;

    try {
      const allHeats = await heatRaceDB.readAllHeats(event.event_id);
      const finalHeats = allHeats.filter((heat) => heat.heat_type === 'Final');
      if (finalHeats.length > 0) {
        setFinalSeriesStarted(true);
      }
    } catch (error) {
      reportError('Could not check final series status.', error);
    }
  }, [event?.event_id]);

  useEffect(() => {
    checkFinalSeriesStarted();
  }, [checkFinalSeriesStarted]);

  // Warn before closing/reloading the window while a finish order is entered but
  // not submitted, so it can't be lost to an accidental close.
  useEffect(() => {
    if (!(isScoring && hasUnsavedEntry)) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isScoring, hasUnsavedEntry]);

  if (!event) {
    return <LoadingState label="Loading event…" />;
  }

  return (
    <div>
      <Navbar onNavigateHome={() => guardedNavigate(() => navigate('/'))} />

      <main id="main-content" className="page-wrapper" tabIndex={-1}>
        <Breadcrumbs
          items={[
            {
              label: 'Home',
              onClick: () => guardedNavigate(() => navigate('/')),
            },
            {
              label: event?.event_name || 'Event',
              onClick: () =>
                guardedNavigate(() =>
                  navigate(`/event/${event.event_name}`, { state: { event } }),
                ),
            },
            isScoring
              ? { label: 'Heat Race', onClick: handleBackToHeats }
              : { label: 'Heat Race' },
            ...(isScoring ? [{ label: 'Score Race' }] : []),
          ]}
        />

        {/* Back to the event page. In the scoring view the "Back to Heats"
            button below is the relevant step back, so only show this one in the
            heat-list view to avoid two stacked back buttons. */}
        {!isScoring && (
          <button
            type="button"
            className="btn-ghost back-link"
            onClick={() =>
              navigate(`/event/${event.event_name}`, { state: { event } })
            }
          >
            <i className="fa fa-arrow-left" aria-hidden="true" /> Back to Event
          </button>
        )}
        {!isScoring ? (
          <>
            <h1 style={{ marginBottom: '20px' }}>
              <i
                className="fa fa-flag-checkered"
                aria-hidden="true"
                style={{ color: '#2471A3' }}
              />
              {event?.event_name || 'Race Scoring'}
            </h1>

            {/* ── Round-level management actions ─── */}
            {/* SHRS 1.1: redistribution (sections 2-4) only applies when there are 2+ heats */}
            {!finalSeriesStarted && numQualifyingGroups >= 2 && (
              <div className="heatrace-actions">
                <button
                  type="button"
                  onClick={handleCreateNewHeatsBasedOnLeaderboard}
                >
                  Create New Heats from Leaderboard
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleUndoLatestHeatRedistribution}
                >
                  Undo Heat Redistribution
                </button>
              </div>
            )}

            {!selectedHeat && (
              <div className="info-banner">
                <i
                  className="fa fa-info-circle"
                  aria-hidden="true"
                  style={{ marginRight: '8px' }}
                />
                Click on a heat below to select it —{' '}
                <strong>Start Scoring</strong> and{' '}
                <strong>Undo Last Race</strong> appear inside the card.
              </div>
            )}

            <HeatComponent
              event={event}
              refreshToken={heatsRefreshToken}
              onHeatSelect={handleHeatSelect}
              onStartScoring={handleStartScoring}
              onUndoLastRace={handleUndoLastScoredRace}
              onQualifyingGroupCountChange={setNumQualifyingGroups}
              onFinalSeriesStateChange={setFinalSeriesStarted}
              clickable
            />
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-ghost back-link"
              onClick={handleBackToHeats}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              <i className="fa fa-arrow-left" aria-hidden="true" /> Back to
              Heats
            </button>
            {/* Persistent context so the scorer always knows which event and
                which series (Qualifying vs Final) they are scoring — the two
                have different SHRS scoring rules. */}
            <div className="scoring-context" role="status">
              <span className="scoring-context-event">
                <i className="fa fa-flag-checkered" aria-hidden="true" />{' '}
                {event.event_name}
              </span>
              <span
                className={`scoring-context-phase ${
                  finalSeriesStarted ? 'is-final' : 'is-qualifying'
                }`}
              >
                {finalSeriesStarted ? 'Final Series' : 'Qualifying Series'}
              </span>
              {selectedHeat && (
                <span className="scoring-context-heat">
                  {selectedHeat.heat_name}
                </span>
              )}
            </div>
            {selectedHeat && (
              <ScoringInputComponent
                heat={selectedHeat}
                onSubmit={handleSubmitScores}
                onDirtyChange={setHasUnsavedEntry}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default HeatRacePage;
