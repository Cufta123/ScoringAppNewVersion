import { heatRaceDB } from '../api/db';
import useExclusiveAction from './useExclusiveAction';
import {
  confirmAction,
  getErrorMessage,
  reportError,
  reportInfo,
} from '../utils/userFeedback';
import { laterRoundBlocksUndoMessage } from '../utils/heatRounds';
import { laterRoundHeatNames } from '../../shared/heatNames';
import type { EventRow } from '../types';
import type { ScoringHeat } from './useScoringInput';

interface Options {
  event: EventRow | null;
  finalSeriesStarted: boolean;
  /** Ask the heats view to re-read itself. */
  refreshHeats: () => void;
}

/**
 * The round-level actions of the Heat Race page: build the next round from the
 * leaderboard, undo that redistribution, undo a heat's last race. Each chains a
 * confirm dialog and one or more DB round-trips with no visible progress, and
 * every one is destructive or builds a round, so they run one at a time
 * (`roundActionBusy` disables the buttons that start them).
 */
export default function useRoundActions({
  event,
  finalSeriesStarted,
  refreshHeats,
}: Options) {
  const { busy: roundActionBusy, runExclusive } = useExclusiveAction();

  const createNewHeats = async () => {
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
      { confirmLabel: 'Create heats' },
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
      const message = getErrorMessage(error);
      if (message.includes('has not raced yet')) {
        // Names the heat that still has to race.
        reportInfo(message, 'Nothing to redistribute');
        return;
      }
      reportError('Could not create new heats from leaderboard.', error);
    }
  };

  // Contextual action: invoked from inside the selected heat card.
  const undoLastRace = async (heat: ScoringHeat) => {
    // If a later round was already built from this round's results, undoing
    // this race would leave that round seeded from results that no longer
    // exist (SHRS 3.1(2)). The main process refuses it; say so up front
    // instead of asking for a confirmation that can only fail.
    if (event) {
      let laterRounds: string[] = [];
      try {
        const allHeats = await heatRaceDB.readAllHeats(event.event_id);
        laterRounds = laterRoundHeatNames(allHeats || [], heat.heat_name);
      } catch (_error) {
        // Best-effort pre-check only — the main process enforces the rule.
      }
      if (laterRounds.length > 0) {
        reportInfo(
          laterRoundBlocksUndoMessage(laterRounds),
          'Undo not possible yet',
        );
        return;
      }
    }

    const confirmed = await confirmAction(
      `Undo the last scored race in "${heat.heat_name}"?\n\nThis will permanently delete that race's scores.`,
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

  const undoRedistribution = async () => {
    if (!event) return;
    const confirmed = await confirmAction(
      'Undo latest heat redistribution?\n\nThis will delete the latest qualifying heats and all their boat assignments. This cannot be undone.',
      'Undo Heat Redistribution',
      { confirmLabel: 'Undo redistribution', confirmClassName: 'btn-danger' },
    );
    if (!confirmed) return;

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

  return {
    roundActionBusy,
    createNewHeats: () => runExclusive(createNewHeats),
    undoLastRace: (heat: ScoringHeat) => runExclusive(() => undoLastRace(heat)),
    undoRedistribution: () => runExclusive(undoRedistribution),
  };
}
