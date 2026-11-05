/**
 * The one thing the race office does next, for the scoring screen.
 */
import type { HeatId } from '../types';
import { currentRound, type EventState } from './state';
import { tryDecision } from './replay';

export type NextStep =
  | { kind: 'enterBoats' }
  | { kind: 'createHeats' }
  /** Score this heat's next race. */
  | { kind: 'score'; heat: HeatId; race: number }
  /**
   * The qualifying round is sailed: build round `round`, or, when
   * `finalSeries` is true, the Final Series may start instead (SHRS 4.1).
   */
  | { kind: 'createRound'; round: number; finalSeries: boolean };

/** A heat of the current round (or a final fleet), as far as it has sailed. */
export interface HeatProgress<H> {
  heat: H;
  /** Boats in the heat; an empty heat has nothing to sail. */
  boats: number;
  /** Races the heat has sailed. */
  races: number;
}

/** The next step inside the current round, for any heat type the caller has. */
export type RoundStep<H> =
  | { kind: 'score'; heat: H; race: number }
  | { kind: 'roundComplete' };

/**
 * Whether `heat` still has a race to sail in its round (`heats`, the round's
 * heats or the final fleets): one heat, or the Final Series, sails on (SHRS
 * 4.5); in a qualifying round of several heats each heat sails once (SHRS
 * 3.1), then the boats are redistributed. A heat with no boats has nothing
 * to sail.
 */
export function hasRaceToSail(
  heat: HeatProgress<unknown>,
  series: 'qualifying' | 'final',
  heats: ReadonlyArray<HeatProgress<unknown>>,
): boolean {
  if (heat.boats === 0) return false;
  return series === 'final' || heats.length === 1 || heat.races === 0;
}

/**
 * The next step inside the current round, from how far each heat has sailed
 * (the screen's heats, or the library's): `nextStep` without an event.
 *
 * One heat, or the Final Series: every fleet sails the same race, the one
 * behind goes next (SHRS 4.5 lets fleets sail on; the first behind is
 * named). Several qualifying heats: each sails once (SHRS 3.1), then the
 * round is complete; a heat with no boats has nothing to sail.
 */
export function nextInRound<H>(
  heats: ReadonlyArray<HeatProgress<H>>,
  series: 'qualifying' | 'final',
): RoundStep<H> | null {
  if (heats.length === 0) return null;
  if (series === 'final' || heats.length === 1) {
    const behind = heats.reduce((a, b) => (b.races < a.races ? b : a));
    return { kind: 'score', heat: behind.heat, race: behind.races + 1 };
  }
  const unsailed = heats.find((heat) => hasRaceToSail(heat, series, heats));
  if (unsailed) return { kind: 'score', heat: unsailed.heat, race: 1 };
  return { kind: 'roundComplete' };
}

export function nextStep(state: EventState): NextStep {
  if (state.boats.length === 0) return { kind: 'enterBoats' };
  if (state.rounds.length === 0) return { kind: 'createHeats' };

  const heats = state.fleets ?? currentRound(state);
  const step = nextInRound(
    heats.map((heat) => ({
      heat: heat.id,
      boats: heat.boats.length,
      races: heat.races.length,
    })),
    state.fleets ? 'final' : 'qualifying',
  );
  if (step?.kind === 'score') return step;
  return {
    kind: 'createRound',
    round: state.rounds.length + 1,
    finalSeries: tryDecision(state, { type: 'finalSeriesStarted' }).ok,
  };
}
