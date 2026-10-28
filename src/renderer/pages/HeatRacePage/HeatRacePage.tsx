import React, { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import HeatComponent from '../../components/HeatComponent';
import ScoringInputComponent from '../../components/ScoringInputComponent';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import LoadingState from '../../components/shared/LoadingState';
import './HeatRacePage.css';
import { reportError, reportWarning } from '../../utils/userFeedback';
import { heatRaceDB } from '../../api/db';
import { hasFinalHeats } from '../../utils/heatView';
import { useEventDataChanged } from '../../utils/eventDataChanged';
import useRouteEvent from '../../hooks/useRouteEvent';
import useRoundActions from '../../hooks/useRoundActions';
import useScoringSession from '../../hooks/useScoringSession';

function HeatRacePage() {
  const navigate = useNavigate();
  const { eventName } = useParams();
  const event = useRouteEvent(eventName);
  // Both reported by HeatComponent whenever its heats load, so the page's copy
  // can never go stale (and are re-read below when the history changes them).
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [numQualifyingGroups, setNumQualifyingGroups] = useState(0);
  // Bumped to tell HeatComponent to re-fetch its heats after a round-level
  // action (create-from-leaderboard, undo) without forcing a full remount.
  const [heatsRefreshToken, setHeatsRefreshToken] = useState(0);
  const refreshHeats = useCallback(() => {
    setHeatsRefreshToken((token) => token + 1);
  }, []);

  const scoring = useScoringSession({
    event,
    finalSeriesStarted,
    numQualifyingGroups,
  });
  const { selectedHeat, isScoring, closeScoring } = scoring;
  const rounds = useRoundActions({ event, finalSeriesStarted, refreshHeats });

  // After going back in the history (or an undo there) the heat being scored
  // may be gone or may have been raced already; leave its scoring view then,
  // rather than let a finish order be submitted into a heat that changed.
  const onEventDataChanged = useCallback(async () => {
    refreshHeats();
    if (!event?.event_id) return;
    try {
      const allHeats = await heatRaceDB.readAllHeats(event.event_id);
      setFinalSeriesStarted(hasFinalHeats(allHeats));
      if (isScoring && selectedHeat) {
        const stillThere = allHeats.some(
          (heat) => heat.heat_id === selectedHeat.heat_id,
        );
        const races = stillThere
          ? await heatRaceDB.readAllRaces(selectedHeat.heat_id)
          : [];
        if (!stillThere || races.length !== (selectedHeat.raceNumber ?? 0)) {
          closeScoring();
          reportWarning(
            `${selectedHeat.heat_name} changed in the history while you were scoring it, so its scoring was closed. Nothing was saved for it; open it again if it still needs scoring.`,
            'Heat changed',
          );
        }
      }
    } catch (error) {
      reportError('Could not reload the heats.', error);
    }
  }, [event?.event_id, isScoring, selectedHeat, refreshHeats, closeScoring]);
  useEventDataChanged(event?.event_id, onEventDataChanged);

  if (!event) {
    return <LoadingState label="Loading event…" />;
  }

  const goToEvent = () =>
    navigate(`/event/${event.event_name}`, { state: { event } });

  return (
    <div>
      <Navbar
        onNavigateHome={() => scoring.guardedNavigate(() => navigate('/'))}
        historyEventId={event.event_id}
      />

      <main id="main-content" className="page-wrapper" tabIndex={-1}>
        <Breadcrumbs
          items={[
            {
              label: 'Home',
              onClick: () => scoring.guardedNavigate(() => navigate('/')),
            },
            {
              label: event.event_name || 'Event',
              onClick: () => scoring.guardedNavigate(goToEvent),
            },
            isScoring
              ? { label: 'Heat Race', onClick: scoring.backToHeats }
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
            onClick={goToEvent}
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
              {event.event_name || 'Race Scoring'}
            </h1>

            {/* ── Round-level management actions ─── */}
            {/* SHRS 1.1: redistribution (sections 2-4) only applies when there are 2+ heats */}
            {!finalSeriesStarted && numQualifyingGroups >= 2 && (
              <div className="heatrace-actions">
                <button
                  type="button"
                  onClick={rounds.createNewHeats}
                  disabled={rounds.roundActionBusy}
                  aria-busy={rounds.roundActionBusy}
                >
                  Create New Heats from Leaderboard
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={rounds.undoRedistribution}
                  disabled={rounds.roundActionBusy}
                  aria-busy={rounds.roundActionBusy}
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
              onHeatSelect={scoring.selectHeat}
              onStartScoring={scoring.startScoring}
              onUndoLastRace={rounds.undoLastRace}
              rowActionsDisabled={rounds.roundActionBusy}
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
              onClick={scoring.backToHeats}
              disabled={scoring.isSubmitting}
              aria-busy={scoring.isSubmitting}
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
                onSubmit={scoring.submitScores}
                onDirtyChange={scoring.setHasUnsavedEntry}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default HeatRacePage;
