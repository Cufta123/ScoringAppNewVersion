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

export function nextStep(state: EventState): NextStep {
  if (state.boats.length === 0) return { kind: 'enterBoats' };
  if (state.rounds.length === 0) return { kind: 'createHeats' };

  // One fleet, or the Final Series: every fleet sails the same race, the one
  // behind goes next.
  const fleets = state.fleets ?? currentRound(state);
  if (state.fleets || fleets.length === 1) {
    const behind = fleets.reduce((a, b) =>
      b.races.length < a.races.length ? b : a,
    );
    return { kind: 'score', heat: behind.id, race: behind.races.length + 1 };
  }

  // Several qualifying heats: each sails once, then the next round.
  const unsailed = fleets.find(
    (heat) => heat.boats.length > 0 && heat.races.length === 0,
  );
  if (unsailed) return { kind: 'score', heat: unsailed.id, race: 1 };
  return { kind: 'createRound', round: state.rounds.length + 1 };
}
