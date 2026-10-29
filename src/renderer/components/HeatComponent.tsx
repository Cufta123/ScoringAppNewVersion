import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useExclusiveAction from '../hooks/useExclusiveAction';
import useHeatList from '../hooks/useHeatList';
import useHeatManagement from '../hooks/useHeatManagement';
import useHeatSnapshots from '../hooks/useHeatSnapshots';
import useFinalSeriesStart from '../hooks/useFinalSeriesStart';
import printNewHeats from '../utils/printNewHeats';
import { getLastHeats, isFinalSeriesView } from '../utils/heatView';
import type { HeatWithBoats } from '../utils/heatView';
import { reportError } from '../utils/userFeedback';
import AppModal from './shared/AppModal';
import UnassignedEntriesNotice from './UnassignedEntriesNotice';
import HeatColumn from './heats/HeatColumn';
import HeatBackupBar from './heats/HeatBackupBar';
import { HeatSetupBar, HeatsHeader } from './heats/HeatControls';
import type { NewHeatsFormat } from './heats/HeatControls';
import type { EventRow } from '../types';

export type { HeatWithBoats };

interface HeatComponentProps {
  event: EventRow;
  onHeatSelect?: (heat: HeatWithBoats) => void;
  onStartScoring?: (() => void) | null;
  onUndoLastRace?: ((heat: HeatWithBoats) => void) | null;
  // Set while the PARENT is running one of its own round-level actions, so
  // the per-heat buttons can't start a second one underneath it.
  rowActionsDisabled?: boolean;
  clickable: boolean;
  onQualifyingGroupCountChange?: ((count: number) => void) | null;
  /** Notifies the host page whenever the final-series state changes (started
   * here, detected on load, or reset by a snapshot restore) so the page's own
   * copy of that state can never go stale. */
  onFinalSeriesStateChange?: ((started: boolean) => void) | null;
  refreshToken?: number;
}

const ignoreHeatSelect = () => {};

function HeatComponent({
  event,
  onHeatSelect = ignoreHeatSelect,
  onStartScoring = null,
  onUndoLastRace = null,
  rowActionsDisabled = false,
  clickable,
  onQualifyingGroupCountChange = null,
  onFinalSeriesStateChange = null,
  refreshToken = 0,
}: HeatComponentProps) {
  const eventId = event.event_id;
  const [selectedHeatId, setSelectedHeatId] = useState<number | null>(null);
  const [displayLastHeats, setDisplayLastHeats] = useState(true);
  const [newHeatsFormat, setNewHeatsFormat] = useState<NewHeatsFormat>('excel');

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

  const selectHeat = useCallback(
    (heat: HeatWithBoats) => {
      setSelectedHeatId(heat.heat_id);
      onHeatSelect(heat);
    },
    [onHeatSelect],
  );

  const exportNewHeats = async () => {
    try {
      await printNewHeats(event, heatsToDisplay, newHeatsFormat);
    } catch (error) {
      reportError('Could not export visible heats.', error);
    }
  };

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

      <HeatsHeader
        format={newHeatsFormat}
        onFormatChange={setNewHeatsFormat}
        onPrint={() => runExclusive(exportNewHeats)}
        noHeats={heatsToDisplay.length === 0}
        isFinalSeriesView={isFinalSeriesView(heatsToDisplay)}
        busy={busy}
      />

      <HeatSetupBar
        canSetUp={canSetUp}
        heatsCreated={heatsCreated}
        numHeats={management.numHeats}
        onNumHeatsChange={management.chooseHeatCount}
        onCreateOrRecreate={() =>
          runExclusive(
            heatsCreated ? management.recreateHeats : management.createHeats,
          )
        }
        busy={busy}
        hasMultipleRounds={hasMultipleRounds}
        displayLastHeats={displayLastHeats}
        onToggleDisplayMode={() => setDisplayLastHeats((last) => !last)}
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
            const selected = heat.heat_id === selectedHeatId;
            return (
              <HeatColumn
                key={heat.heat_id}
                heat={heat}
                clickable={clickable}
                selected={selected}
                boatsDraggable={canSetUp}
                onSelect={selectHeat}
                onBoatDrop={management.dropBoat}
                onStartScoring={selected ? onStartScoring : null}
                onUndoLastRace={selected ? onUndoLastRace : null}
                undoDisabled={rowActionsDisabled}
              />
            );
          })}
        </div>
      )}

      {heatsCreated && (
        <HeatBackupBar
          canStartFinalSeries={canStartFinalSeries}
          busy={busy}
          onStartFinalSeries={() => runExclusive(finalSeries.startFinalSeries)}
          onSaveBackup={() => runExclusive(snapshots.saveBackup)}
          onRestoreBackup={() => runExclusive(snapshots.restoreBackup)}
          history={snapshots.history}
        />
      )}
    </div>
  );
}

export default HeatComponent;
