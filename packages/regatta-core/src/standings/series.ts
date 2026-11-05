/**
 * What every series standing is made of: a boat's scores, which of them are
 * excluded, and her total.
 */
import type { BoatId, RaceRef } from '../types';
import { excludedScores } from '../rules/discards';
import { redressAverage, sum } from '../rules/points';
import type { TieScore } from '../rules/ranking';
import type { BoatResult } from '../event/score';

export interface Score extends TieScore {
  /** The race she sailed; null for a DNC in a race she had no heat for. */
  ref: RaceRef | null;
  /** Qualifying round (0 in the Final Series) and race in that round. */
  round: number;
  raceNumber: number;
  place?: number;
  code?: string;
  /** Left out of her series score (SHRS 5.4). */
  excluded: boolean;
}

export interface Standing {
  boat: BoatId;
  place: number;
  total: number;
  scores: Score[];
}

export interface ScoredRace {
  ref: RaceRef | null;
  round: number;
  raceNumber: number;
  /** Tie-break identity: boats with the same `race` met in one heat. */
  race: string;
  order: number;
  result: BoatResult;
}

const sameRef = (a: RaceRef | null, b: RaceRef) =>
  a !== null && a.heat === b.heat && a.race === b.race;

/**
 * Fill in average redress (RRS A9, SHRS 5.6): the average of her other
 * races in `pool` (the counted races of the same series), or of the races
 * the committee chose. With nothing to average she scores as a boat with no
 * place until there is.
 */
export function settleRedress(
  races: ScoredRace[],
  pool: ScoredRace[],
  noPlace: number,
): Score[] {
  return races.map(({ result, ...race }) => {
    let { points } = result;
    if (result.pending) {
      const { races: chosen } = result.pending;
      const others = pool.filter(
        (other) =>
          other.race !== race.race &&
          (chosen === 'all' || chosen.some((ref) => sameRef(other.ref, ref))),
      );
      points =
        redressAverage(
          others.map((other) => ({
            points: other.result.points,
            averaged: other.result.pending !== undefined,
          })),
        ) ?? noPlace;
    }
    return {
      ...race,
      place: result.place,
      code: result.code,
      points,
      excluded: false,
    };
  });
}

/** Mark her excluded scores and total the rest. */
export function total(
  scores: Score[],
  discards: number,
): { total: number; scores: Score[] } {
  const excluded = excludedScores(scores, discards);
  const marked = scores.map((score, index) => ({
    ...score,
    excluded: excluded.has(index),
  }));
  return {
    total: sum(marked.filter((s) => !s.excluded).map((s) => s.points)),
    scores: marked,
  };
}

export const kept = (scores: Score[]) =>
  scores.filter((score) => !score.excluded).map((score) => score.points);
