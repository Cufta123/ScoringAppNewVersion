import { useCallback, useState } from 'react';
import { canExportEventSnapshot, heatRaceDB } from '../api/db';
import { queries } from '../api/queries';
import { useReadNow, useWrite } from '../api/writes';
import {
  confirmAction,
  confirmChoice,
  getErrorMessage,
  reportError,
  reportInfo,
} from '../utils/userFeedback';
import { finalSeriesBlockedMessage } from '../utils/finalSeriesMessages';

interface PendingStart {
  finalHeats: number;
  /** SHRS 2026-1 Rule 4.3 choice, asked before the confirmation modal. */
  applyRule43: boolean;
  /** Whether Rule 4.3 was a question at all (6-7 completed races). */
  rule43Asked: boolean;
}

interface Options {
  eventId: number;
  finalSeriesStarted: boolean;
  /** Writes a recovery backup; true when saved, false when cancelled. */
  saveBackupFile: () => Promise<boolean>;
}

/**
 * Starting the Final Series: the chain of questions (empty latest round,
 * recovery backup, SHRS Rule 4.3), the "cannot be undone" confirmation, and the
 * atomic start itself. Whether it may start is regatta-core's (the event
 * status); this only turns its verdict into prompts.
 *
 * `startFinalSeries` and `confirmFinalSeries` are meant to be run through the
 * caller's exclusive-action runner: the chain opens several confirm dialogs,
 * and the host rejects a second one while one is open.
 */
export default function useFinalSeriesStart({
  eventId,
  finalSeriesStarted,
  saveBackupFile,
}: Options) {
  // Set once every question is answered; its presence IS "the modal is open".
  const [pending, setPending] = useState<PendingStart | null>(null);
  const readNow = useReadNow();
  // Resolves once the event (its heats, now with the fleets) is read again.
  const startAtomic = useWrite(
    (...args: Parameters<typeof heatRaceDB.startFinalSeriesAtomic>) =>
      heatRaceDB.startFinalSeriesAtomic(...args),
    (_result, [id]) => ({ eventId: id }),
  );

  const startFinalSeries = useCallback(async () => {
    if (finalSeriesStarted) return;
    try {
      // Whether the Final Series may start, and the Rule 4.3 window, are
      // regatta-core's (readEventStatus); the renderer only words prompts.
      const status = await readNow(queries.eventStatus(eventId));
      const { eligibility } = status.startFinal;

      if (!status.startFinal.ok) {
        reportInfo(
          finalSeriesBlockedMessage(eligibility),
          'Cannot start final series',
        );
        return;
      }

      const { numFinalHeats, rule43Applies } = eligibility;

      // RULE-m3: the "0 races → assign by initial seeding only" path was removed.
      // SHRS 4.2 requires a Qualifying Series ranking to divide fleets, so the
      // 0-race case is now rejected up front (reason NO_RACES_COMPLETED above)
      // rather than offered as a seeding-only start.

      if (canExportEventSnapshot()) {
        const saveSnapshotNow = await confirmAction(
          'Before starting the Final Series, do you want to save a recovery backup file now?\n\nThis lets you restore the event later if needed.',
          'Save recovery backup?',
          // Cancel here would read as "stop", but it goes on without a backup.
          { confirmLabel: 'Save backup', cancelLabel: 'Skip backup' },
        );

        if (saveSnapshotNow) {
          let saved: boolean;
          try {
            saved = await saveBackupFile();
          } catch (error) {
            // Nothing has changed yet, so stopping is safe; say what failed.
            reportError('Could not save recovery backup.', error);
            return;
          }
          if (!saved) {
            const proceedWithoutSnapshot = await confirmAction(
              'Backup save was canceled. Continue starting the Final Series without a backup?',
              'Continue without backup?',
              {
                confirmLabel: 'Continue without backup',
                cancelLabel: 'Go back',
              },
            );
            if (!proceedWithoutSnapshot) return;
          }
        }
      }

      let applyRule43 = true;
      if (rule43Applies) {
        // Three answers, because "no" is a decision with a result of its own
        // (the fleets are drawn without the rule). Escape, a click outside the
        // dialog and the focused Cancel button therefore STOP the start
        // instead of quietly choosing "skip".
        const choice = await confirmChoice(
          "SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.\n\nApply Rule 4.3: temporarily exclude each boat's second worst race score, only for ranking the boats into final fleets.\nSkip Rule 4.3: rank without this second exclusion.\nCancel: do not start the Final Series yet.",
          'Apply SHRS 2026-1 Rule 4.3?',
          {
            confirmLabel: 'Apply Rule 4.3',
            extraLabel: 'Skip Rule 4.3',
            extraClassName: 'btn-secondary',
            cancelLabel: 'Cancel',
            confirmClassName: 'btn-success',
          },
        );
        if (choice === 'cancel') return;
        applyRule43 = choice === 'confirm';
      }

      setPending({
        finalHeats: numFinalHeats ?? 0,
        applyRule43,
        rule43Asked: rule43Applies === true,
      });
    } catch (error) {
      reportError(
        'Could not validate heats before starting final series.',
        error,
      );
    }
  }, [eventId, finalSeriesStarted, saveBackupFile, readNow]);

  const cancelFinalSeries = useCallback(() => setPending(null), []);

  const confirmFinalSeries = useCallback(async () => {
    if (!pending) return;
    const { applyRule43 } = pending;
    setPending(null);

    const start = async (allowOversize: boolean): Promise<void> => {
      try {
        await startAtomic(eventId, allowOversize, applyRule43);
      } catch (error) {
        const message = getErrorMessage(error);
        if (
          !allowOversize &&
          message.includes('Final fleets would exceed 20 boats')
        ) {
          const proceed = await confirmAction(
            'Final fleets would exceed 20 boats. Continue anyway with oversize fleets for this final-series split?',
            'Confirm oversize final fleets',
            { confirmLabel: 'Continue anyway' },
          );
          if (proceed) await start(true);
          return;
        }
        reportError('Could not start final series.', error);
        return;
      }
      reportInfo('Final Series started successfully!', 'Success');
    };
    await start(false);
  }, [pending, eventId, startAtomic]);

  return {
    confirmOpen: pending !== null,
    pendingFinalHeats: pending?.finalHeats ?? 0,
    /** null when Rule 4.3 did not come up for this event. */
    pendingRule43: pending?.rule43Asked ? pending.applyRule43 : null,
    startFinalSeries,
    confirmFinalSeries,
    cancelFinalSeries,
  };
}
