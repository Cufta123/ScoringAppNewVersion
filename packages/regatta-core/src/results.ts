/**
 * The library's file format: an event file in, a results document out.
 * Both are plain JSON. `schema/event.schema.json` and
 * `schema/results.schema.json` are generated from these types
 * (`npm run schema`).
 *
 * The results are a stable public shape, kept apart from the internal
 * types: changing how the library works inside must not change this
 * format by accident.
 */
import type { Boat, BoatId, Decision, HeatId, Settings } from './types';
import { replay } from './event/replay';
import type { EventState, Heat } from './event/state';
import { nextStep, type NextStep } from './event/nextStep';
import { qualifyingStandings } from './standings/qualifying';
import { finalStandings, overallStandings } from './standings/final';
import type { Score, Standing } from './standings/series';

/** An event file: the event's decision log, oldest first. */
export interface EventFile {
  /** Optional link to `schema/event.schema.json`, for editors. */
  $schema?: string;
  /** A name for the event; copied to the results. */
  name?: string;
  decisions: Decision[];
}

/** One boat's score in one race. */
export interface RaceScore {
  /** The heat she sailed it in; null for a DNC in a race she had no heat for. */
  heat: HeatId | null;
  /** The race's number in that heat; null with `heat`. */
  race: number | null;
  /** Qualifying round; 0 in the Final Series. */
  round: number;
  /** The race's number in its round (qualifying) or fleet (final). */
  raceNumber: number;
  /** Her finishing place, when she holds one. */
  place?: number;
  /** DNF, DSQ, RDG1, ZFP, … */
  code?: string;
  points: number;
  /** Left out of her series score (SHRS 5.4). */
  excluded: boolean;
}

export interface SeriesStanding {
  boat: BoatId;
  place: number;
  total: number;
  scores: RaceScore[];
  /** Placed by plain RRS A8 because the 5.7 tie-break went in a circle. */
  circular?: boolean;
}

export interface FleetResults {
  /** "Gold", "Silver", … */
  fleet: string;
  /** Races the fleet has sailed. */
  races: number;
  standings: SeriesStanding[];
}

export interface OverallResult {
  boat: BoatId;
  place: number;
  /** Final fleet; absent for an event sailed as one fleet or not split yet. */
  fleet?: string;
  qualifying: number;
  final: number;
  total: number;
  circular?: boolean;
}

export interface HeatSummary {
  id: HeatId;
  /** Its boats, in the order they were assigned. */
  boats: BoatId[];
  /** Races the heat has sailed. */
  races: number;
}

/** A decision the rules do not allow; the results are the event before it. */
export interface Refusal {
  /** Index of the refused decision in `decisions` (0-based). */
  at: number;
  reason: string;
  decision: Decision;
}

export interface Results {
  name?: string;
  /** Present when a decision was refused; everything else is the event before it. */
  refused?: Refusal;
  settings: Settings;
  boats: Boat[];
  /** Qualifying rounds, first round first; each round's heats A, B, … */
  rounds: HeatSummary[][];
  /** Final fleets, Gold first; null until the Final Series starts. */
  fleets: HeatSummary[] | null;
  nextStep: NextStep;
  qualifying: {
    /** Qualifying races that count (every heat of the round sailed them). */
    completedRaces: number;
    standings: SeriesStanding[];
    /** Races of the round still being sailed, by boat; in no total yet. */
    pending: Record<BoatId, RaceScore[]>;
  };
  final: FleetResults[];
  overall: OverallResult[];
}

const raceScore = (score: Score): RaceScore => ({
  heat: score.ref?.heat ?? null,
  race: score.ref?.race ?? null,
  round: score.round,
  raceNumber: score.raceNumber,
  ...(score.place !== undefined ? { place: score.place } : {}),
  ...(score.code !== undefined ? { code: score.code } : {}),
  points: score.points,
  excluded: score.excluded,
});

const seriesStanding = (standing: Standing): SeriesStanding => ({
  boat: standing.boat,
  place: standing.place,
  total: standing.total,
  scores: standing.scores.map(raceScore),
  ...(standing.circular ? { circular: true } : {}),
});

const heatSummary = (heat: Heat): HeatSummary => ({
  id: heat.id,
  boats: [...heat.boats],
  races: heat.races.length,
});

/** Everything a results page shows, for an event as `state` holds it. */
export function resultsOf(state: EventState): Results {
  const qualifying = qualifyingStandings(state);
  const pending: Record<BoatId, RaceScore[]> = {};
  Object.entries(qualifying.pending).forEach(([boat, scores]) => {
    pending[boat] = scores.map(raceScore);
  });
  return {
    settings: structuredClone(state.settings),
    boats: state.boats.map((boat) => ({ ...boat })),
    rounds: state.rounds.map((round) => round.map(heatSummary)),
    fleets: state.fleets ? state.fleets.map(heatSummary) : null,
    nextStep: nextStep(state),
    qualifying: {
      completedRaces: qualifying.completedRaces,
      standings: qualifying.standings.map(seriesStanding),
      pending,
    },
    final: finalStandings(state).map((fleet) => ({
      fleet: fleet.fleet,
      races: fleet.races,
      standings: fleet.standings.map(seriesStanding),
    })),
    overall: overallStandings(state).map((o) => ({ ...o })),
  };
}

/** An event file in, its results out. A refusal is reported, not thrown. */
export function results(file: EventFile): Results {
  const replayed = replay(file.decisions);
  return {
    ...(file.name !== undefined ? { name: file.name } : {}),
    ...(replayed.ok
      ? {}
      : {
          refused: {
            at: replayed.at,
            reason: replayed.reason,
            decision: file.decisions[replayed.at],
          },
        }),
    ...resultsOf(replayed.state),
  };
}
