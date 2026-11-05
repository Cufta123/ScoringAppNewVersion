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
import { db } from '../database/DBManager';
import projectEvent from './projectEvent';
import { loadLog, replaceLog, saveLog } from './decisionStore';

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

/**
 * Make `log` the event's whole log (a backup file that carries one): it is
 * replayed (a log the rules refuse comes back as the reason, and nothing is
 * written), stored in place of the decisions in force
 * (`decisionStore.replaceLog`, with `note` for an event that had no log)
 * and projected. The event's current log is not read, so a backup also
 * replaces a log that no longer replays. Call inside a transaction (with
 * the event row's own changes, so they are one action).
 */
export function replaceEventLog(
  eventId: number,
  log: Decision[],
  note: string,
): { ok: true; state: EventState } | { ok: false; reason: string } {
  const result = replay(log);
  if (!result.ok) return { ok: false, reason: result.reason };
  replaceLog(eventId, log, note);
  projectEvent(eventId, result.state);
  return { ok: true, state: result.state };
}

const ROLLBACK = Symbol('preview');

/**
 * What a change would give, without keeping it: the change is applied
 * exactly as `applyToEvent` applies it (log, replay, tables), `read` runs on
 * the result, and the transaction is rolled back. A screen that previews
 * with this shows what the write would store, because it is the write.
 */
export function previewOnEvent<T>(
  eventId: number,
  change: Parameters<typeof applyToEvent>[1],
  read: (applied: Applied) => T,
): T {
  let result: { value: T } | undefined;
  try {
    db.transaction(() => {
      result = { value: read(applyToEvent(eventId, change)) };
      throw ROLLBACK;
    })();
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result!.value;
}
