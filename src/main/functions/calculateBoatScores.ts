/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import {
  getEventDiscardConfig,
  getExcludeCountForConfig,
} from './discardConfig';
import {
  capExcludeCountForBoat,
  compareScoreArrays,
  getKeptScores,
  resolveTiesSequentially,
} from './scoringUtils';

interface Result {
  boat_id: any;
  total_points_event: any;
  number_of_races: any;
}

interface TemporaryTableEntry {
  boat_id: string;
  totalPoints: number;
  place?: number;
}

interface RaceScoreEntry {
  race_id: number;
  race_number: number;
  points: number;
}

interface ScoreEntry {
  race_id: number;
  race_number: number;
  points: number;
  status: string;
}

export interface TieCandidate {
  boat_id: string;
  keptScores: number[];
}

// Per-recompute memoization cache. `calculateBoatScores` fetches the same
// boat's scores more than once (the per-boat total loop, the single-heat
// detection, and the tie-break comparator). A cache scoped to a single
// recompute returns the identical rows the DB would have returned on a
// re-query, so it cannot change scoring — it only avoids re-running the same
// SQLite query for the same boat.
interface ScoreCache {
  a81: Map<string, ScoreEntry[]>;
  a82: Map<string, number[]>;
  raceScores: Map<string, RaceScoreEntry[]>;
}

function createScoreCache(): ScoreCache {
  return {
    a81: new Map(),
    a82: new Map(),
    raceScores: new Map(),
  };
}

export function getScoresForA81(
  event_id: any,
  boat_id: any,
  cache?: ScoreCache,
) {
  if (cache) {
    const cached = cache.a81.get(String(boat_id));
    if (cached) return cached;
  }
  const scoresQuery = db.prepare(`
    SELECT s.points, COALESCE(s.status, 'FINISHED') as status, s.race_id, r.race_number
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Qualifying'
    ORDER BY points DESC, r.race_number ASC, s.race_id ASC
  `);
  const result = scoresQuery.all(event_id, boat_id) as ScoreEntry[];
  if (cache) cache.a81.set(String(boat_id), result);
  return result;
}

export function getScoresForA82(
  event_id: any,
  boat_id: any,
  cache?: ScoreCache,
) {
  if (cache) {
    const cached = cache.a82.get(String(boat_id));
    if (cached) return cached;
  }
  const scoresQuery = db.prepare(`
    SELECT s.points
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Qualifying'
    ORDER BY r.race_number DESC, s.race_id DESC
  `);

  const result = scoresQuery
    .all(event_id, boat_id)
    .map((row: { points: any }) => row.points);
  if (cache) cache.a82.set(String(boat_id), result);
  return result;
}

export function getRaceScoresForTieBreak(
  event_id: any,
  boat_id: any,
  cache?: ScoreCache,
): RaceScoreEntry[] {
  if (cache) {
    const cached = cache.raceScores.get(String(boat_id));
    if (cached) return cached;
  }
  const scoresQuery = db.prepare(`
    SELECT s.race_id, r.race_number, s.points
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Qualifying'
    ORDER BY r.race_number DESC, s.race_id DESC
  `);

  const result = scoresQuery
    .all(event_id, boat_id)
    .map((row: { race_id: number; race_number: number; points: number }) => ({
      race_id: row.race_id,
      race_number: row.race_number,
      points: row.points,
    }));
  if (cache) cache.raceScores.set(String(boat_id), result);
  return result;
}

export function getSharedRaceScoresForTieBreak(
  event_id: any,
  boatAId: string,
  boatBId: string,
  cache?: ScoreCache,
) {
  const scoresA = getRaceScoresForTieBreak(event_id, boatAId, cache);
  const scoresB = getRaceScoresForTieBreak(event_id, boatBId, cache);
  const scoresByRaceB = new Map<number, RaceScoreEntry>();
  scoresB.forEach((entry) => {
    scoresByRaceB.set(entry.race_id, entry);
  });

  const shared = scoresA
    .filter((entry) => scoresByRaceB.has(entry.race_id))
    .map((entry) => {
      const other = scoresByRaceB.get(entry.race_id) as RaceScoreEntry;
      return {
        race_number: entry.race_number,
        race_id: entry.race_id,
        pointsA: entry.points,
        pointsB: other.points,
      };
    })
    .sort(
      (left, right) =>
        right.race_number - left.race_number || right.race_id - left.race_id,
    );

  if (shared.length === 0) {
    return null;
  }

  const a81A = shared.map((entry) => entry.pointsA).sort((a, b) => a - b);
  const a81B = shared.map((entry) => entry.pointsB).sort((a, b) => a - b);
  const a82A = shared.map((entry) => entry.pointsA);
  const a82B = shared.map((entry) => entry.pointsB);

  return { a81A, a81B, a82A, a82B };
}

