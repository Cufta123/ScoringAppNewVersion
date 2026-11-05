/**
 * One race's points, from the race office's sheet and the protest
 * committee's decisions.
 *
 *   RRS A4     place = points
 *   RRS A7     boats level share the points of the places they fill
 *   RRS A6.1   a boat disqualified after finishing leaves the order and the
 *              boats behind move up
 *   RRS A6.2   redress (and A10 DPI) changes no other boat's score
 *   SHRS 5.2   no place: largest heat of the series + 1
 *   44.3(c)/T1 penalties keep the place and add 20% / 30% of the DNF score
 *              to the points she would have had (2025-2028 rules)
 *
 * Average redress (RDG1, RDG2) depends on the boat's other races, so it is
 * left open here (`pending`) and filled in by the series.
 */
import type { BoatId, NoPlaceCode, ProtestOutcome, RaceRef } from '../types';
import { noPlacePoints, penaltyPoints } from '../rules/points';
import type { Race } from './state';

export interface BoatResult {
  boat: BoatId;
  /** Her finishing place, when she holds one. */
  place?: number;
  /** What the results show instead of, or next to, the place. */
  code?: string;
  points: number;
  /** Average redress still to work out: the races to average, or all. */
  pending?: { races: RaceRef[] | 'all' };
}

const OUT_OF_ORDER = new Set(['DSQ', 'DNE', 'DGM']);

export function scoreRace(race: Race, largest: number): BoatResult[] {
  const dnf = noPlacePoints(largest);
  const decided = (boat: BoatId): ProtestOutcome | undefined =>
    race.protests[boat];

  // Finishers in groups of boats level with each other (A7). Groups are made
  // from the sheet first, so a tie survives a disqualification beside it.
  const groups: BoatId[][] = [];
  race.lines.forEach((line) => {
    if (line.code) return;
    if (line.tied && groups.length > 0)
      groups[groups.length - 1].push(line.boat);
    else groups.push([line.boat]);
  });

  const results = new Map<BoatId, BoatResult>();
  let next = 1;
  groups.forEach((group) => {
    const holders = group.filter(
      (boat) => !OUT_OF_ORDER.has(decided(boat)?.kind ?? ''),
    );
    if (holders.length === 0) return;
    const place = next;
    const shared = place + (holders.length - 1) / 2;
    holders.forEach((boat) => {
      const line = race.lines.find((l) => l.boat === boat)!;
      results.set(boat, {
        boat,
        place,
        ...(line.penalty
          ? {
              code: line.penalty,
              points: penaltyPoints(shared, largest, line.penalty),
            }
          : { points: shared }),
      });
    });
    next += holders.length;
  });

  race.lines.forEach((line) => {
    if (!results.has(line.boat)) {
      results.set(line.boat, {
        boat: line.boat,
        code: line.code as NoPlaceCode,
        points: dnf,
      });
    }
  });

  // The committee's decisions override the score (the order is settled).
  Object.entries(race.protests).forEach(([boat, outcome]) => {
    const result = results.get(boat);
    if (!result) return;
    switch (outcome.kind) {
      case 'DSQ':
      case 'DNE':
      case 'DGM':
        results.set(boat, { boat, code: outcome.kind, points: dnf });
        break;
      case 'DPI':
      case 'RDG3':
        results.set(boat, {
          ...result,
          code: outcome.kind,
          points: outcome.points,
        });
        break;
      case 'RDG1':
        results.set(boat, {
          ...result,
          code: 'RDG1',
          pending: { races: 'all' },
        });
        break;
      case 'RDG2':
        results.set(boat, {
          ...result,
          code: 'RDG2',
          pending: { races: outcome.races },
        });
        break;
      default:
        break;
    }
  });

  return race.lines.map((line) => results.get(line.boat)!);
}
