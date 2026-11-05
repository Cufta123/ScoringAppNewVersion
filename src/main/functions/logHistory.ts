/**
 * Undo and "go back to a point" on the event's decision log (phase 4 of
 * docs/regatta-core-switch.md). Nothing is deleted: an undo withdraws the
 * action's decisions and brings back, as its own, the ones it withdrew, so
 * an undo is itself undone the same way; going back makes the log what it
 * was right after the chosen action. regatta-core replays the result (and
 * refuses, in words, a log the rules do not allow); the tables follow.
 */
import { replay, type Decision, type RaceRef } from 'regatta-core';
import { db } from '../database/DBManager';
import {
  decisionsOfAction,
  laterDecisions,
  logAfterAction,
  logWithoutAction,
  saveLog,
} from './decisionStore';
import projectEvent from './projectEvent';
import { actionLabel } from '../../shared/history/describe';

/** The races a decision is about. */
function racesOf(decision: Decision): RaceRef[] {
  switch (decision.type) {
    case 'raceScored':
    case 'raceCorrected':
      return [decision.race];
    case 'protestDecided':
      return decision.outcome.kind === 'RDG2'
        ? [decision.race, ...decision.outcome.races]
        : [decision.race];
    default:
      return [];
  }
}

const sameRace = (a: RaceRef, b: RaceRef) =>
  a.heat === b.heat && a.race === b.race;

function applyLog(eventId: number, next: Decision[], what: string) {
  const result = replay(next);
  if (!result.ok) throw new Error(`${what}: ${result.reason}`);
  saveLog(eventId, next);
  projectEvent(eventId, result.state);
}

/**
 * Undo one action on the log. A race a later action changed again is
 * refused (undo that change first), as the row-based undo did.
 */
export function undoActionOnLog(eventId: number, actionId: number) {
  const { added, withdrawn } = decisionsOfAction(eventId, actionId);
  const races = [...added, ...withdrawn].flatMap(racesOf);
  const later = laterDecisions(eventId, actionId).find(({ decision }) =>
    racesOf(decision).some((race) => races.some((r) => sameRace(r, race))),
  );
  if (later) {
    const race = racesOf(later.decision).find((r) =>
      races.some((mine) => sameRace(mine, r)),
    )!;
    const action = db
      .prepare('SELECT channel FROM ChangeActions WHERE action_id = ?')
      .get(later.actionId) as { channel: string | null } | undefined;
    throw new Error(
      `Cannot undo: the result of ${race.heat} race ${race.race} was changed again later by “${actionLabel(action?.channel ?? null)}”. Undo that change first.`,
    );
  }
  applyLog(eventId, logWithoutAction(eventId, actionId), 'Cannot undo');
}

/** Make the log what it was right after `actionId`. */
export function restoreLogToAction(eventId: number, actionId: number) {
  applyLog(eventId, logAfterAction(eventId, actionId), 'Cannot go back');
}
