/**
 * The event as the decisions so far have left it: who is entered, the heats
 * with their boats, and each race's result sheet. Scores and standings are
 * not kept here; `standings/` works them out from this.
 */
import type {
  Boat,
  BoatId,
  HeatId,
  ProtestOutcome,
  RaceLine,
  RaceRef,
  Settings,
} from '../types';
import { compareBoats } from '../rules/seeding';

export interface Race {
  ref: RaceRef;
  /** The race office's sheet (scoring, then any corrections). */
  lines: RaceLine[];
  /** Protest committee decisions in force, by boat. */
  protests: Record<BoatId, ProtestOutcome>;
}

export interface Heat {
  id: HeatId;
  series: 'qualifying' | 'final';
  /** Index in the heat list of its round ("A" = 0), or fleet index. */
  index: number;
  /** Qualifying round; 0 for a final fleet. */
  round: number;
  boats: BoatId[];
  races: Race[];
}

export interface EventState {
  settings: Settings;
  /** Entered boats, in entry order. */
  boats: Boat[];
  /** Qualifying rounds, first round first; each round's heats A, B, … */
  rounds: Heat[][];
  /** Final fleets, Gold first; null until the Final Series starts. */
  fleets: Heat[] | null;
}

export function groupLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export function allHeats(state: EventState): Heat[] {
  return [...state.rounds.flat(), ...(state.fleets ?? [])];
}

export function findHeat(state: EventState, id: HeatId): Heat | undefined {
  return allHeats(state).find((heat) => heat.id === id);
}

export function findRace(state: EventState, ref: RaceRef): Race | undefined {
  return findHeat(state, ref.heat)?.races[ref.race - 1];
}

export function boatById(state: EventState, id: BoatId): Boat | undefined {
  return state.boats.find((boat) => boat.id === id);
}

export function currentRound(state: EventState): Heat[] {
  return state.rounds[state.rounds.length - 1] ?? [];
}

/** SHRS 5.2: the number of boats in the largest heat of the series. */
export function largestHeat(heats: readonly Heat[]): number {
  return heats.reduce((max, heat) => Math.max(max, heat.boats.length), 0);
}

export const raceKey = (ref: RaceRef) => `${ref.heat}#${ref.race}`;

/**
 * Boats sorted by national letters and sail number (SHRS 3, 3.1(iv), 5.3).
 * Standings rank from this order, so boats the rules cannot separate share
 * a place listed this way, and the Final split takes them this way (4.2
 * says no more; this follows SHRS's own order for ties).
 */
export function inBoatOrder<T extends { boat: BoatId }>(
  state: EventState,
  items: readonly T[],
): T[] {
  const byId = new Map(state.boats.map((boat) => [boat.id, boat]));
  return [...items].sort((a, b) => {
    const x = byId.get(a.boat);
    const y = byId.get(b.boat);
    return x && y ? compareBoats(x, y) : 0;
  });
}
