/**
 * Where the event stands and what the race office may do now, for a
 * screen: the series, the round, the heats being sailed, the one next step,
 * and for every action a screen offers whether it may be done, and if not,
 * why (in words for the race officer).
 *
 * Nothing here is a second copy of a rule. An action that adds a decision
 * is tried on the event exactly as `replay` would apply it after the log
 * (`tryDecision`); an undo is checked by the same function that builds the
 * undone log (`undoRaceVerdict`, `undoRoundVerdict`). So an action the
 * status allows is one replay accepts, and one it refuses, replay refuses.
 */
import type { BoatId, HeatId } from '../types';
import { hasRaceToSail, nextStep, type NextStep } from './nextStep';
import { tryDecision } from './replay';
import { currentRound, type EventState, type Heat } from './state';
import { qualifyingStandings } from '../standings/qualifying';
import { rule43Applies } from '../rules/fleets';
import { undoRaceVerdict, undoRoundVerdict, type Verdict } from './undo';

export type { Verdict } from './undo';

/**
 * A verdict on an action, and whether it belongs to this point of the
 * event (`offered`: a screen shows it, enabled when `ok`, else with the
 * reason). `ok` is what the rules allow; `offered` is what the rules
 * expect next. An action can be allowed and not expected (a heat of a
 * round of several heats that has sailed may sail again, as older records
 * show, but SHRS 3.1 redistributes the boats first), or expected and not
 * yet allowed (Undo round while the round has races).
 */
export type Offer = Verdict & { offered: boolean };

/** A heat of the round being sailed, or a final fleet. */
export interface HeatStatus {
  heat: HeatId;
  series: 'qualifying' | 'final';
  boats: BoatId[];
  /** Races the heat has sailed. */
  races: number;
  /**
   * Score its next race (`races + 1`). Offered while the round still has
   * that race to sail: in a qualifying round of several heats each heat
   * sails once (SHRS 3.1); one heat, or the Final Series, sails on (4.5).
   * A heat with no boats has nothing to sail.
   */
  score: Offer;
  /** Take its last race out. Offered when it has one. */
  undoRace: Offer;
}

/** Why the Final Series cannot start, as a screen may word it. */
export type FinalSeriesCheck =
  | 'OK'
  | 'STARTED'
  | 'NO_HEATS'
  /** One heat: one fleet, no Final Series (SHRS 1.1). */
  | 'SINGLE_FLEET'
  | 'UNEQUAL_RACE_COUNTS'
  /** Nothing to split the fleets on (SHRS 4.2). */
  | 'NO_RACES_COMPLETED'
  /** A round was built and not sailed: undo it, or sail it (parity R7). */
  | 'LATEST_ROUND_UNSAILED'
  /** Refused for a reason none of the above names (see `reason`). */
  | 'REFUSED';

export type FinalSeriesStatus = Offer & {
  check: FinalSeriesCheck;
  /** Fleets the split makes before SHRS 2.3: the round's heats (4.1). */
  fleets: number;
  /** Completed qualifying races. */
  completedRaces: number;
  /** SHRS 4.3 applies to the split (6 or 7 completed races). */
  rule43: boolean;
  /** The latest qualifying round's heats that have boats, and their races. */
  raceCounts: { heat: HeatId; races: number }[];
};

export interface EventStatus {
  /** Before the heats, the qualifying series, or the Final Series. */
  series: 'entries' | 'qualifying' | 'final';
  /** The qualifying round being sailed (null before the heats and in the Final Series). */
  round: number | null;
  /** The heats of that round, or the final fleets (Gold first). */
  heats: HeatStatus[];
  /** The one thing to do next (`nextStep`). */
  next: NextStep;
  /** Build the next qualifying round (offered once the round is sailed). */
  createRound: Offer;
  /** Take back the latest round (offered from round 2, before the Final). */
  undoRound: Offer;
  /** Split the fleets (offered in a qualifying series of several heats). */
  startFinal: FinalSeriesStatus;
}

const offer = (verdict: Verdict, offered: boolean): Offer => ({
  ...verdict,
  offered,
});

const asVerdict = (result: { ok: boolean; reason?: string }): Verdict =>
  result.ok ? { ok: true } : { ok: false, reason: result.reason ?? '' };

