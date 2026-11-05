import React, { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import HeatComponent from '../../components/HeatComponent';
import ScoringInputComponent from '../../components/ScoringInputComponent';
import Navbar from '../../components/Navbar';
import EventHeader from '../../components/shared/EventHeader';
import LoadingState from '../../components/shared/LoadingState';
import './HeatRacePage.css';
import { reportError, reportWarning } from '../../utils/userFeedback';
import { heatRaceDB } from '../../api/db';
import { hasFinalHeats, type HeatWithBoats } from '../../utils/heatView';
import { useEventDataChanged } from '../../utils/eventDataChanged';
import useRouteEvent from '../../hooks/useRouteEvent';
import useRoundActions from '../../hooks/useRoundActions';
import useScoringSession from '../../hooks/useScoringSession';

function HeatRacePage() {
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

  // A heat card's or the round bar's Score button: straight to the entry.
  const scoreHeat = (heat: HeatWithBoats) => {
    scoring.selectHeat(heat);
    scoring.startScoring();
  };

  return (
    <div>
      <Navbar
        event={event}
        section="scoring"
        guardNavigation={scoring.guardedNavigate}
      />

      <main id="main-content" className="page-wrapper" tabIndex={-1}>
        <EventHeader event={event} />

        {/* The way back to the entries is the navbar's Entries section; the
            scoring view keeps its own "Back to Heats". */}
        {!isScoring ? (
          <HeatComponent
            event={event}
            refreshToken={heatsRefreshToken}
            onScoreHeat={scoreHeat}
            onUndoLastRace={rounds.undoLastRace}
            onCreateRound={rounds.createNewHeats}
            onUndoRedistribution={rounds.undoRedistribution}
            rowActionsDisabled={rounds.roundActionBusy}
            onQualifyingGroupCountChange={setNumQualifyingGroups}
            onFinalSeriesStateChange={setFinalSeriesStarted}
          />
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
