/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import {
  getEventDiscardConfig,
  getExcludeCountForConfig,
} from './discardConfig';

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

interface TieCandidate {
  boat_id: string;
  keptScores: number[];
  totalRaceCount: number;
}

const nonExcludableStatuses = new Set(['DNE', 'DGM']);

function getScoresForA81(event_id: any, boat_id: any) {
  const scoresQuery = db.prepare(`
    SELECT s.points, COALESCE(s.status, 'FINISHED') as status, s.race_id, r.race_number
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Qualifying'
    ORDER BY points DESC, r.race_number ASC, s.race_id ASC
  `);
  return scoresQuery.all(event_id, boat_id) as ScoreEntry[];
}

function getScoresForA82(event_id: any, boat_id: any) {
  const scoresQuery = db.prepare(`
    SELECT s.points
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Qualifying'
    ORDER BY r.race_number DESC
  `);

  return scoresQuery
    .all(event_id, boat_id)
    .map((row: { points: any }) => row.points);
}

function getRaceScoresForTieBreak(event_id: any, boat_id: any): RaceScoreEntry[] {
  const scoresQuery = db.prepare(`
    SELECT s.race_id, r.race_number, s.points
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Qualifying'
    ORDER BY r.race_number DESC, s.race_id DESC
  `);

  return scoresQuery
    .all(event_id, boat_id)
    .map(
      (row: { race_id: number; race_number: number; points: number }) => ({
        race_id: row.race_id,
        race_number: row.race_number,
        points: row.points,
      }),
    );
}

function compareA81Scores(scoresA: number[], scoresB: number[]) {
  const maxLength = Math.max(scoresA.length, scoresB.length);
  for (let i = 0; i < maxLength; i += 1) {
    const scoreA = scoresA[i] ?? Number.MAX_SAFE_INTEGER;
    const scoreB = scoresB[i] ?? Number.MAX_SAFE_INTEGER;
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
  }
  return 0;
}

function compareA82LatestFirst(scoresA: number[], scoresB: number[]) {
  const maxLength = Math.max(scoresA.length, scoresB.length);
  for (let i = 0; i < maxLength; i += 1) {
    const scoreA = scoresA[i] ?? Number.MAX_SAFE_INTEGER;
    const scoreB = scoresB[i] ?? Number.MAX_SAFE_INTEGER;
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
  }
  return 0;
}

