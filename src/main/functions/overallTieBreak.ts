/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import {
  DiscardConfig,
  getEventDiscardConfig,
  getExcludeCountForConfig,
} from './discardConfig';
import {
  compareScoreArrays,
  getKeptScores,
  resolveTiesSequentially,
} from './scoringUtils';

// Combined (Qualifying + Final) tie-break used to rank the overall/final
// leaderboard. Lives in its own module so it can be shared by the IPC handler
// and by the tie-break explanation helper without re-running handler side
// effects. Implements SHRS 5.7.2 for the multi-heat (final series) case.

export type OverallRaceScore = {
  race_id: number;
  race_number: number;
  points: number;
  status: string;
  heat_type: string;
  heat_name: string;
};

export type OverallTiePacket = {
  raceIds: Set<number>;
  byRaceId: Map<number, OverallRaceScore>;
  a81KeptScores: number[];
  a82AllScores: number[];
};

function getKeptSeriesPoints(
  scores: {
    points: number;
    status?: string;
    race_number?: number;
    race_id?: number;
  }[],
  discardConfig: DiscardConfig,
): number[] {
  const excludeCount = getExcludeCountForConfig(scores.length, discardConfig);
  return getKeptScores(scores, excludeCount);
}

function buildSeriesPacketWithConfig(
  scores: OverallRaceScore[],
  discardConfig: DiscardConfig,
): {
  keptForA81: number[];
  allForA82: number[];
} {
  const keptForA81 = getKeptSeriesPoints(scores, discardConfig).sort(
    (a, b) => a - b,
  );
  const allForA82 = [...scores]
    .sort((a, b) => b.race_number - a.race_number || b.race_id - a.race_id)
    .map((entry) => entry.points);
  return { keptForA81, allForA82 };
}

export function buildOverallTiePacket(
  event_id: any,
  boat_id: any,
): OverallTiePacket {
  const scoreRows = db
    .prepare(
      `SELECT s.race_id, r.race_number, s.points, h.heat_type, h.heat_name, COALESCE(s.status, 'FINISHED') as status
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ? AND s.boat_id = ?
         AND h.heat_type IN ('Qualifying', 'Final')`,
    )
    .all(event_id, boat_id) as OverallRaceScore[];

  const qualScores = scoreRows.filter((row) => row.heat_type === 'Qualifying');
  const finalScores = scoreRows.filter((row) => row.heat_type === 'Final');

  const qualifyingDiscardConfig = getEventDiscardConfig(event_id, 'qualifying');
  const finalDiscardConfig = getEventDiscardConfig(event_id, 'final');

  const qualPacket = buildSeriesPacketWithConfig(
    qualScores,
    qualifyingDiscardConfig,
  );
  const finalPacket = buildSeriesPacketWithConfig(
    finalScores,
    finalDiscardConfig,
  );

  const byRaceId = new Map<number, OverallRaceScore>();
  scoreRows.forEach((row) => {
    byRaceId.set(row.race_id, row);
  });

  return {
    raceIds: new Set(scoreRows.map((row) => row.race_id)),
    byRaceId,
    a81KeptScores: [...qualPacket.keptForA81, ...finalPacket.keptForA81].sort(
      (a, b) => a - b,
    ),
    a82AllScores: [...qualPacket.allForA82, ...finalPacket.allForA82],
  };
}

export function compareOverallTiePackets(
  leftBoatId: any,
  rightBoatId: any,
  left: OverallTiePacket,
  right: OverallTiePacket,
) {
  const sharedRaceIds = [...left.raceIds].filter((raceId) =>
    right.raceIds.has(raceId),
  );

  // The overall leaderboard only exists for multi-heat events (a final
  // series requires >= 2 qualifying groups), so SHRS 5.7.2 applies:
  // boats that shared races are compared on those shared races with
  // excluded scores included (5.7.2.2); boats that never shared a race
  // fall back to plain RRS A8 (5.7.2.5).
  if (sharedRaceIds.length > 0) {
    const sharedLeft = sharedRaceIds
      .map((raceId) => left.byRaceId.get(raceId)?.points)
      .filter((score): score is number => score != null);
    const sharedRight = sharedRaceIds
      .map((raceId) => right.byRaceId.get(raceId)?.points)
      .filter((score): score is number => score != null);

    // SHRS 5.7.2.2: excluded scores are used for tie-break on shared races.
    const a81SharedComparison = compareScoreArrays(
      [...sharedLeft].sort((a, b) => a - b),
      [...sharedRight].sort((a, b) => a - b),
    );
    if (a81SharedComparison !== 0) return a81SharedComparison;

    const sharedDescendingIds = [...sharedRaceIds]
      .map((raceId) => {
        const leftRow = left.byRaceId.get(raceId);
        const rightRow = right.byRaceId.get(raceId);
        const raceNumber =
          leftRow?.race_number ??
          rightRow?.race_number ??
          Number.MIN_SAFE_INTEGER;
        return { raceId, raceNumber };
      })
      .sort((a, b) => b.raceNumber - a.raceNumber || b.raceId - a.raceId)
      .map((entry) => entry.raceId);
    const a82SharedLeft = sharedDescendingIds
      .map((raceId) => left.byRaceId.get(raceId)?.points)
      .filter((score): score is number => score != null);
    const a82SharedRight = sharedDescendingIds
      .map((raceId) => right.byRaceId.get(raceId)?.points)
      .filter((score): score is number => score != null);
    const a82SharedComparison = compareScoreArrays(
      a82SharedLeft,
      a82SharedRight,
    );
    if (a82SharedComparison !== 0) return a82SharedComparison;
  } else {
    const a81Comparison = compareScoreArrays(
      left.a81KeptScores,
      right.a81KeptScores,
    );
    if (a81Comparison !== 0) return a81Comparison;

    const a82Comparison = compareScoreArrays(
      left.a82AllScores,
      right.a82AllScores,
    );
    if (a82Comparison !== 0) return a82Comparison;
  }

  // Deterministic fallback when still tied after all applicable rules.
  return String(leftBoatId).localeCompare(String(rightBoatId));
}

export function resolveOverallTieGroupSequentially<T extends { boat_id: any }>(
  rows: T[],
  getTiePacket: (boatId: any) => OverallTiePacket,
): T[] {
  return resolveTiesSequentially(rows, (left, right) =>
    compareOverallTiePackets(
      left.boat_id,
      right.boat_id,
      getTiePacket(left.boat_id),
      getTiePacket(right.boat_id),
    ),
  );
}
