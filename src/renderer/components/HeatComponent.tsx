import React, { useMemo, useState } from 'react';
import useExclusiveAction from '../hooks/useExclusiveAction';
import useHeatList from '../hooks/useHeatList';
import useHeatManagement from '../hooks/useHeatManagement';
import useHeatSnapshots from '../hooks/useHeatSnapshots';
import useFinalSeriesStart from '../hooks/useFinalSeriesStart';
import useEventStatus from '../hooks/useEventStatus';
import type { HeatWithBoats } from '../utils/heatView';
import AppModal from './shared/AppModal';
import UnassignedEntriesNotice from './UnassignedEntriesNotice';
import HeatColumn from './heats/HeatColumn';
import HeatSetupBar from './heats/HeatSetupBar';
import RoundBar from './heats/RoundBar';
import HeatsExportDialog from './export/HeatsExportDialog';
import type { EventRow } from '../types';

export type { HeatWithBoats };

interface HeatComponentProps {
  event: EventRow;
  /** Open the scoring of this heat's next race. */
  onScoreHeat: (heat: HeatWithBoats) => void;
  onUndoLastRace?: ((heat: HeatWithBoats) => void) | null;
  /** Build the next qualifying round from the leaderboard (SHRS 3). */
  onCreateRound?: (() => void) | null;
  /** Delete the latest round built from the leaderboard. */
  onUndoRedistribution?: (() => void) | null;
  // Set while the PARENT is running one of its own round-level actions, so
  // the per-heat buttons can't start a second one underneath it.
  rowActionsDisabled?: boolean;
}

