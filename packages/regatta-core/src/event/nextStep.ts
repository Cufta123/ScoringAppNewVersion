/**
 * The one thing the race office does next, for the scoring screen.
 */
import type { HeatId } from '../types';
import { currentRound, type EventState } from './state';

export type NextStep =
  | { kind: 'enterBoats' }
  | { kind: 'createHeats' }
  /** Score this heat's next race. */
  | { kind: 'score'; heat: HeatId; race: number }
  /** The round is sailed: build the next one (or start the Final Series). */
  | { kind: 'createRound'; round: number };

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
  const unsailed = heats.find((heat) => heat.boats > 0 && heat.races === 0);
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
  return { kind: 'createRound', round: state.rounds.length + 1 };
}