/** Better words for the refusals a race officer meets on the way. */
const FINAL_REASONS: Partial<Record<FinalSeriesCheck, string>> = {
  NO_HEATS: 'Create the heats first.',
  SINGLE_FLEET: 'With one heat there is no Final Series (SHRS 1.1).',
  UNEQUAL_RACE_COUNTS:
    'Every heat of this round must sail the same races first.',
  NO_RACES_COMPLETED:
    'No qualifying race is completed yet: the fleets are split on the Qualifying Series ranking (SHRS 4.2).',
};

function finalSeries(state: EventState): FinalSeriesStatus {
  const round = state.fleets
    ? (state.rounds[state.rounds.length - 1] ?? [])
    : currentRound(state);
  const raceCounts = round
    .filter((heat) => heat.boats.length > 0)
    .map((heat) => ({ heat: heat.id, races: heat.races.length }));
  const counts = [...new Set(raceCounts.map((row) => row.races))];
  const { completedRaces } = qualifyingStandings(state);

  let check: FinalSeriesCheck = 'OK';
  if (state.fleets) check = 'STARTED';
  else if (state.rounds.length === 0) check = 'NO_HEATS';
  else if (round.length < 2) check = 'SINGLE_FLEET';
  else if (counts.length > 1) check = 'UNEQUAL_RACE_COUNTS';
  else if (completedRaces === 0) check = 'NO_RACES_COMPLETED';
  else if ((counts[0] ?? 0) === 0) check = 'LATEST_ROUND_UNSAILED';

  const tried = tryDecision(state, { type: 'finalSeriesStarted' });
  if (check === 'OK' && !tried.ok) check = 'REFUSED';
  let verdict: Verdict = asVerdict(tried);
  if (!verdict.ok && check === 'LATEST_ROUND_UNSAILED') {
    verdict = {
      ok: false,
      reason: `Round ${state.rounds.length} has been built but not sailed. The Final Series is split from the qualifying races as sailed: undo that round (or sail it) first.`,
    };
  } else if (!verdict.ok && FINAL_REASONS[check]) {
    verdict = { ok: false, reason: FINAL_REASONS[check]! };
  }
  return {
    ...offer(verdict, !state.fleets && round.length >= 2),
    check,
    fleets: round.length,
    completedRaces,
    rule43: rule43Applies(completedRaces),
    raceCounts,
  };
}

function heatStatus(
  state: EventState,
  heat: Heat,
  due: (heat: Heat) => boolean,
): HeatStatus {
  // A whole valid sheet (every boat, in heat order): what replay checks
  // beyond the sheet itself is whether this heat may sail its next race.
  const score = tryDecision(state, {
    type: 'raceScored',
    race: { heat: heat.id, race: heat.races.length + 1 },
    lines: heat.boats.map((boat) => ({ boat })),
  });
  return {
    heat: heat.id,
    series: heat.series,
    boats: [...heat.boats],
    races: heat.races.length,
    score: offer(asVerdict(score), due(heat)),
    undoRace: offer(undoRaceVerdict(state, heat.id), heat.races.length > 0),
  };
}

/**
 * Where the event stands and what may be done now (see the module comment).
 * Every verdict is the library's: `ok` exactly when `replay` (or the undo
 * that builds the new log) accepts the action.
 */
export function eventStatus(state: EventState): EventStatus {
  let series: EventStatus['series'] = 'entries';
  if (state.fleets) series = 'final';
  else if (state.rounds.length > 0) series = 'qualifying';
  const heats = state.fleets ?? currentRound(state);
  const progress = (heat: Heat) => ({
    heat: heat.id,
    boats: heat.boats.length,
    races: heat.races.length,
  });
  const round = heats.map(progress);
  const due = (heat: Heat) =>
    hasRaceToSail(
      progress(heat),
      series === 'final' ? 'final' : 'qualifying',
      round,
    );
  const next = nextStep(state);

  return {
    series,
    round: series === 'qualifying' ? state.rounds.length : null,
    heats: heats.map((heat) => heatStatus(state, heat, due)),
    next,
    createRound: offer(
      asVerdict(tryDecision(state, { type: 'roundCreated' })),
      next.kind === 'createRound',
    ),
    undoRound: offer(
      undoRoundVerdict(state),
      series === 'qualifying' && state.rounds.length > 1,
    ),
    startFinal: finalSeries(state),
  };
}
