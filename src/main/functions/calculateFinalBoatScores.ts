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
  total_points_final: any;
  heat_name: any;
}

interface TemporaryTableEntry {
  boat_id: string;
  totalPoints: number;
  place?: number;
}

interface TieCandidate {
  boat_id: string;
  heat_name: string;
  allScoresForA81: number[];
  a82Scores: number[];
}

interface ScoreEntry {
  race_id: number;
  race_number: number;
  points: number;
  status: string;
}

// Per-recompute memoization cache (see calculateBoatScores.ts). The final
// scoring re-fetches a tied boat's A81/A82 rows in the tie-break loop; this
// cache returns the rows already fetched in the per-boat loop instead of
// re-running the same query. Scoped to one `calculateFinalBoatScores` call, it
// can only ever return the same rows the DB would have returned again.
interface FinalScoreCache {
  a81: Map<string, ScoreEntry[]>;
  a82: Map<string, number[]>;
}

function finalCacheKey(boat_id: any, heat_name: any): string {
  return `${String(boat_id)}\u0000${String(heat_name)}`;
}

function getScoresForA81(
  event_id: any,
  boat_id: any,
  heat_name: any,
  cache?: FinalScoreCache,
) {
  if (cache) {
    const cached = cache.a81.get(finalCacheKey(boat_id, heat_name));
    if (cached) return cached;
  }
  const scoresQuery = db.prepare(`
    SELECT s.points, COALESCE(s.status, 'FINISHED') as status, s.race_id, r.race_number
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Final' AND h.heat_name = ?
    ORDER BY points DESC, r.race_number ASC, s.race_id ASC
  `);
  const result = scoresQuery.all(event_id, boat_id, heat_name) as ScoreEntry[];
  if (cache) cache.a81.set(finalCacheKey(boat_id, heat_name), result);
  return result;
}

function getScoresForA82(
  event_id: any,
  boat_id: any,
  heat_name: any,
  cache?: FinalScoreCache,
) {
  if (cache) {
    const cached = cache.a82.get(finalCacheKey(boat_id, heat_name));
    if (cached) return cached;
  }
  const scoresQuery = db.prepare(`
    SELECT s.points
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Final' AND h.heat_name = ?
    ORDER BY r.race_number DESC, s.race_id DESC
  `);

  const result = scoresQuery
    .all(event_id, boat_id, heat_name)
    .map((row: { points: any }) => row.points);
  if (cache) cache.a82.set(finalCacheKey(boat_id, heat_name), result);
  return result;
}

// SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more
export default function calculateFinalBoatScores(
  results: Result[],
  event_id: any,
): Map<string, TemporaryTableEntry[]> {
  const discardConfig = getEventDiscardConfig(event_id, 'final');
  const groupTables = new Map<string, TemporaryTableEntry[]>();
  const cache: FinalScoreCache = { a81: new Map(), a82: new Map() };

  // Fetch scores sorted DESC (worst first) once per boat, tagged with its fleet.
  const boatEntries = results.map((result) => {
    const { boat_id, heat_name } = result;
    const groupNameMatch =
      typeof heat_name === 'string' ? heat_name.match(/^Final\s+(.+)$/i) : null;
    return {
      boat_id,
      groupName: groupNameMatch?.[1] ?? String(heat_name),
      scoreEntries: getScoresForA81(event_id, boat_id, heat_name, cache),
    };
  });

  // RULE-M20 / SHRS 5.4 + 5.1: the discard count keys off the races completed
  // "in that series", and each final fleet is scored separately (5.1) — fleets
  // may sail different numbers of races (4.5). So the count is FLEET-wide (the
  // largest race count in the fleet), not each boat's own count. Using the
  // per-boat count let a boat that missed a final race discard as many scores
  // as one that sailed them all, and made the final path disagree with the
  // series-wide qualifying path (RULE-C1).
  const fleetRaceCounts = new Map<string, number>();
  boatEntries.forEach(({ groupName, scoreEntries }) => {
    fleetRaceCounts.set(
      groupName,
      Math.max(fleetRaceCounts.get(groupName) ?? 0, scoreEntries.length),
    );
  });

  boatEntries.forEach(({ boat_id, groupName, scoreEntries }) => {
    if (!groupTables.has(groupName)) {
      groupTables.set(groupName, []);
    }

    // Series-wide count for the fleet, capped per boat so a boat with fewer
    // scores than the discard count still keeps one (LB-11).
    const excludeCount = capExcludeCountForBoat(
      getExcludeCountForConfig(
        fleetRaceCounts.get(groupName) ?? 0,
        discardConfig,
      ),
      scoreEntries.length,
    );

    // Exclude worst excludable scores (DNE/DGM are never excluded)
    const scoresToInclude = getKeptScores(scoreEntries, excludeCount);
    const totalPoints = scoresToInclude.reduce(
      (acc: number, score: number) => acc + score,
      0,
    );

    groupTables.get(groupName)?.push({ boat_id, totalPoints });
  });

  groupTables.forEach((table, groupName) => {
    table.sort((a, b) => a.totalPoints - b.totalPoints);

    table.forEach((boat, index) => {
      boat.place = index + 1;
    });

    const boatsWithSamePoints = table.reduce(
      (acc, boat) => {
        if (!acc[boat.totalPoints]) {
          acc[boat.totalPoints] = [];
        }
        acc[boat.totalPoints].push(boat.boat_id);
        return acc;
      },
      {} as Record<number, string[]>,
    );

    Object.entries(boatsWithSamePoints).forEach(([, boatIds]) => {
      if (boatIds.length > 1) {
        const sortedScores: TieCandidate[] = boatIds.map((boat_id) => {
          const boatHeatName =
            results.find((row) => row.boat_id === boat_id)?.heat_name ??
            `Final ${groupName}`;
          const scoreEntries = getScoresForA81(
            event_id,
            boat_id,
            boatHeatName,
            cache,
          );
          const a82Scores = getScoresForA82(
            event_id,
            boat_id,
            boatHeatName,
            cache,
          );
          const allScoresForA81 = scoreEntries
            .map((entry) => entry.points)
            .sort((a: number, b: number) => a - b);
          return {
            boat_id,
            heat_name: boatHeatName,
            allScoresForA81,
            a82Scores,
          };
        });

        // SHRS 5.7(ii)(2): tie-break uses excluded scores (all race scores).
        // Then apply A8.2 from last race backward.
        const compareTieCandidates = (a: TieCandidate, b: TieCandidate) => {
          const initialComparison = compareScoreArrays(
            a.allScoresForA81,
            b.allScoresForA81,
          );
          if (initialComparison !== 0) return initialComparison;

          const a82Comparison = compareScoreArrays(a.a82Scores, b.a82Scores);
          if (a82Comparison !== 0) return a82Comparison;

          // SHRS 5.7(ii)(4) / A8: if neither A8.1 nor A8.2 separates the boats
          // they remain tied. Do not invent an order from the internal boat_id
          // (mirrors the qualifying/overall paths fixed under RULE-M8).
          return 0;
        };

        // SHRS 2026 5.7(ii)(3): resolve higher-place tie before lower ties.
        const resolvedOrder = resolveTiesSequentially(
          sortedScores,
          compareTieCandidates,
        );

        resolvedOrder.forEach((boat, index) => {
          const boatIndex = table.findIndex((b) => b.boat_id === boat.boat_id);
          if (boatIndex !== -1) {
            table[boatIndex].place = index + 1;
          }
        });

        table.sort((a, b) => {
          if (a.totalPoints === b.totalPoints) {
            return (a.place ?? 0) - (b.place ?? 0);
          }
          return a.totalPoints - b.totalPoints;
        });

        table.forEach((boat, index) => {
          boat.place = index + 1;
        });
      }
    });
  });

  return groupTables;
}
