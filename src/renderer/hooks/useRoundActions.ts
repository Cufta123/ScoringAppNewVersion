import { heatRaceDB } from '../api/db';
import { queries } from '../api/queries';
import { useReadNow, useWrite } from '../api/writes';
import useExclusiveAction from './useExclusiveAction';
import {
  confirmAction,
  getErrorMessage,
  reportError,
  reportInfo,
} from '../utils/userFeedback';
import type { EventRow } from '../types';
import type { EventStatusView, StatusAction } from '../../shared/eventStatus';
import type { ScoringHeat } from './useScoringInput';

interface Options {
  event: EventRow | null;
}

/**
 * The round-level actions of the Heat Race page: build the next round from the
 * leaderboard, undo that redistribution, undo a heat's last race. Each chains a
 * confirm dialog and one or more DB round-trips with no visible progress, and
 * every one is destructive or builds a round, so they run one at a time
 * (`roundActionBusy` disables the buttons that start them). Each write reads
 * the event again before it resolves (api/writes.ts).
 *
 * Whether each may be done is the event status's (regatta-core): read fresh
 * before asking, so a refusal is said up front instead of after a
 * confirmation that can only fail. The main process refuses it again.
 */
export default function useRoundActions({ event }: Options) {
  const { busy: roundActionBusy, runExclusive } = useExclusiveAction();
  const readNow = useReadNow();
  const affected = { eventId: event?.event_id };
  const createNextRound = useWrite(
    (eventId: number) => heatRaceDB.createNewHeatsBasedOnLeaderboard(eventId),
    affected,
  );
  const undoLastScoredRace = useWrite(
    (heatId: number) => heatRaceDB.undoLastScoredRaceForHeat(heatId),
    affected,
  );
  const undoLatestRedistribution = useWrite(
    (eventId: number) => heatRaceDB.undoLatestHeatRedistribution(eventId),
    affected,
  );

  /**
   * The verdict on one action from the status read now; a refusal is told
   * (under `title`) and gives false. A failed read leaves it to the main
   * process, which checks again.
   */
  const allowedNow = async (
    pick: (status: EventStatusView) => StatusAction | undefined,
    title: string,
  ): Promise<boolean> => {
    if (!event) return false;
    let verdict: StatusAction | undefined;
    try {
      verdict = pick(await readNow(queries.eventStatus(event.event_id)));
    } catch (_error) {
      return true;
    }
    if (verdict && !verdict.ok) {
      reportInfo(verdict.reason, title);
      return false;
    }
    return true;
  };

  const createNewHeats = async () => {
    if (!event) return;
    if (!(await allowedNow((status) => status.createRound, 'Action blocked'))) {
      return;
    }

    const confirmed = await confirmAction(
      "Create the next round's heats from the current leaderboard?\n\nAll heats in the current round must have the same number of races.",
      'Create next round',
      { confirmLabel: 'Create heats' },
    );
    if (!confirmed) return;

    try {
      const result = await createNextRound(event.event_id);
      if (result?.advisory) {
        reportInfo(result.advisory, 'SHRS advisory');
      }
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
    // A heat whose round seeded the next one, or a qualifying heat once the
    // Final Series started, keeps its races (SHRS 3.1(2), 4.2): say so up
    // front. The status lists only the heats being sailed; any other heat
    // is left to the main process.
    if (
      !(await allowedNow(
        (status) =>
          status.heats.find((shown) => shown.heat_id === heat.heat_id)
            ?.undoRace,
        'Undo not possible yet',
      ))
    ) {
      return;
    }

    const confirmed = await confirmAction(
      `Undo the last scored race in "${heat.heat_name}"?\n\nThis will permanently delete that race's scores.`,
      'Undo Last Race',
      { confirmLabel: 'Undo race', confirmClassName: 'btn-danger' },
    );
    if (!confirmed) return;

    try {
      const result = await undoLastScoredRace(heat.heat_id);
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
    if (
      !(await allowedNow((status) => status.undoRound, 'Undo not possible'))
    ) {
      return;
    }
    const confirmed = await confirmAction(
      'Undo latest heat redistribution?\n\nThis will delete the latest qualifying heats and all their boat assignments. This cannot be undone.',
      'Undo round',
      { confirmLabel: 'Undo redistribution', confirmClassName: 'btn-danger' },
    );
    if (!confirmed) return;

    try {
      const result = await undoLatestRedistribution(event.event_id);
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
