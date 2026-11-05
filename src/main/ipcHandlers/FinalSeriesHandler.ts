import {
  MAX_HEAT_SIZE,
  eventStatus,
  replay,
  type Decision,
  type FinalSeriesStatus,
} from 'regatta-core';
import handle from './handle';
import type { HeatOverflowPolicy } from '../../shared/eventSettings';
import { applyToEvent, currentEvent } from '../functions/libraryWrite';

/** The library's refusal (SHRS 1.1, 4.1, 4.2, parity R7) in this screen's words. */
function finalSeriesRefusal(
  start: FinalSeriesStatus & { ok: false },
  round: number,
): string {
  switch (start.check) {
    case 'STARTED':
      return 'The Final Series has already been started for this event.';
    case 'NO_HEATS':
    case 'SINGLE_FLEET':
      return 'The Final Series needs at least 2 qualifying heats. With a single heat, every boat is scored as one fleet and there is no Final Series.';
    case 'UNEQUAL_RACE_COUNTS':
      return 'Cannot start the Final Series yet: the heats of the current round have not all sailed the same number of races. Score the missing races first.';
    case 'NO_RACES_COMPLETED':
      return 'Cannot start the Final Series: there are no qualifying results yet. Score the qualifying races first.';
    case 'LATEST_ROUND_UNSAILED':
      return `Round ${round} has been built but not sailed. Undo that round first (Undo round on the Scoring page), then start the Final Series.`;
    default:
      return start.reason;
  }
}

handle(
  'startFinalSeriesAtomic',
  async (
    _event,
    raw_event_id,
    allow_oversize_confirm = false,
    apply_shrs43_temporary_second_discard = true,
  ) => {
    const event_id = Number(raw_event_id);
    // Whether the Final Series may start is regatta-core's, the verdict the
    // Scoring page shows (`readEventStatus`'s startFinal): worded here as
    // the race officer knows it from this screen.
    const { log, state } = currentEvent(event_id);
    const start = eventStatus(state).startFinal;
    if (!start.ok) {
      throw new Error(finalSeriesRefusal(start, state.rounds.length));
    }

    // The split (SHRS 4.1-4.3) is regatta-core's. Fleets over 20 boats
    // (SHRS 2.3) need the race officer's word when the event asks for it.
    const decision: Decision = {
      type: 'finalSeriesStarted',
      rule43: apply_shrs43_temporary_second_discard === true,
    };
    const trial = replay([...log, decision]);
    if (!trial.ok) throw new Error(trial.reason);
    // The fleets setting, as the event's log has it (SHRS 2.3).
    const overflowPolicy: HeatOverflowPolicy =
      trial.state.settings.finalOverflow === 'add-fleets'
        ? 'auto-increase'
        : 'confirm-allow-oversize';
    const oversize = (trial.state.fleets ?? []).some(
      (fleet) => fleet.boats.length > MAX_HEAT_SIZE,
    );
    if (oversize && !allow_oversize_confirm) {
      throw new Error(
        `Final fleets would exceed ${MAX_HEAT_SIZE} boats. Confirm oversize to continue or switch event policy to auto-increase heats.`,
      );
    }

    const { after } = applyToEvent(event_id, { decide: () => [decision] });
    const fleets = after.fleets ?? [];
    return {
      success: true,
      createdHeats: fleets.length,
      assignedBoats: fleets.reduce((n, fleet) => n + fleet.boats.length, 0),
      overflowPolicy,
    };
  },
);
