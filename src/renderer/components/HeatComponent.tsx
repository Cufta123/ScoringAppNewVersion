import React, { useEffect, useMemo, useState } from 'react';
import useExclusiveAction from '../hooks/useExclusiveAction';
import useHeatList from '../hooks/useHeatList';
import useHeatManagement from '../hooks/useHeatManagement';
import useHeatSnapshots from '../hooks/useHeatSnapshots';
import useFinalSeriesStart from '../hooks/useFinalSeriesStart';
import { getLastHeats } from '../utils/heatView';
import type { HeatWithBoats } from '../utils/heatView';
import AppModal from './shared/AppModal';
import UnassignedEntriesNotice from './UnassignedEntriesNotice';
import HeatColumn from './heats/HeatColumn';
import HeatSetupBar from './heats/HeatSetupBar';
import RoundBar from './heats/RoundBar';
import { roundStatus } from '../utils/roundStatus';
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
  onQualifyingGroupCountChange?: ((count: number) => void) | null;
  /** Notifies the host page whenever the final-series state changes (started
   * here, detected on load, or reset by a snapshot restore) so the page's own
   * copy of that state can never go stale. */
  onFinalSeriesStateChange?: ((started: boolean) => void) | null;
  refreshToken?: number;
}

function HeatComponent({
  event,
  onScoreHeat,
  onUndoLastRace = null,
  onCreateRound = null,
  onUndoRedistribution = null,
  rowActionsDisabled = false,
  onQualifyingGroupCountChange = null,
  onFinalSeriesStateChange = null,
  refreshToken = 0,
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

  const {
    heats,
    loadFailed,
    heatsCreated,
    raceHappened,
    numQualifyingGroups,
    finalSeriesStarted,
    markFinalSeriesStarted,
    reload,
  } = useHeatList(eventId, refreshToken);

  const snapshots = useHeatSnapshots(eventId, reload);
  const finalSeries = useFinalSeriesStart({
    eventId,
    finalSeriesStarted,
    markFinalSeriesStarted,
    reloadHeats: reload,
    saveBackupFile: snapshots.saveBackupFile,
  });
  const management = useHeatManagement({
    eventId,
    refreshToken,
    heats,
    numQualifyingGroups,
    heatsLocked: raceHappened || finalSeriesStarted,
    reloadHeats: reload,
    runExclusive,
  });

  // Tell the host page what the heats say, so its own copy can never go stale.
  // Without the final-series report, starting the final series from this
  // embedded component would leave the Heat Race page believing it is still in
  // qualifying — final races would then be submitted and displayed with
  // qualifying semantics.
  useEffect(() => {
    onQualifyingGroupCountChange?.(numQualifyingGroups);
  }, [numQualifyingGroups, onQualifyingGroupCountChange]);

  useEffect(() => {
    onFinalSeriesStateChange?.(finalSeriesStarted);
  }, [finalSeriesStarted, onFinalSeriesStateChange]);

  const lastHeats = useMemo(() => getLastHeats(heats), [heats]);
  const heatsToDisplay = displayLastHeats ? lastHeats : heats;
  const hasMultipleRounds = heats.length > lastHeats.length;

  const status = useMemo(
    () => roundStatus(heats, { finalSeriesStarted }),
    [heats, finalSeriesStarted],
  );
  const currentHeatIds = useMemo(
    () => new Set(lastHeats.map((heat) => heat.heat_id)),
    [lastHeats],
  );

  const canSetUp = !raceHappened && !finalSeriesStarted;
  const canStartFinalSeries = numQualifyingGroups >= 2 && !finalSeriesStarted;

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
        canStartFinalSeries={canStartFinalSeries}
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
          refreshKey={heats}
          busy={busy || rowActionsDisabled}
          runExclusive={runExclusive}
          onAssigned={reload}
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
            const current = currentHeatIds.has(heat.heat_id);
            return (
              <HeatColumn
                key={heat.heat_id}
                heat={heat}
                boatsDraggable={canSetUp}
                onBoatDrop={management.dropBoat}
                onScore={
                  current &&
                  // SHRS 3.2: in a qualifying round of several heats each heat
                  // races once, then the boats are redistributed.
                  (finalSeriesStarted ||
                    numQualifyingGroups < 2 ||
                    heat.raceNumber === 0)
                    ? onScoreHeat
                    : null
                }
                onUndoLastRace={current ? onUndoLastRace : null}
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