function HeatComponent({
  event,
  onScoreHeat,
  onUndoLastRace = null,
  onCreateRound = null,
  onUndoRedistribution = null,
  rowActionsDisabled = false,
}: HeatComponentProps) {
  const eventId = event.event_id;
  const [displayLastHeats, setDisplayLastHeats] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);

  // Every heat-mutating action here (create/recreate/transfer/start-final/
  // restore) chains one or more DB round-trips, and Start Final Series chains
  // up to four confirm dialogs. ConfirmDialogHost rejects a second confirm
  // while one is open (it silently resolves to 'cancel'), so a double-click
  // would launch a second chain that self-aborts with no explanation. Gate all
  // of them through one exclusive runner: a ref gives a synchronous guard (two
  // clicks in the same tick both see busy=false otherwise), and `busy` drives
  // the disabled state on the trigger buttons.
  const { busy, runExclusive } = useExclusiveAction();

  // The host page reads the same list (one query, useHeatList), so what it
  // knows about the series can never disagree with what is shown here.
  const {
    heats,
    loadFailed,
    heatsCreated,
    raceHappened,
    numQualifyingGroups,
    finalSeriesStarted,
  } = useHeatList(eventId);

  const snapshots = useHeatSnapshots(eventId);
  const finalSeries = useFinalSeriesStart({
    eventId,
    finalSeriesStarted,
    saveBackupFile: snapshots.saveBackupFile,
  });
  const management = useHeatManagement({
    eventId,
    heats,
    numQualifyingGroups,
    heatsLocked: raceHappened || finalSeriesStarted,
    runExclusive,
  });

  // Where the event stands and what may be done now: regatta-core's
  // eventStatus. The round being sailed, the next step and every button's
  // verdict come from it; this screen decides nothing about rounds.
  const { status, loadFailed: statusFailed } = useEventStatus(eventId);
  const current = useMemo(
    () => new Map((status?.heats ?? []).map((heat) => [heat.heat_id, heat])),
    [status],
  );
  // Without a status (its read failed, and was reported) every heat is
  // shown, with no buttons: the list is still there to read.
  const lastHeats = useMemo(
    () =>
      statusFailed ? heats : heats.filter((heat) => current.has(heat.heat_id)),
    [heats, current, statusFailed],
  );
  const heatsToDisplay = displayLastHeats ? lastHeats : heats;
  const hasMultipleRounds = heats.length > lastHeats.length;

  const canSetUp = !raceHappened && !finalSeriesStarted;

  return (
    <div className="section-block">
      <AppModal
        open={finalSeries.confirmOpen}
        title="Start Final Series?"
        confirmLabel="Yes, Start Final Series"
        cancelLabel="Cancel"
        onCancel={finalSeries.cancelFinalSeries}
        onConfirm={() => runExclusive(finalSeries.confirmFinalSeries)}
      >
        This will create <strong>{finalSeries.pendingFinalHeats}</strong> final
        fleet
        {finalSeries.pendingFinalHeats > 1 ? 's' : ''} based on current
        standings. This action <strong>cannot be undone</strong>.
        {finalSeries.pendingRule43 !== null && (
          <>
            <br />
            SHRS Rule 4.3:{' '}
            <strong>
              {finalSeries.pendingRule43 ? 'applied' : 'not applied'}
            </strong>
            .
          </>
        )}
      </AppModal>

      <RoundBar
        status={status}
        heats={heats}
        busy={busy || rowActionsDisabled}
        noHeats={heatsToDisplay.length === 0}
        onScore={onScoreHeat}
        onCreateRound={onCreateRound}
        onUndoRedistribution={onUndoRedistribution}
        onStartFinalSeries={() => runExclusive(finalSeries.startFinalSeries)}
        onExport={() => setExportOpen(true)}
        hasMultipleRounds={hasMultipleRounds}
        displayLastHeats={displayLastHeats}
        onToggleDisplayMode={() => setDisplayLastHeats((last) => !last)}
      />

      {/* Every heat of the event, so any round can be chosen in the dialog.
          Mounted only while open: it starts from the latest round and the
          options remembered for this event. */}
      {exportOpen && (
        <HeatsExportDialog
          open
          onClose={() => setExportOpen(false)}
          event={event}
          heats={heats}
        />
      )}

      <HeatSetupBar
        canSetUp={canSetUp}
        heatsCreated={heatsCreated}
        numHeats={management.numHeats}
        extraHeatsNote={management.extraHeatsNote}
        onNumHeatsChange={management.chooseHeatCount}
        onCreateOrRecreate={() =>
          runExclusive(
            heatsCreated ? management.recreateHeats : management.createHeats,
          )
        }
        busy={busy}
      />

      {loadFailed && (
        <div className="info-banner">
          <i
            className="fa fa-exclamation-triangle"
            aria-hidden="true"
            style={{ marginRight: '8px' }}
          />
          Could not load the heats for this event. The list below may be
          incomplete — reload the page to try again.
        </div>
      )}

      {heatsCreated && !loadFailed && (
        <UnassignedEntriesNotice
          eventId={eventId}
          heats={heats}
          raceHappened={raceHappened}
          finalSeriesStarted={finalSeriesStarted}
          busy={busy || rowActionsDisabled}
          runExclusive={runExclusive}
        />
      )}

      {heatsToDisplay.length === 0 && !heatsCreated && !loadFailed && (
        <div className="info-banner">
          <i
            className="fa fa-info-circle"
            aria-hidden="true"
            style={{ marginRight: '8px' }}
          />
          No heats yet. Choose the number of heats above and press{' '}
          <strong>Create Heats</strong> — boats will be divided automatically
          based on country and sail number.
        </div>
      )}

      {heatsToDisplay.length > 0 && (
        <div className="heats-container">
          {heatsToDisplay.map((heat) => {
            // The status offers a heat's buttons (a heat of the round being
            // sailed, or a fleet) and says why one is refused.
            const shown = current.get(heat.heat_id);
            const score = shown?.score;
            const undo = shown?.undoRace;
            return (
              <HeatColumn
                key={heat.heat_id}
                heat={heat}
                boatsDraggable={canSetUp}
                onBoatDrop={management.dropBoat}
                onScore={score?.offered ? onScoreHeat : null}
                scoreRefused={score && !score.ok ? score.reason : null}
                onUndoLastRace={undo?.offered ? onUndoLastRace : null}
                undoRefused={undo && !undo.ok ? undo.reason : null}
                actionsDisabled={busy || rowActionsDisabled}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default HeatComponent;
