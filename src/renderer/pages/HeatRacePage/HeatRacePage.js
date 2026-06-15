/* eslint-disable camelcase */
import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import HeatComponent from '../../components/HeatComponent';
import ScoringInputComponent from '../../components/ScoringInputComponent';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import './HeatRacePage.css';
import {
  confirmAction,
  reportError,
  reportInfo,
} from '../../utils/userFeedback';
import { eventDB, heatRaceDB } from '../../api/db';

function HeatRacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { eventName } = useParams();
  const [event, setEvent] = useState(location.state?.event || null);
  const [selectedHeat, setSelectedHeat] = useState(null);
  const [isScoring, setIsScoring] = useState(false);
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

  const handleHeatSelect = (heat) => {
    setSelectedHeat(heat);
  };

  const handleStartScoring = () => {
    setIsScoring(true);
  };

  const handleBackToHeats = () => {
    setIsScoring(false);
  };

  const handleSubmitScores = async (placeNumbers) => {
    try {
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
          if (!proceed) return;
        }
      }

      // Penalty math, race + score inserts, and the leaderboard recompute all
      // happen atomically in the main process (see submitHeatRaceScoresAtomic).
      const result = await heatRaceDB.submitHeatRaceScoresAtomic({
        event_id: event.event_id,
        heat_id: selectedHeat.heat_id,
        placeNumbers,
        isFinalSeries: finalSeriesStarted,
      });

      if (result?.ok === false && result.reason === 'UNMATCHED_SAILS') {
        reportInfo(
          `Cannot save scores because these sail numbers are not in ${selectedHeat.heat_name}: ${result.unmatched.join(', ')}.\n\n` +
            'What to do:\n' +
            '1) Go back to heats and re-open scoring for this heat.\n' +
            '2) Check that each sail number belongs to the selected heat.\n' +
            '3) Re-enter the race results and submit again.',
          'Invalid sail number mapping',
        );
        return;
      }

      setIsScoring(false);
      setSelectedHeat({ ...selectedHeat, raceNumber: result.raceNumber });
    } catch (error) {
      reportError('Could not save race scores.', error);
    }
  };

  const handleCreateNewHeatsBasedOnLeaderboard = async () => {
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
      const result = await heatRaceDB.createNewHeatsBasedOnLeaderboard(
        event.event_id,
      );
      if (result?.advisory) {
        reportInfo(result.advisory, 'SHRS advisory');
      }
      refreshHeats();
    } catch (error) {
      reportError('Could not create new heats from leaderboard.', error);
    }
  };

  // Contextual action: invoked from inside the selected heat card.
  const handleUndoLastScoredRace = async (heat) => {
    const confirmed = await confirmAction(
      `Undo the last scored race in "${heat.heat_name}"?\n\nThis will permanently delete that race's scores.`,
      'Undo Last Race',
    );
    if (!confirmed) return;

    try {
      const result = await heatRaceDB.undoLastScoredRaceForHeat(heat.heat_id);
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
    const confirmed = await confirmAction(
      'Undo latest heat redistribution?\n\nThis will delete the latest qualifying heats and all their boat assignments. This cannot be undone.',
      'Undo Heat Redistribution',
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = await heatRaceDB.undoLatestHeatRedistribution(
        event.event_id,
      );
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

  if (!event) {
    return null;
  }

  return (
    <div>
      <Navbar />

      <main id="main-content" className="page-wrapper" tabIndex={-1}>
        <Breadcrumbs
          items={[
            { label: 'Home', onClick: () => navigate('/') },
            {
              label: event?.event_name || 'Event',
              onClick: () =>
                navigate(`/event/${event.event_name}`, { state: { event } }),
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
              onUndoLastRace={
                !finalSeriesStarted ? handleUndoLastScoredRace : null
              }
              onQualifyingGroupCountChange={setNumQualifyingGroups}
              clickable
            />
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-ghost back-link"
              onClick={handleBackToHeats}
            >
              <i className="fa fa-arrow-left" aria-hidden="true" /> Back to
              Heats
            </button>
            <ScoringInputComponent
              heat={selectedHeat}
              onSubmit={handleSubmitScores}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default HeatRacePage;