function getSharedRaceScoresForTieBreak(
  event_id: any,
  boatAId: string,
  boatBId: string,
) {
  const scoresA = getRaceScoresForTieBreak(event_id, boatAId);
  const scoresB = getRaceScoresForTieBreak(event_id, boatBId);
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

function getKeptScores(entries: ScoreEntry[], excludeCount: number): number[] {
  if (excludeCount <= 0) {
    return entries.map((entry) => entry.points);
  }

  const candidates = entries
    .map((entry, idx) => ({ entry, idx }))
    .filter(
      ({ entry }) => !nonExcludableStatuses.has(String(entry.status).toUpperCase()),
    )
    .sort(
      (left, right) =>
        right.entry.points - left.entry.points ||
        left.entry.race_number - right.entry.race_number ||
        left.entry.race_id - right.entry.race_id,
    );

  const excludedIndexes = new Set(
    candidates.slice(0, excludeCount).map(({ idx }) => idx),
  );

  return entries
    .filter((_entry, idx) => !excludedIndexes.has(idx))
    .map((entry) => entry.points);
}

// SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more
export default function calculateBoatScores(
  results: Result[],
  event_id: any,
  pointsMap: Map<number, string[]>,
): TemporaryTableEntry[] {
  const discardConfig = getEventDiscardConfig(event_id, 'qualifying');

  results.forEach((result) => {
    const { boat_id, number_of_races } = result;

    // Fetch all scores for the boat
    const scoreEntries = getScoresForA81(event_id, boat_id);

    // Determine the number of scores to exclude per SHRS 5.4
    const excludeCount = getExcludeCountForConfig(number_of_races, discardConfig);
    console.log(
      `Boat ID: ${boat_id}, Number of Races: ${number_of_races}, Places to Exclude: ${excludeCount}`,
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
      const raceCountByBoat = new Map<string, number>();
      results.forEach((row) => {
        raceCountByBoat.set(String(row.boat_id), Number(row.number_of_races));
      });

      const sortedScores: TieCandidate[] = boatIds.map((boat_id) => {
        const scoreEntries = getScoresForA81(event_id, boat_id);
        const raceCount =
          raceCountByBoat.get(String(boat_id)) ?? scoreEntries.length;
        const excludeCount = getExcludeCountForConfig(raceCount, discardConfig);
        const keptScores = getKeptScores(scoreEntries, excludeCount).sort(
          (a: number, b: number) => a - b,
        );
        const totalRaceCount = getRaceScoresForTieBreak(event_id, boat_id).length;
        return {
          boat_id,
          keptScores,
          totalRaceCount,
        };
      });

      // A8.1 + SHRS 5.6: Compare shared-heat A81 scores first, then A82 (last race backward)
      const compareTieCandidates = (a: TieCandidate, b: TieCandidate) => {
        const sharedScores = getSharedRaceScoresForTieBreak(
          event_id,
          a.boat_id,
          b.boat_id,
        );

        if (sharedScores) {
          const isSingleHeatEvent =
            sharedScores.a82A.length === a.totalRaceCount &&
            sharedScores.a82B.length === b.totalRaceCount;

          if (isSingleHeatEvent) {
            // SHRS 5.6(i): single-heat events use standard RRS A8.1
            // where excluded scores are NOT used.
            const singleHeatA81Comparison = compareA81Scores(
              a.keptScores,
              b.keptScores,
            );
            if (singleHeatA81Comparison !== 0) {
              return singleHeatA81Comparison;
            }
          } else {
            // SHRS 5.6(ii)(a): for shared-heat comparisons, excluded scores
            // are used when applying A8.1.
            const sharedA81Comparison = compareA81Scores(
              sharedScores.a81A,
              sharedScores.a81B,
            );
            if (sharedA81Comparison !== 0) {
              return sharedA81Comparison;
            }
          }

          const sharedA82Comparison = compareA82LatestFirst(
            sharedScores.a82A,
            sharedScores.a82B,
          );
          if (sharedA82Comparison !== 0) {
            return sharedA82Comparison;
          }

          return String(a.boat_id).localeCompare(String(b.boat_id));
        }

        // Standard A8.1: excluded scores are NOT used.
        const initialComparison = compareA81Scores(a.keptScores, b.keptScores);
        if (initialComparison !== 0) {
          return initialComparison;
        }

        console.log(
          `Tie detected between Boat ${a.boat_id} and Boat ${b.boat_id}. Applying tie-breaking logic.`,
        );

        const scoresA = getScoresForA82(event_id, a.boat_id); // Retrieve original scores for boat A
        const scoresB = getScoresForA82(event_id, b.boat_id); // Retrieve original scores for boat B

        const maxLength = Math.max(scoresA.length, scoresB.length);
        for (let i = 0; i < maxLength; i += 1) {
          const scoreA = scoresA[i] ?? Number.MAX_SAFE_INTEGER;
          const scoreB = scoresB[i] ?? Number.MAX_SAFE_INTEGER;
          console.log(
            `Comparing race ${i}: Boat ${a.boat_id} score: ${scoreA}, Boat ${b.boat_id} score: ${scoreB}`,
          );
          if (scoreA !== scoreB) {
            console.log(
              `Tie-breaking: Comparing scores from the last race backward. Boat ${a.boat_id} score: ${scoreA}, Boat ${b.boat_id} score: ${scoreB}`,
            );
            return scoreA - scoreB; // Compare scores from the last race backward
          }
        }
        return String(a.boat_id).localeCompare(String(b.boat_id));
      };

      // SHRS 2026 5.7(ii)(3): resolve higher-place tie before lower ties.
      const remaining = [...sortedScores];
      const resolvedOrder: TieCandidate[] = [];
      while (remaining.length > 0) {
        remaining.sort(compareTieCandidates);
        const [winner] = remaining.splice(0, 1);
        resolvedOrder.push(winner);
      }

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
