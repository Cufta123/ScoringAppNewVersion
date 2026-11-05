/**
 * The Final Series and the overall standings.
 *
 *   SHRS 5.1   each fleet is scored on its own
 *   SHRS 5.4   discards counted per fleet (fleets may sail different
 *              numbers of races, 4.5)
 *   SHRS 1.5   a fleet that has sailed no race is ranked by qualifying
 *   SHRS 5.5   overall = qualifying + final; Gold before Silver before …
 *   SHRS 5.7   ties
 */
import type { BoatId } from '../types';
import { discardCount } from '../rules/discards';
import { exact, noPlacePoints } from '../rules/points';
import {
  bestFirst,
  compareLists,
  compareOnSharedRaces,
  lastRaceFirst,
  rankByTotal,
} from '../rules/ranking';
import { scoreRace } from '../event/score';
import { largestHeat, raceKey, type EventState } from '../event/state';
import { qualifyingStandings } from './qualifying';
import {
  kept,
  settleRedress,
  total,
  type ScoredRace,
  type Standing,
} from './series';

export interface FleetStandings {
  fleet: string;
  races: number;
  standings: Standing[];
}

export interface OverallStanding {
  boat: BoatId;
  place: number;
  /** Final fleet; absent for an event sailed as one fleet or not split yet. */
  fleet?: string;
  qualifying: number;
  final: number;
  total: number;
}

const FINAL_ORDER = 1e8;

export function finalStandings(state: EventState): FleetStandings[] {
  const fleets = state.fleets ?? [];
  const largest = largestHeat(fleets);
  const noPlace = noPlacePoints(largest);
  const qualifying = qualifyingStandings(state).standings;
  const qualifyingPlace = new Map(qualifying.map((s) => [s.boat, s.place]));

  return fleets.map((fleet) => {
    const byBoat = new Map<BoatId, ScoredRace[]>(
      fleet.boats.map((boat) => [boat, []]),
    );
    fleet.races.forEach((race) => {
      scoreRace(race, largest).forEach((result) => {
        byBoat.get(result.boat)?.push({
          ref: race.ref,
          round: 0,
          raceNumber: race.ref.race,
          race: raceKey(race.ref),
          order: FINAL_ORDER + race.ref.race,
          result,
        });
      });
    });
    const discards = discardCount(
      fleet.races.length,
      state.settings.discards.final,
    );
    const entries = fleet.boats.map((boat) => {
      const races = byBoat.get(boat)!;
      return { boat, ...total(settleRedress(races, races, noPlace), discards) };
    });

    if (fleet.races.length === 0) {
      // SHRS 1.5, per fleet: no final race yet, so qualifying order.
      const ordered = [...entries].sort(
        (a, b) => qualifyingPlace.get(a.boat)! - qualifyingPlace.get(b.boat)!,
      );
      let place = 0;
      return {
        fleet: fleet.id,
        races: 0,
        standings: ordered.map((entry, index) => {
          const above = ordered[index - 1];
          if (
            !above ||
            qualifyingPlace.get(above.boat) !== qualifyingPlace.get(entry.boat)
          ) {
            place = index + 1;
          }
          return { ...entry, place };
        }),
      };
    }

    // Ties: A8.1 with every score (excluded too, 5.7(ii)(2)), then A8.2.
    const ranked = rankByTotal(
      entries,
      (entry) => entry.total,
      (a, b) =>
        compareLists(
          bestFirst(a.scores.map((s) => s.points)),
          bestFirst(b.scores.map((s) => s.points)),
        ) || compareLists(lastRaceFirst(a.scores), lastRaceFirst(b.scores)),
    );
    return {
      fleet: fleet.id,
      races: fleet.races.length,
      standings: ranked.map(({ item, place }) => ({ ...item, place })),
    };
  });
}

export function overallStandings(state: EventState): OverallStanding[] {
  const qualifying = qualifyingStandings(state).standings;
  if (!state.fleets) {
    return qualifying.map((s) => ({
      boat: s.boat,
      place: s.place,
      qualifying: s.total,
      final: 0,
      total: s.total,
    }));
  }
  const byBoat = new Map(qualifying.map((s) => [s.boat, s]));
  const overall: OverallStanding[] = [];
  finalStandings(state).forEach((fleet) => {
    const entries = fleet.standings.map((f) => {
      const q = byBoat.get(f.boat);
      const qScores = q?.scores ?? [];
      return {
        boat: f.boat,
        qualifying: q?.total ?? 0,
        final: f.total,
        total: exact((q?.total ?? 0) + f.total),
        scores: [...qScores, ...f.scores],
        keptBest: bestFirst([...kept(qScores), ...kept(f.scores)]),
      };
    });
    // SHRS 5.7(ii) across both series.
    const ranked = rankByTotal(
      entries,
      (entry) => entry.total,
      (a, b) =>
        compareOnSharedRaces(a.scores, b.scores) ??
        (compareLists(a.keptBest, b.keptBest) ||
          compareLists(lastRaceFirst(a.scores), lastRaceFirst(b.scores))),
    );
    const offset = overall.length;
    ranked.forEach(({ item, place }) => {
      overall.push({
        boat: item.boat,
        place: offset + place,
        fleet: fleet.fleet,
        qualifying: item.qualifying,
        final: item.final,
        total: item.total,
      });
    });
  });
  return overall;
}