// SHRS 5.7.1 vs 5.7.2: whether an event is single-heat is an event-level
// property, not a property of one tied pair. An event is single-heat only
// when every boat raced exactly the same set of races; otherwise two tied
// boats that happen to share all their races must still be compared under
// the multi-heat rules (SHRS 5.7.2.2 uses excluded scores).
export function detectSingleHeatEvent(
  event_id: any,
  boatIds: string[],
  cache?: ScoreCache,
): boolean {
  let reference: Set<number> | null = null;
  for (let i = 0; i < boatIds.length; i += 1) {
    const raceIds = new Set(
      getRaceScoresForTieBreak(event_id, boatIds[i], cache).map(
        (entry) => entry.race_id,
      ),
    );
    if (reference === null) {
      reference = raceIds;
    } else {
      if (raceIds.size !== reference.size) {
        return false;
      }
      const ref = reference;
      if (![...raceIds].every((raceId) => ref.has(raceId))) {
        return false;
      }
    }
  }
  return true;
}

// A8.1 + SHRS 5.7: compare two tied qualifying boats. Shared-heat scores are
// compared first (excluded scores included for multi-heat events per
// 5.7.2.2; standard A8.1 with excluded scores omitted for single-heat
// events), then A8.2 (last race backward). Boats that never shared a heat
// fall back to plain RRS A8.1/A8.2 (5.7.2.5).
export function compareQualifyingTieCandidates(
  event_id: any,
  a: TieCandidate,
  b: TieCandidate,
  isSingleHeatEvent: boolean,
  cache?: ScoreCache,
): number {
  const sharedScores = getSharedRaceScoresForTieBreak(
    event_id,
    a.boat_id,
    b.boat_id,
    cache,
  );

  if (sharedScores) {
    if (isSingleHeatEvent) {
      // SHRS 5.7.1: single-heat events use standard RRS A8.1
      // where excluded scores are NOT used.
      const singleHeatA81Comparison = compareScoreArrays(
        a.keptScores,
        b.keptScores,
      );
      if (singleHeatA81Comparison !== 0) {
        return singleHeatA81Comparison;
      }
    } else {
      // SHRS 5.7.2.2: for shared-heat comparisons in multi-heat
      // events, excluded scores ARE used when applying A8.1.
      const sharedA81Comparison = compareScoreArrays(
        sharedScores.a81A,
        sharedScores.a81B,
      );
      if (sharedA81Comparison !== 0) {
        return sharedA81Comparison;
      }
    }

    const sharedA82Comparison = compareScoreArrays(
      sharedScores.a82A,
      sharedScores.a82B,
    );
    if (sharedA82Comparison !== 0) {
      return sharedA82Comparison;
    }

    // Still tied after SHRS 5.7.2 A8.1/A8.2 on shared races: the boats remain
    // tied. Do not invent an order from the internal boat_id (SHRS 5.7(ii)(4)).
    return 0;
  }

  // Standard A8.1: excluded scores are NOT used.
  const initialComparison = compareScoreArrays(a.keptScores, b.keptScores);
  if (initialComparison !== 0) {
    return initialComparison;
  }

  console.log(
    `Tie detected between Boat ${a.boat_id} and Boat ${b.boat_id}. Applying tie-breaking logic.`,
  );

  // A8.2: compare original scores from the last race backward.
  const scoresA = getScoresForA82(event_id, a.boat_id, cache);
  const scoresB = getScoresForA82(event_id, b.boat_id, cache);
  const a82Comparison = compareScoreArrays(scoresA, scoresB);
  if (a82Comparison !== 0) {
    return a82Comparison;
  }
  // Still tied after RRS A8.1/A8.2: the boats remain tied. Do not invent an
  // order from the internal boat_id.
  return 0;
}

// SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more
export default function calculateBoatScores(
  results: Result[],
  event_id: any,
  pointsMap: Map<number, string[]>,
): TemporaryTableEntry[] {
  const discardConfig = getEventDiscardConfig(event_id, 'qualifying');
  const cache = createScoreCache();
  const isSingleHeatEvent = detectSingleHeatEvent(
    event_id,
    results.map((row) => String(row.boat_id)),
    cache,
  );

  // SHRS 5.4 keys the discard count off the number of races COMPLETED IN THE
  // SERIES, a series-wide constant — not each boat's own race count. A boat
  // that missed a race must still be scored under the same discard count as the
  // rest of the fleet (otherwise it discards fewer scores and is ranked too
  // high). The series length is the largest race count among the entered boats.
  const seriesRaceCount = results.reduce(
    (max, row) => Math.max(max, Number(row.number_of_races) || 0),
    0,
  );

  results.forEach((result) => {
    const { boat_id, number_of_races } = result;

    // Fetch all scores for the boat
    const scoreEntries = getScoresForA81(event_id, boat_id, cache);

    // Determine the number of scores to exclude per SHRS 5.4 (series-wide count)
    const seriesExcludeCount = getExcludeCountForConfig(
      seriesRaceCount,
      discardConfig,
    );

    // LB-11: the discard count is series-wide, but a boat that has fewer races
    // than the series (e.g. a late entrant whose missing races are not seeded)
    // must never have *all* of its scores discarded — low-point scoring can
    // never drop a boat below its single best race. Without this cap such a
    // boat's total collapses to 0 and it is wrongly ranked first.
    const excludeCount = capExcludeCountForBoat(
      seriesExcludeCount,
      scoreEntries.length,
    );
    const excludeCapNote =
      excludeCount !== seriesExcludeCount
        ? ` (capped from series-wide ${seriesExcludeCount}; boat has only ${scoreEntries.length} score(s))`
        : '';
    console.log(
      `Boat ID: ${boat_id}, Number of Races: ${number_of_races}, Places to Exclude: ${excludeCount}${excludeCapNote}`,
    );

    // Exclude the worst scores
    const initialTotalPoints = scoreEntries.reduce(
      (acc: number, score) => acc + score.points,
      0,
    );
    const scoresToInclude = getKeptScores(scoreEntries, excludeCount);
    const totalPoints = scoresToInclude.reduce((acc, score) => acc + score, 0);
    console.log(
      `Boat ID: ${boat_id}, Number of Races: ${number_of_races}, Initial Total Points: ${initialTotalPoints}, Included Scores: ${scoresToInclude}`,
    );

    console.log(
      `Boat ID: ${boat_id}, Total Points After Exclusion: ${totalPoints}`,
    );
    if (!pointsMap.has(totalPoints)) {
      pointsMap.set(totalPoints, []);
    }
    const boats = pointsMap.get(totalPoints);
    if (boats) {
      boats.push(boat_id);
    }
  });

  // Create a temporary table with all boats and their total points
  const temporaryTable: {
    boat_id: string;
    totalPoints: number;
    place?: number;
  }[] = [];
  pointsMap.forEach((boats, totalPoints) => {
    boats.forEach((boat_id) => {
      temporaryTable.push({ boat_id, totalPoints });
    });
  });

  // Sort the temporary table by total points
  temporaryTable.sort((a, b) => a.totalPoints - b.totalPoints);

  // Assign places based on the sorted order
  temporaryTable.forEach((boat, index) => {
    boat.place = index + 1;
  });

  // Log the temporary table with places before tie-breaking
  console.log(
    'Temporary Table with Places before tie-breaking:',
    temporaryTable,
  );

  // Identify boats with the same total points
  const boatsWithSamePoints = temporaryTable.reduce(
    (acc, boat) => {
      if (!acc[boat.totalPoints]) {
        acc[boat.totalPoints] = [];
      }
      acc[boat.totalPoints].push(boat.boat_id);
      return acc;
    },
    {} as Record<number, string[]>,
  );

  // Fetch and display all scores for boats with the same total points
  Object.entries(boatsWithSamePoints).forEach(([totalPoints, boatIds]) => {
    if (boatIds.length > 1) {
      console.log(`Boats with total points ${totalPoints}:`, boatIds);
      const sortedScores: TieCandidate[] = boatIds.map((boat_id) => {
        const scoreEntries = getScoresForA81(event_id, boat_id, cache);
        // SHRS 5.4: same series-wide discard count for every tied boat, capped
        // per boat exactly as the total above (LB-11). Without the cap a boat
        // with fewer scores than the discard count enters A8.1 with an EMPTY
        // kept-score vector and always loses the tie-break — contradicting the
        // capped total that put her in the tie in the first place.
        const excludeCount = capExcludeCountForBoat(
          getExcludeCountForConfig(seriesRaceCount, discardConfig),
          scoreEntries.length,
        );
        const keptScores = getKeptScores(scoreEntries, excludeCount).sort(
          (a: number, b: number) => a - b,
        );
        return {
          boat_id,
          keptScores,
        };
      });

      // SHRS 2026 5.7(ii)(3): resolve higher-place tie before lower ties.
      const resolvedOrder = resolveTiesSequentially(sortedScores, (a, b) =>
        compareQualifyingTieCandidates(
          event_id,
          a,
          b,
          isSingleHeatEvent,
          cache,
        ),
      );

      resolvedOrder.forEach((boat, index) => {
        const boatIndex = temporaryTable.findIndex(
          (b) => b.boat_id === boat.boat_id,
        );
        if (boatIndex !== -1) {
          temporaryTable[boatIndex].place = index + 1; // Update place based on sorted order
        }
      });
      temporaryTable.sort((a, b) => {
        if (a.totalPoints === b.totalPoints) {
          return (a.place ?? 0) - (b.place ?? 0);
        }
        return a.totalPoints - b.totalPoints;
      });

      // Update places in the temporary table based on sorted order
      temporaryTable.forEach((boat, index) => {
        boat.place = index + 1;
      });

      console.log(
        `After tie-breaking for total points ${totalPoints}:`,
        resolvedOrder,
      );
    }
  });

  // Log the temporary table with places after tie-breaking
  console.log(
    'Temporary Table with Places after tie-breaking:',
    temporaryTable,
  );

  return temporaryTable;
}
