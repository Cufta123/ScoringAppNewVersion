import { useCallback, useState } from 'react';
import { canExportEventSnapshot, heatRaceDB } from '../api/db';
import {
  confirmAction,
  getErrorMessage,
  reportError,
  reportInfo,
} from '../utils/userFeedback';
import {
  finalSeriesBlockedMessage,
  unsailedLatestRoundMessage,
} from '../utils/finalSeriesMessages';
import type { FinalSeriesEligibility } from '../utils/finalSeriesMessages';

interface PendingStart {
  finalHeats: number;
  /** SHRS 2026-1 Rule 4.3 choice, asked before the confirmation modal. */
  applyRule43: boolean;
}

interface Options {
  eventId: number;
  finalSeriesStarted: boolean;
  markFinalSeriesStarted: () => void;
  reloadHeats: () => Promise<void>;
  /** Writes a recovery backup; true when saved, false when cancelled. */
  saveBackupFile: () => Promise<boolean>;
}

/**
 * Starting the Final Series: the chain of questions (empty latest round,
 * recovery backup, SHRS Rule 4.3), the "cannot be undone" confirmation, and the
 * atomic start itself. Eligibility is decided in the main process; this only
 * turns its verdict into prompts.
 *
 * `startFinalSeries` and `confirmFinalSeries` are meant to be run through the
 * caller's exclusive-action runner: the chain opens several confirm dialogs,
 * and the host rejects a second one while one is open.
 */
export default function useFinalSeriesStart({
  eventId,
  finalSeriesStarted,
  markFinalSeriesStarted,
  reloadHeats,
  saveBackupFile,
}: Options) {
  // Set once every question is answered; its presence IS "the modal is open".
  const [pending, setPending] = useState<PendingStart | null>(null);

  const startFinalSeries = useCallback(async () => {
    if (finalSeriesStarted) return;
    try {
      // SHRS eligibility (group counting, equal-race-count, Rule 4.3 window) is
      // computed in the main process; the renderer only renders prompts.
      const eligibility = (await heatRaceDB.getFinalSeriesEligibility(
        eventId,
      )) as FinalSeriesEligibility;

      if (!eligibility.ok) {
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
      if (eligibility.latestRoundUnsailed) {
        // A new round of heats exists but has 0 races. It is NOT "no races
        // completed" — earlier rounds were sailed. Tell the user the empty
        // latest round is ignored and the last completed round is used.
        const proceed = await confirmAction(
          unsailedLatestRoundMessage(eligibility),
          'Latest round not sailed',
        );
        if (!proceed) return;
      }

      if (canExportEventSnapshot()) {
        const saveSnapshotNow = await confirmAction(
          'Before starting the Final Series, do you want to save a recovery backup file now?\n\nThis lets you restore the event later if needed.',
          'Save recovery backup?',
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
            );
            if (!proceedWithoutSnapshot) return;
          }
        }
      }

      let applyRule43 = true;
      if (rule43Applies) {
        applyRule43 = await confirmAction(
          "SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.\n\nConfirm: Apply Rule 4.3 and temporarily exclude each boat's second worst race score only for final-fleet ranking.\nCancel: Do not apply Rule 4.3 and keep ranking without this temporary second exclusion.",
          'Apply SHRS 2026-1 Rule 4.3?',
          {
            confirmLabel: 'Apply Rule 4.3',
            cancelLabel: 'Skip Rule 4.3',
            confirmClassName: 'btn-success',
          },
        );
      }

      setPending({ finalHeats: numFinalHeats ?? 0, applyRule43 });
    } catch (error) {
      reportError(
        'Could not validate heats before starting final series.',
        error,
      );
    }
  }, [eventId, finalSeriesStarted, saveBackupFile]);

  const cancelFinalSeries = useCallback(() => setPending(null), []);

  const confirmFinalSeries = useCallback(async () => {
    if (!pending) return;
    const { applyRule43 } = pending;
    setPending(null);

    const start = async (allowOversize: boolean): Promise<void> => {
      try {
        await heatRaceDB.startFinalSeriesAtomic(
          eventId,
          allowOversize,
          applyRule43,
        );
      } catch (error) {
        const message = getErrorMessage(error);
        if (
          !allowOversize &&
          message.includes('Final fleets would exceed 20 boats')
        ) {
          const proceed = await confirmAction(
            'Final fleets would exceed 20 boats. Continue anyway with oversize fleets for this final-series split?',
            'Confirm oversize final fleets',
          );
          if (proceed) await start(true);
          return;
        }
        reportError('Could not start final series.', error);
        return;
      }
      markFinalSeriesStarted();
      reportInfo('Final Series started successfully!', 'Success');
      await reloadHeats();
    };
    await start(false);
  }, [pending, eventId, markFinalSeriesStarted, reloadHeats]);

  return {
    confirmOpen: pending !== null,
    pendingFinalHeats: pending?.finalHeats ?? 0,
    startFinalSeries,
    confirmFinalSeries,
    cancelFinalSeries,
  };
}
