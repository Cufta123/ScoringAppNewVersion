/**
 * Series scoring core: a boat's race scores in, places out. Pure — no
 * database and no UI — so the desktop app's recompute, the explain panel and
 * any future results viewer score an event with the same code.
 *
 *   SHRS 5.4   discards (series-wide count, capped per boat; DNE/DGM kept)
 *   SHRS 5.7   tie-break: 5.7.1 single-heat, 5.7.2 multi-heat (shared heats
 *              first, excluded scores included), else RRS A8.1 / A8.2
 *   RRS A8     boats still level after every step share the place
 *
 * Callers load the scores; nothing here reads them.
 */
import { DiscardConfig, getExcludeCountForConfig } from '../discardProfile';
import { sumPoints } from '../points';
import { capExcludeCountForBoat, getKeptScores } from './discards';
import {
  assignPlaces,
  compareScoreArrays,
  findUnbrokenTies,
  resolveTiesSequentially,
} from './ranking';

/** One race score of one boat. */
export interface RaceScore {
  race_id: number;
  /** Race number within its heat (qualifying heats each restart at 1). */
  race_number: number;
  points: number;
  status?: string;
}

export interface SeriesBoat<Id = string> {
  boat_id: Id;
  scores: RaceScore[];
}

export interface RankedBoat<Id = string> {
  boat_id: Id;
  totalPoints: number;
  place: number;
}

/** Worst score first; equal scores by earliest race (the discard order). */
const worstFirst = (a: RaceScore, b: RaceScore) =>
  b.points - a.points || a.race_number - b.race_number || a.race_id - b.race_id;

/** Last race first (RRS A8.2). */
type RaceRef = Pick<RaceScore, 'race_id' | 'race_number'>;
const latestFirst = (a: RaceRef, b: RaceRef) =>
  b.race_number - a.race_number || b.race_id - a.race_id;

const ascending = (a: number, b: number) => a - b;

/** A boat's series score under a series-wide discard count. */
export function scoreBoatSeries(
  scores: RaceScore[],
  seriesExcludeCount: number,
): { totalPoints: number; keptPoints: number[] } {
  const ordered = [...scores].sort(worstFirst);
  const excludeCount = capExcludeCountForBoat(
    seriesExcludeCount,
    ordered.length,
  );
  const keptPoints = getKeptScores(ordered, excludeCount);
  // sumPoints: equal totals must compare equal or the tie-break is skipped
  // (tenth-point redress leaves float noise in a plain sum).
  return { totalPoints: sumPoints(keptPoints), keptPoints };
}

/**
 * Order boats by total, break equal totals with `compare` (highest place
 * first, SHRS 5.7(ii)(3)), and number them, sharing a place where `compare`
 * cannot separate two boats. Boats with equal totals keep their input order
 * until the tie-break orders them.
 */
function rankByTotal<T extends { boat_id: unknown; totalPoints: number }>(
  boats: T[],
  compare: (left: T, right: T) => number,
): Array<T & { place: number }> {
  const byTotal = new Map<number, T[]>();
  boats.forEach((boat) => {
    if (!byTotal.has(boat.totalPoints)) byTotal.set(boat.totalPoints, []);
    byTotal.get(boat.totalPoints)!.push(boat);
  });

  const tiedWithAbove = new Set<string>();
  const ordered = [...byTotal.keys()].sort(ascending).flatMap((total) => {
    const group = byTotal.get(total)!;
    if (group.length === 1) return group;
    const resolved = resolveTiesSequentially(group, compare);
    findUnbrokenTies(resolved, compare).forEach((id) => tiedWithAbove.add(id));
    return resolved;
  });

  const table = ordered.map((boat) => ({ ...boat, place: 0 }));
  assignPlaces(table, tiedWithAbove);
  return table;
}

/** What the qualifying tie-break needs to know about one boat. */
export interface QualifyingTieBoat<Id = string> {
  boat_id: Id;
  /** Scores kept after discards, best first. */
  keptAscending: number[];
  scores: RaceScore[];
}

/**
 * SHRS 5.7.1 vs 5.7.2: an event is single-heat only when every boat sailed
 * exactly the same races. It is a property of the event, never of one pair.
 */
export function isSingleHeatSeries(boats: Array<{ scores: RaceScore[] }>) {
  if (boats.length === 0) return true;
  const reference = new Set(boats[0].scores.map((s) => s.race_id));
  return boats.every(
    ({ scores }) =>
      scores.length === reference.size &&
      scores.every((s) => reference.has(s.race_id)),
  );
}

/**
 * The races two boats sailed together (same race_id), last race first, as
 * the A8.1 vectors (best first) and the A8.2 vectors (last race first).
 * Null when they never met.
 */
export function sharedRaceScores(a: RaceScore[], b: RaceScore[]) {
  const byRaceB = new Map(b.map((score) => [score.race_id, score]));
  const shared = a
    .filter((score) => byRaceB.has(score.race_id))
    .map((score) => ({
      race_id: score.race_id,
      race_number: score.race_number,
      pointsA: score.points,
      pointsB: byRaceB.get(score.race_id)!.points,
    }))
    .sort(latestFirst);
  if (shared.length === 0) return null;
  return {
    a81A: shared.map((s) => s.pointsA).sort(ascending),
    a81B: shared.map((s) => s.pointsB).sort(ascending),
    a82A: shared.map((s) => s.pointsA),
    a82B: shared.map((s) => s.pointsB),
  };
}

