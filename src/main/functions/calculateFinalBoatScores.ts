/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import {
  getEventDiscardConfig,
  getExcludeCountForConfig,
} from './discardConfig';
import {
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

function getScoresForA81(event_id: any, boat_id: any, heat_name: any) {
  const scoresQuery = db.prepare(`
    SELECT s.points, COALESCE(s.status, 'FINISHED') as status, s.race_id, r.race_number
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Final' AND h.heat_name = ?
    ORDER BY points DESC, r.race_number ASC, s.race_id ASC
  `);
  return scoresQuery.all(event_id, boat_id, heat_name) as ScoreEntry[];
}

function getScoresForA82(event_id: any, boat_id: any, heat_name: any) {
  const scoresQuery = db.prepare(`
    SELECT s.points
    FROM Scores s
    JOIN Races r ON s.race_id = r.race_id
    JOIN Heats h ON r.heat_id = h.heat_id
    WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = 'Final' AND h.heat_name = ?
    ORDER BY r.race_number DESC
  `);

  return scoresQuery
    .all(event_id, boat_id, heat_name)
    .map((row: { points: any }) => row.points);
}

// SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more
export default function calculateFinalBoatScores(
  results: Result[],
  event_id: any,
): Map<string, TemporaryTableEntry[]> {
  const discardConfig = getEventDiscardConfig(event_id, 'final');
  const groupTables = new Map<string, TemporaryTableEntry[]>();

  results.forEach((result) => {
    const { boat_id, heat_name } = result;
    const groupNameMatch =
      typeof heat_name === 'string'
        ? heat_name.match(/^Final\s+(.+)$/i)
        : null;
    const groupName = groupNameMatch?.[1] ?? String(heat_name);

    if (!groupTables.has(groupName)) {
      groupTables.set(groupName, []);
    }

    // Fetch scores sorted DESC (worst first) and apply exclusions per SHRS 5.4
    const scoreEntries = getScoresForA81(event_id, boat_id, heat_name);
    const numberOfRaces = scoreEntries.length;
    const excludeCount = getExcludeCountForConfig(numberOfRaces, discardConfig);

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

    Object.entries(boatsWithSamePoints).forEach(([totalPoints, boatIds]) => {
      if (boatIds.length > 1) {
        const sortedScores: TieCandidate[] = boatIds.map((boat_id) => {
          const boatHeatName =
            results.find((row) => row.boat_id === boat_id)?.heat_name ??
            `Final ${groupName}`;
          const scoreEntries = getScoresForA81(event_id, boat_id, boatHeatName);
          const a82Scores = getScoresForA82(event_id, boat_id, boatHeatName);
          const allScoresForA81 = scoreEntries
            .map((entry) => entry.points)
            .sort(
            (a: number, b: number) => a - b,
          );
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

          return String(a.boat_id).localeCompare(String(b.boat_id));
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
