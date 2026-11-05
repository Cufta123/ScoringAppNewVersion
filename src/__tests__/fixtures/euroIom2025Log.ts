/**
 * The IOM European Championship 2025 result sheet as a regatta-core
 * decision log, so the library can be checked against a real, published
 * event (euroIom2025.published.test.ts).
 *
 * The sheet records every boat's place or code in every race, and the final
 * fleets, but not which qualifying heat a boat sailed in. Each qualifying
 * race is therefore one round of five heats rebuilt from the places: the
 * k-th boat on each place goes to heat k, so every heat has places 1, 2, 3…
 * without a gap, and the boats without a place fill the heats up to 20 / 19
 * (the sheet scores them 21: SHRS 5.2, largest heat + 1). A boat's points
 * do not depend on which heat she is put in; ties settled on races sailed
 * in the same heat (SHRS 5.7(ii)) do, which the test says where it matters.
 *
 * Redress: the sheet prints "RDG 13.1" without the method. Where the places
 * of a race have a gap, the redressed boat kept that place (RRS A6.2) and is
 * put there; otherwise she had none and is on the sheet as DNF, the
 * committee's redress replacing it. Her points are the committee's (RDG3,
 * the printed number): the sheet does not say how they were worked out.
 */
import type { Decision, RaceLine } from 'regatta-core';
import {
  publishedResults,
  type PublishedCompetitor,
  type PublishedRace,
} from './euroIom2025';

export const published = publishedResults();

/** Boat ids in sheet order: "b0" is the overall winner. */
export const boatIdOf = (index: number) => `b${index}`;

const raceOf = (competitor: PublishedCompetitor, label: string) =>
  competitor.races.find((race) => race.race === label) as PublishedRace;

interface Cell {
  boat: string;
  race: PublishedRace;
}

const bySail = (a: Cell, b: Cell) => a.boat.localeCompare(b.boat);

/** One qualifying race as five heats and their sheets. */
export function qualifyingRound(label: string) {
  const cells: Cell[] = published.results.map((competitor, i) => ({
    boat: boatIdOf(i),
    race: raceOf(competitor, label),
  }));
  const finishers = cells.filter((cell) => !cell.race.code);
  const redress = cells.filter((cell) => cell.race.code === 'RDG');
  const noPlace = cells.filter(
    (cell) => cell.race.code && cell.race.code !== 'RDG',
  );
  const maxPlace = Math.max(...finishers.map((cell) => cell.race.score));
  const at = (p: number) =>
    finishers.filter((cell) => cell.race.score === p).sort(bySail);
  // Heats reaching place p: as many as boats on any place from p on.
  const needed = (p: number) =>
    Math.max(
      ...Array.from({ length: maxPlace - p + 1 }, (_, i) => at(p + i).length),
    );
  const unplaced = [...redress];
  const heldBy = new Map<string, number>();
  const heats: Cell[][] = [[], [], [], [], []];
  for (let p = 1; p <= maxPlace; p += 1) {
    const here = at(p);
    const gaps = needed(p) - here.length;
    for (let g = 0; g < gaps; g += 1) {
      const kept = unplaced.shift();
      if (!kept) {
        throw new Error(`${label}: place ${p} is missing in a heat`);
      }
      heldBy.set(kept.boat, p);
      here.push(kept);
    }
    here.forEach((cell, k) => heats[k].push(cell));
  }
  // The boats without a place fill the smallest heats.
  [...noPlace, ...unplaced].sort(bySail).forEach((cell) => {
    const smallest = heats.reduce((a, b) => (b.length < a.length ? b : a));
    smallest.push(cell);
  });
  const lines = heats.map((heat) =>
    heat.map((cell): RaceLine => {
      if (cell.race.code === 'RDG') {
        return heldBy.has(cell.boat)
          ? { boat: cell.boat }
          : { boat: cell.boat, code: 'DNF' };
      }
      return cell.race.code
        ? { boat: cell.boat, code: cell.race.code as RaceLine['code'] }
        : { boat: cell.boat };
    }),
  );
  return {
    heats: heats.map((heat) => heat.map((cell) => cell.boat)),
    lines,
    redress: redress.map((cell) => ({
      boat: cell.boat,
      points: cell.race.score,
      heat: heats.findIndex((heat) => heat.includes(cell)),
    })),
    heldPlaces: heldBy,
  };
}

export const QUALIFYING = Array.from({ length: 12 }, (_, i) => `Q${i + 1}`);
export const FINAL = Array.from({ length: 6 }, (_, i) => `F${i + 1}`);
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** The fleets as published, Heat A (Gold) first. */
export const fleetsAsPublished = () =>
  LETTERS.map((letter) =>
    published.results.flatMap((competitor, i) =>
      competitor.heat === `Heat ${letter}` ? [boatIdOf(i)] : [],
    ),
  );

/** One final race of one fleet as its sheet (null: the fleet did not sail it). */
export function finalSheet(fleet: number, label: string): RaceLine[] | null {
  const cells = fleetsAsPublished()[fleet].map((boat) => ({
    boat,
    race: raceOf(published.results[Number(boat.slice(1))], label),
  }));
  if (cells.some((cell) => !cell.race)) return null;
  const finishers = cells
    .filter((cell) => !cell.race.code)
    .sort((a, b) => a.race.score - b.race.score || bySail(a, b));
  const coded = cells.filter((cell) => cell.race.code);
  return [
    ...finishers.map((cell) => ({ boat: cell.boat })),
    ...coded.map((cell) => ({
      boat: cell.boat,
      code: cell.race.code as RaceLine['code'],
    })),
  ];
}

/** The whole event as a log. `fleetIds` names the fleets the replay made. */
export function eventLog(fleetIds: string[] | null = null): Decision[] {
  const log: Decision[] = published.results.map((competitor, i) => ({
    type: 'boatEntered',
    boat: {
      id: boatIdOf(i),
      nat: competitor.country,
      sail: String(competitor.sail_number),
      name: competitor.name,
    },
  }));
  QUALIFYING.forEach((label, r) => {
    const round = qualifyingRound(label);
    log.push(
      r === 0
        ? { type: 'heatsCreated', heatCount: 5, heats: round.heats }
        : { type: 'roundCreated', heats: round.heats },
    );
    round.lines.forEach((lines, h) =>
      log.push({
        type: 'raceScored',
        race: { heat: `${LETTERS[h]}${r + 1}`, race: 1 },
        lines,
      }),
    );
    round.redress.forEach(({ boat, points, heat }) =>
      log.push({
        type: 'protestDecided',
        race: { heat: `${LETTERS[heat]}${r + 1}`, race: 1 },
        boat,
        outcome: { kind: 'RDG3', points },
      }),
    );
  });
  log.push({ type: 'finalSeriesStarted', fleets: fleetsAsPublished() });
  if (!fleetIds) return log;
  fleetIds.forEach((fleet, f) => {
    FINAL.forEach((label, n) => {
      const lines = finalSheet(f, label);
      if (lines) {
        log.push({
          type: 'raceScored',
          race: { heat: fleet, race: n + 1 },
          lines,
        });
      }
    });
  });
  return log;
}
