/**
 * The Qualifying Series standings (or the whole event, sailed as one fleet).
 *
 * A qualifying race counts once every heat of its round has sailed it
 * (SHRS 1.1: a race is all its heats). Every entered boat is scored in every
 * counted race (RRS A5.1); a boat that had no heat for it is DNC. Races of a
 * round still being sailed are shown apart and count for nothing yet.
 */
import type { BoatId } from '../types';
import { discardCount } from '../rules/discards';
import { rule43Applies, splitTotal } from '../rules/fleets';
import { noPlacePoints } from '../rules/points';
import {
  bestFirst,
  compareLists,
  compareOnSharedRaces,
  lastRaceFirst,
  rankByTotal,
} from '../rules/ranking';
import { compareBoats } from '../rules/seeding';
import { scoreRace, type BoatResult } from '../event/score';
import {
  largestHeat,
  raceKey,
  type EventState,
  type Heat,
} from '../event/state';
import {
  kept,
  settleRedress,
  total,
  type ScoredRace,
  type Score,
  type Standing,
} from './series';

export interface QualifyingStandings {
  /** Races that count, in the order sailed. */
  completedRaces: number;
  standings: Standing[];
  /** Results of the round still being sailed, by boat; not in any total. */
  pending: Record<BoatId, Score[]>;
}

const withBoats = (heats: Heat[]) => heats.filter((h) => h.boats.length > 0);

/** Every boat's scored races: counted, and still pending. */
function scoredRaces(state: EventState) {
  const largest = largestHeat(state.rounds.flat());
  const counted = new Map<BoatId, ScoredRace[]>();
  const pending = new Map<BoatId, ScoredRace[]>();
  state.boats.forEach((boat) => {
    counted.set(boat.id, []);
    pending.set(boat.id, []);
  });
  let completed = 0;

  state.rounds.forEach((round) => {
    const heats = withBoats(round);
    if (heats.length === 0) return;
    const done = Math.min(...heats.map((heat) => heat.races.length));
    const sailed = Math.max(...heats.map((heat) => heat.races.length));
    for (let n = 1; n <= sailed; n += 1) {
      const isCounted = n <= done;
      if (isCounted) completed += 1;
      const order = round[0].round * 10000 + n;
      const results = new Map<BoatId, ScoredRace>();
      heats.forEach((heat) => {
        const race = heat.races[n - 1];
        if (!race) return;
        scoreRace(race, largest).forEach((result) => {
          results.set(result.boat, {
            ref: race.ref,
            round: heat.round,
            raceNumber: n,
            race: raceKey(race.ref),
            order,
            result,
          });
        });
      });
      // A boat with no heat in a counted race: DNC. She competed in no heat,
      // so the race is shared with nobody for SHRS 5.7(ii)(1).
      const anchor = heats.find((heat) => heat.races[n - 1])!;
      state.boats.forEach((boat) => {
        const own = results.get(boat.id);
        if (isCounted) {
          counted.get(boat.id)!.push(
            own ?? {
              ref: null,
              round: anchor.round,
              raceNumber: n,
              race: `${raceKey(anchor.races[n - 1].ref)}~${boat.id}`,
              order,
              result: noHeatResult(boat.id, heats, n, largest),
            },
          );
        } else if (own) {
          pending.get(boat.id)!.push(own);
        }
      });
    }
  });
  return { largest, counted, pending, completed };
}

/**
 * A boat with no heat in race `n` of a round: DNC (RRS A5.1), unless the
 * protest committee gave her redress for it, filed under one of the
 * round's races (replay allows only redress there).
 */
function noHeatResult(
  boat: BoatId,
  heats: Heat[],
  n: number,
  largest: number,
): BoatResult {
  const dnc: BoatResult = { boat, code: 'DNC', points: noPlacePoints(largest) };
  const outcome = heats
    .map((heat) => heat.races[n - 1]?.protests[boat])
    .find((decided) => decided !== undefined);
  switch (outcome?.kind) {
    case 'RDG3':
      return { boat, code: 'RDG3', points: outcome.points };
    case 'RDG1':
      return { ...dnc, code: 'RDG1', pending: { races: 'all' } };
    case 'RDG2':
      return { ...dnc, code: 'RDG2', pending: { races: outcome.races } };
    default:
      return dnc;
  }
}

interface Entry {
  boat: BoatId;
  total: number;
  scores: Score[];
  keptBest: number[];
}

