/**
 * `readEventStatus` answers for renderer tests that mock the IPC: the
 * screens show what the status says, so a test states the status it wants.
 * (What the status says for an event is regatta-core's, tested in
 * packages/regatta-core/test/status.test.ts and, through the real handlers,
 * in readEventStatus.integration.test.ts.)
 */
import type {
  EventStatusView,
  StatusAction,
  StatusHeat,
} from '../../shared/eventStatus';

export const allowed: StatusAction = { ok: true, offered: true };
export const refused = (
  reason = 'Not now.',
  offered = false,
): StatusAction => ({ ok: false, offered, reason });

/** A heat as the status lists it (scored `races` times). */
export function statusHeat(
  heat_id: number,
  heat_name: string,
  races = 0,
  fields: Partial<StatusHeat> = {},
): StatusHeat {
  return {
    heat_id,
    heat_name,
    boat_ids: [],
    races,
    score: races === 0 ? allowed : { ok: true, offered: false },
    undoRace: races > 0 ? allowed : refused('There is nothing to undo.', false),
    ...fields,
  };
}

/** A status: before the heats unless `fields` say otherwise. */
export function eventStatusView(
  fields: Partial<EventStatusView> = {},
): EventStatusView {
  return {
    series: 'entries',
    round: null,
    heats: [],
    next: { kind: 'createHeats' },
    createRound: refused('Create the heats first.'),
    undoRound: refused('Create the heats first.'),
    startFinal: {
      ...refused('Create the heats first.'),
      eligibility: {
        ok: false,
        reason: 'NO_HEATS',
        numFinalHeats: 0,
        completedQualifyingRaces: 0,
        rule43Applies: false,
        noRacesCompleted: true,
        latestRoundUnsailed: false,
        latestRoundNumber: null,
        raceCountBreakdown: [],
      },
    },
    ...fields,
  };
}
