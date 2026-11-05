import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import HeatComponent from '../../components/HeatComponent';
import ScoringInputComponent from '../../components/ScoringInputComponent';
import Navbar from '../../components/Navbar';
import EventHeader from '../../components/shared/EventHeader';
import LoadingState from '../../components/shared/LoadingState';
import './HeatRacePage.css';
import { reportWarning } from '../../utils/userFeedback';
import type { HeatWithBoats } from '../../utils/heatView';
import useRouteEvent from '../../hooks/useRouteEvent';
import useHeatList from '../../hooks/useHeatList';
import useRoundActions from '../../hooks/useRoundActions';
import useScoringSession from '../../hooks/useScoringSession';

function HeatRacePage() {
  const { eventName } = useParams();
  const event = useRouteEvent(eventName);
  // The same heat list HeatComponent shows (one query): whether the Final
  // Series has started and how many qualifying groups there are can never
  // disagree with it, also while the scoring view hides it.
  const heatList = useHeatList(event?.event_id);
  const { finalSeriesStarted, numQualifyingGroups } = heatList;

  const scoring = useScoringSession({
    event,
    finalSeriesStarted,
    numQualifyingGroups,
  });
  const { selectedHeat, isScoring, isSubmitting, closeScoring } = scoring;
  const rounds = useRoundActions({ event, finalSeriesStarted });

  // The heat list is read again after any change to the event — also one made
  // in the history (an undo, going back) while this heat is being scored.
  // If the heat is gone or has been raced since it was opened, leave its
  // scoring view, rather than let a finish order be submitted into a heat
  // that changed. (Our own submit changes it too: not while it runs, and it
  // closes the view itself.)
  const { loadedHeats, loading: heatsLoading } = heatList;
  useEffect(() => {
    if (!isScoring || !selectedHeat || isSubmitting) return;
    if (!loadedHeats || heatsLoading) return;
    const now = loadedHeats.find(
      (heat) => heat.heat_id === selectedHeat.heat_id,
    );
    if (!now || now.raceNumber !== (selectedHeat.raceNumber ?? 0)) {
      closeScoring();
      reportWarning(
        `${selectedHeat.heat_name} changed in the history while you were scoring it, so its scoring was closed. Nothing was saved for it; open it again if it still needs scoring.`,
        'Heat changed',
      );
    }
  }, [
    loadedHeats,
    heatsLoading,
    isScoring,
    isSubmitting,
    selectedHeat,
    closeScoring,
  ]);

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
            onScoreHeat={scoreHeat}
            onUndoLastRace={rounds.undoLastRace}
            onCreateRound={rounds.createNewHeats}
            onUndoRedistribution={rounds.undoRedistribution}
            rowActionsDisabled={rounds.roundActionBusy}
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
                eventId={event.event_id}
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
