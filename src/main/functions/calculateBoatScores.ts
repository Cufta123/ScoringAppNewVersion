/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';

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

function getScoresForA81(event_id: any, boat_id: any) {
  const scoresQuery = db.prepare(`
    SELECT points
    FROM Scores
    JOIN Races ON Scores.race_id = Races.race_id
    JOIN Heats ON Races.heat_id = Heats.heat_id
    WHERE Heats.event_id = ? AND Scores.boat_id = ? AND Heats.heat_type = 'Qualifying'
    ORDER BY points DESC
  `);
  return scoresQuery
    .all(event_id, boat_id)
    .map((row: { points: any }) => row.points);
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

// SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more
function getExcludeCount(numberOfRaces: number): number {
  if (numberOfRaces < 4) return 0;
  if (numberOfRaces < 8) return 1;
  return 2 + Math.floor((numberOfRaces - 8) / 8);
}

export default function calculateBoatScores(
  results: Result[],
  event_id: any,
  pointsMap: Map<number, string[]>,
): TemporaryTableEntry[] {
  results.forEach((result) => {
    const { boat_id, number_of_races } = result;

    // Fetch all scores for the boat
    const scores = getScoresForA81(event_id, boat_id);

    // Determine the number of scores to exclude per SHRS 5.4
    const excludeCount = getExcludeCount(number_of_races);
    console.log(
      `Boat ID: ${boat_id}, Number of Races: ${number_of_races}, Places to Exclude: ${excludeCount}`,
    );

    // Exclude the worst scores
    const initialTotalPoints = scores.reduce(
      (acc: any, score: any) => acc + score,
      0,
    );
    const worstPlaces = scores.slice(0, excludeCount);
    const scoresToInclude = scores.slice(excludeCount);
    const totalPoints = scoresToInclude.reduce(
      (acc: any, score: any) => acc + score,
      0,
    );
    console.log(
      `Boat ID: ${boat_id}, Number of Races: ${number_of_races}, Initial Total Points: ${initialTotalPoints}, Worst Places: ${worstPlaces}`,
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
      // SHRS 5.6(ii)(a)(2): For the purposes of breaking ties excluded scores
      // shall be used. This changes RRS A8.1 (which normally excludes them).
      const sortedScores = boatIds.map((boat_id) => {
        const scores = getScoresForA81(event_id, boat_id);
        return {
          boat_id,
          scores: scores.sort((a: number, b: number) => a - b),
        };
      });

      // A81.1 Sort the boats based on their scores
      sortedScores.sort((a, b) => {
        for (
          let i = 0;
          i < Math.min(a.scores.length, b.scores.length);
          i += 1
        ) {
          if (a.scores[i] !== b.scores[i]) {
            return a.scores[i] - b.scores[i]; // Compare scores in ascending order
          }
        }
        return 0; // If all scores are the same, keep the original order
      });

      sortedScores.sort((a, b) => {
        const sharedScores = getSharedRaceScoresForTieBreak(
          event_id,
          a.boat_id,
          b.boat_id,
        );

        if (sharedScores) {
          const sharedA81Comparison = compareA81Scores(
            sharedScores.a81A,
            sharedScores.a81B,
          );
          if (sharedA81Comparison !== 0) {
            return sharedA81Comparison;
          }

          return compareA82LatestFirst(sharedScores.a82A, sharedScores.a82B);
        }

        const initialComparison = compareA81Scores(a.scores, b.scores);
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
        return 0; // If all scores are the same, keep the original order
      });

      sortedScores.forEach((boat, index) => {
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
        sortedScores,
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