/**
 * The qualifying tie-break between two boats on equal points.
 *
 * Boats that met in at least one heat: SHRS 5.7.1 (single-heat event: A8.1
 * on kept scores) or 5.7.2.2 (multi-heat: A8.1 on the shared races, excluded
 * scores included), then A8.2 on the shared races. Boats that never met:
 * plain A8.1 on kept scores, then A8.2 on all races (5.7.2.5).
 *
 * 0 means still tied: the boats share the place (SHRS 5.7(ii)(4)), and no
 * order is invented from an internal id.
 */
export function compareQualifyingTie<Id>(
  a: QualifyingTieBoat<Id>,
  b: QualifyingTieBoat<Id>,
  singleHeatEvent: boolean,
): number {
  const shared = sharedRaceScores(a.scores, b.scores);
  if (shared) {
    const a81 = singleHeatEvent
      ? compareScoreArrays(a.keptAscending, b.keptAscending)
      : compareScoreArrays(shared.a81A, shared.a81B);
    if (a81 !== 0) return a81;
    return compareScoreArrays(shared.a82A, shared.a82B);
  }

  const a81 = compareScoreArrays(a.keptAscending, b.keptAscending);
  if (a81 !== 0) return a81;
  return compareScoreArrays(
    [...a.scores].sort(latestFirst).map((s) => s.points),
    [...b.scores].sort(latestFirst).map((s) => s.points),
  );
}

export interface SeriesOptions {
  discardConfig: DiscardConfig;
  /**
   * Races completed in the series (SHRS 5.4 counts the series, not each
   * boat). Defaults to the most races any boat has a score for.
   */
  seriesRaceCount?: number;
}

const mostRaces = (boats: Array<{ scores: RaceScore[] }>) =>
  boats.reduce((max, boat) => Math.max(max, boat.scores.length), 0);

/** Places in a qualifying series (SHRS 5.4, 5.7; RRS A8). */
export function rankQualifyingSeries<Id>(
  boats: SeriesBoat<Id>[],
  { discardConfig, seriesRaceCount = mostRaces(boats) }: SeriesOptions,
): RankedBoat<Id>[] {
  const seriesExcludeCount = getExcludeCountForConfig(
    seriesRaceCount,
    discardConfig,
  );
  const singleHeatEvent = isSingleHeatSeries(boats);

  const scored = boats.map((boat) => {
    const { totalPoints, keptPoints } = scoreBoatSeries(
      boat.scores,
      seriesExcludeCount,
    );
    return {
      boat_id: boat.boat_id,
      totalPoints,
      keptAscending: [...keptPoints].sort(ascending),
      scores: boat.scores,
    };
  });

  return rankByTotal(scored, (a, b) =>
    compareQualifyingTie(a, b, singleHeatEvent),
  ).map(({ boat_id, totalPoints, place }) => ({ boat_id, totalPoints, place }));
}

export interface FinalSeriesBoat<Id = string> extends SeriesBoat<Id> {
  /** "Gold", "Silver", … — each fleet is scored on its own (SHRS 5.1). */
  fleet: string;
}

/**
 * Places within each final fleet (SHRS 5.1, 5.4, 5.7(ii)(2)). The discard
 * count is fleet-wide — fleets may sail different numbers of races (4.5) —
 * and the tie-break is A8.1 on ALL scores, excluded ones included, then A8.2.
 */
export function rankFinalSeries<Id>(
  boats: FinalSeriesBoat<Id>[],
  { discardConfig }: Pick<SeriesOptions, 'discardConfig'>,
): Map<string, RankedBoat<Id>[]> {
  const fleets = new Map<string, FinalSeriesBoat<Id>[]>();
  boats.forEach((boat) => {
    if (!fleets.has(boat.fleet)) fleets.set(boat.fleet, []);
    fleets.get(boat.fleet)!.push(boat);
  });

  const ranked = new Map<string, RankedBoat<Id>[]>();
  fleets.forEach((fleetBoats, fleet) => {
    const seriesExcludeCount = getExcludeCountForConfig(
      mostRaces(fleetBoats),
      discardConfig,
    );
    const scored = fleetBoats.map((boat) => ({
      boat_id: boat.boat_id,
      totalPoints: scoreBoatSeries(boat.scores, seriesExcludeCount).totalPoints,
      allAscending: boat.scores.map((s) => s.points).sort(ascending),
      lastRaceFirst: [...boat.scores].sort(latestFirst).map((s) => s.points),
    }));
    const table = rankByTotal(
      scored,
      (a, b) =>
        compareScoreArrays(a.allAscending, b.allAscending) ||
        compareScoreArrays(a.lastRaceFirst, b.lastRaceFirst),
    );
    ranked.set(
      fleet,
      table.map(({ boat_id, totalPoints, place }) => ({
        boat_id,
        totalPoints,
        place,
      })),
    );
  });
  return ranked;
}
