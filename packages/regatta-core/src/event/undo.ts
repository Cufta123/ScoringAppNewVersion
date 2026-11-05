/**
 * Taking a decision back. The log is the event, so an undo is a new log
 * without the decisions it takes back; these build that log, and refuse,
 * in words for the race officer, what the rules do not allow.
 *
 * The checks are the ones `eventStatus` reports (`undoRaceVerdict`,
 * `undoRoundVerdict`), so a screen that offers an undo from the status
 * offers exactly what these accept.
 */
import type { Decision, HeatId, RaceRef } from '../types';
import { closedHeat, replay } from './replay';
import { currentRound, findHeat, type EventState, type Heat } from './state';

export type Verdict = { ok: true } | { ok: false; reason: string };

/** A new log, replayed, or why not. */
export type Undone =
  | { ok: true; log: Decision[]; state: EventState }
  | { ok: false; reason: string };

/** "Heat A3", or a final fleet by its name ("Gold"). */
export const heatLabel = (heat: Pick<Heat, 'id' | 'series'>) =>
  heat.series === 'final' ? heat.id : `Heat ${heat.id}`;

/**
 * Whether a heat's last race can be taken out of the log: it has a race,
 * and the heat is still open (`closedHeat`, the check replay makes before
 * scoring a race in it: the same rule keeps its races as they are).
 */
export function undoRaceVerdict(state: EventState, heatId: HeatId): Verdict {
  const heat = findHeat(state, heatId);
  if (!heat) return { ok: false, reason: `There is no heat ${heatId}.` };
  if (heat.races.length === 0) {
    return {
      ok: false,
      reason: `${heatLabel(heat)} has no scored race, so there is nothing to undo.`,
    };
  }
  const closed = closedHeat(state, heat);
  if (!closed) return { ok: true };
  if (state.fleets === null) {
    // A later round was built from this one (SHRS 3.1(2)): say which.
    const next = state.rounds[heat.round] ?? [];
    return {
      ok: false,
      reason: `The next round (${next.map(heatLabel).join(', ')}) was already built from this round's results, so this race cannot be undone on its own. Undo that round first, then the race.`,
    };
  }
  return { ok: false, reason: closed };
}

/**
 * Whether the latest qualifying round can be taken back: it was built from
 * the round before (round 2 or later), nothing in it has raced, and the
 * Final Series has not started.
 */
export function undoRoundVerdict(state: EventState): Verdict {
  if (state.fleets !== null) {
    return {
      ok: false,
      reason:
        'The Final Series has started: the qualifying rounds stay as they are.',
    };
  }
  if (state.rounds.length === 0) {
    return {
      ok: false,
      reason: 'This event has no qualifying heats yet. Create the heats first.',
    };
  }
  if (state.rounds.length === 1) {
    return {
      ok: false,
      reason:
        'There is no heat redistribution to undo — these are the first-round heats.',
    };
  }
  if (currentRound(state).some((heat) => heat.races.length > 0)) {
    return {
      ok: false,
      reason:
        'Cannot undo heat redistribution because the latest heats already contain races. Undo the last race first.',
    };
  }
  return { ok: true };
}

function finish(log: Decision[]): Undone {
  const result = replay(log);
  return result.ok
    ? { ok: true, log, state: result.state }
    : { ok: false, reason: result.reason };
}

/**
 * The log without the last race of `heatId`: its `raceScored`, the
 * corrections and protest decisions of that race, and the race taken out
 * of any RDG2 average that named it (the other races stay).
 */
export function undoLastRace(log: readonly Decision[], heatId: HeatId): Undone {
  const before = replay(log);
  if (!before.ok) return { ok: false, reason: before.reason };
  const verdict = undoRaceVerdict(before.state, heatId);
  if (!verdict.ok) return verdict;
  const ref: RaceRef = {
    heat: heatId,
    race: findHeat(before.state, heatId)!.races.length,
  };
  const same = (other: RaceRef) =>
    other.heat === ref.heat && other.race === ref.race;
  return finish(
    log
      .filter(
        (decision) =>
          !(
            (decision.type === 'raceScored' ||
              decision.type === 'raceCorrected' ||
              decision.type === 'protestDecided') &&
            same(decision.race)
          ),
      )
      .map((decision) =>
        decision.type === 'protestDecided' && decision.outcome.kind === 'RDG2'
          ? {
              ...decision,
              outcome: {
                ...decision.outcome,
                races: decision.outcome.races.filter((race) => !same(race)),
              },
            }
          : decision,
      ),
  );
}

/**
 * The log without the latest `roundCreated`, and without the late entries
 * assigned to that round's heats and the boats moved between them after it.
 */
export function undoLatestRound(log: readonly Decision[]): Undone {
  const before = replay(log);
  if (!before.ok) return { ok: false, reason: before.reason };
  const verdict = undoRoundVerdict(before.state);
  if (!verdict.ok) return verdict;
  const inRound = new Set(currentRound(before.state).map((heat) => heat.id));
  const at = log.map((decision) => decision.type).lastIndexOf('roundCreated');
  return finish(
    log.filter(
      (decision, i) =>
        i !== at &&
        !(
          i > at &&
          ((decision.type === 'boatAssigned' && inRound.has(decision.heat)) ||
            (decision.type === 'boatMoved' && inRound.has(decision.to)))
        ),
    ),
  );
}
