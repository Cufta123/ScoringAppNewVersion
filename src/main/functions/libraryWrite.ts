/**
 * The write path through regatta-core (phase 3 of
 * docs/regatta-core-switch.md): a handler turns its request into decisions;
 * the event's log (stored; converted from the tables the first time) is
 * replayed with them; the
 * library refuses, in words for the race officer, what the rules do not
 * allow; otherwise the tables become the new state (projectEvent).
 *
 * Nothing about the rules is decided here: the library decides, the
 * projection writes.
 */
import { replay, type Decision, type EventState } from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import projectEvent from './projectEvent';
import { loadLog, saveLog } from './decisionStore';

export interface Applied {
  before: EventState;
  after: EventState;
  log: Decision[];
}

/** The event's log (stored, or converted from older tables) and state. */
export function currentEvent(eventId: number) {
  const log = loadLog(eventId);
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
    saveLog(eventId, next);
    projectEvent(eventId, result.state);
    return { before, after: result.state, log: next };
  })();
}