/**
 * SHRS 5.7: in a single-heat event, plain RRS A8.1 and A8.2 (5.7(i)). With
 * several heats, boats that met are compared on the races they sailed in
 * the same heat, excluded scores included, then A8.2 on those races; boats
 * that never met: plain A8.1, then A8.2 (5.7(ii)).
 */
function tieBreak(singleHeat: boolean) {
  return (a: Entry, b: Entry): number =>
    singleHeat
      ? plainA8(a, b)
      : (compareOnSharedRaces(a.scores, b.scores) ?? plainA8(a, b));
}

/**
 * RRS A8.1 then A8.2 without SHRS changes: the way out of a 5.7 circle,
 * as 5.7(ii)(4) does for boats that never met.
 */
export function plainA8(a: Entry, b: Entry): number {
  return (
    compareLists(a.keptBest, b.keptBest) ||
    compareLists(lastRaceFirst(a.scores), lastRaceFirst(b.scores))
  );
}

/** SHRS 1.1: one heat per race, so the event is sailed as one fleet. */
const singleHeatEvent = (state: EventState) =>
  state.rounds.every((round) => withBoats(round).length <= 1);

function buildQualifying(state: EventState) {
  const { largest, counted, pending, completed } = scoredRaces(state);
  const noPlace = noPlacePoints(largest);
  const discards = discardCount(completed, state.settings.discards.qualifying);
  // Boat order first: boats sharing a place are listed this way (SHRS 5.3).
  const entries: Entry[] = [...state.boats]
    .sort(compareBoats)
    .filter((boat) => counted.get(boat.id)!.length > 0)
    .map((boat) => {
      const races = counted.get(boat.id)!;
      const series = total(settleRedress(races, races, noPlace), discards);
      return {
        boat: boat.id,
        ...series,
        keptBest: bestFirst(kept(series.scores)),
      };
    });
  return {
    entries,
    compare: tieBreak(singleHeatEvent(state)),
    completed,
    noPlace,
    counted,
    pending,
  };
}

export function qualifyingStandings(state: EventState): QualifyingStandings {
  const { entries, compare, completed, noPlace, counted, pending } =
    buildQualifying(state);
  const ranked = rankByTotal(entries, (entry) => entry.total, compare, plainA8);

  const pendingByBoat: Record<BoatId, Score[]> = {};
  pending.forEach((races, boat) => {
    if (races.length > 0) {
      pendingByBoat[boat] = settleRedress(races, counted.get(boat)!, noPlace);
    }
  });

  return {
    completedRaces: completed,
    standings: ranked.map(({ item, place, circular }) => ({
      boat: item.boat,
      place,
      total: item.total,
      scores: item.scores,
      ...(circular ? { circular } : {}),
    })),
    pending: pendingByBoat,
  };
}

/**
 * The SHRS 5.7 tie-break between two boats on equal qualifying points:
 * negative when `a` is ahead, 0 when the rules cannot separate them. For a
 * "why is she ahead?" explanation, and to check an order.
 */
export function qualifyingTieBreak(state: EventState) {
  const { entries, compare } = buildQualifying(state);
  const byBoat = new Map(entries.map((entry) => [entry.boat, entry]));
  return (a: BoatId, b: BoatId) => compare(byBoat.get(a)!, byBoat.get(b)!);
}

/**
 * The order boats are split into final fleets (SHRS 4.2, 4.3): qualifying
 * ranking, re-ordered by the 4.3 total when 6 or 7 races are completed.
 * Boats that withdrew (WTH) are returned in `withdrawn`.
 */
export function finalSplitRanking(state: EventState, rule43: boolean) {
  const { completedRaces, standings } = qualifyingStandings(state);
  const discards = discardCount(
    completedRaces,
    state.settings.discards.qualifying,
  );
  const apply43 = rule43 && rule43Applies(completedRaces);
  const ranked = standings
    .map((standing) => ({
      boat: standing.boat,
      splitTotal: splitTotal(standing.scores, discards, apply43),
    }))
    .sort((a, b) => a.splitTotal - b.splitTotal)
    .map((entry) => entry.boat);
  const withdrawn = new Set(
    standings
      .filter((s) => s.scores.some((score) => score.code === 'WTH'))
      .map((s) => s.boat),
  );
  return { ranked, withdrawn };
}
