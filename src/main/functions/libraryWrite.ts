/**
 * The write path through regatta-core (phase 3 of
 * docs/regatta-core-switch.md): a handler turns its request into decisions;
 * the event's log (converted from the tables) is replayed with them; the
 * library refuses, in words for the race officer, what the rules do not
 * allow; otherwise the tables become the new state (projectEvent).
 *
 * Nothing about the rules is decided here: the library decides, the
 * projection writes.
 */
import { replay, type Decision, type EventState } from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import { eventToLog } from './eventLog';
import projectEvent from './projectEvent';
import { ensureCompleteRaceScoresForEvent } from './raceScoring';
import { hasFinalSeriesStarted } from './seriesGuards';

export interface Applied {
  before: EventState;
  after: EventState;
  log: Decision[];
}

/** The event's log and state now (from the tables). */
export function currentEvent(eventId: number) {
  // Rows the older write paths leave for the reads to complete.
  ensureCompleteRaceScoresForEvent(eventId, 'Qualifying');
  if (hasFinalSeriesStarted(eventId)) {
    ensureCompleteRaceScoresForEvent(eventId, 'Final');
  }
  const log = eventToLog(eventId).decisions;
  const result = replay(log);
  if (!result.ok) {
    throw new Error(
      `The results of this event cannot be worked out, so nothing was changed: ${result.reason}`,
    );
  }
  return { log, state: result.state };
}

/**
 * Apply what `decide` returns (given the event as it is), or a whole new
 * log from `rewrite` (an undo takes decisions out). In one transaction:
 * refused, nothing is written.
 */
export function applyToEvent(
  eventId: number,
  change:
    | { decide: (state: EventState, log: Decision[]) => Decision[] }
    | { rewrite: (log: Decision[], state: EventState) => Decision[] },
): Applied {
  return db.transaction(() => {
    const { log, state: before } = currentEvent(eventId);
    const next =
      'decide' in change
        ? [...log, ...change.decide(before, log)]
        : change.rewrite(log, before);
    const result = replay(next);
    if (!result.ok) throw new Error(result.reason);
    projectEvent(eventId, result.state);
    return { before, after: result.state, log: next };
  })();
}
