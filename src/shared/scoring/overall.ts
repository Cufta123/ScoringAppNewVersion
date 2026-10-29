/**
 * Overall standings (SHRS 5.5): qualifying score + final score, every boat of
 * a higher fleet ranked before every boat of a lower one, ties inside a fleet
 * broken across BOTH series (SHRS 5.7(ii)). Pure: the caller loads the scores.
 */
import { DiscardConfig, getExcludeCountForConfig } from '../discardProfile';
import { fleetRank } from '../fleetNames';
import { getHeatRoundFromName } from '../heatNames';
import { capExcludeCountForBoat, getKeptScores } from './discards';
import {
  BoatKey,
  compareScoreArrays,
  findUnbrokenTies,
  resolveTiesSequentially,
} from './ranking';

export type OverallRaceScore = {
  race_id: number;
  race_number: number;
  points: number;
  status: string;
  heat_type: string;
  heat_name: string;
};

/** What the overall tie-break needs to know about one boat. */
export type OverallTiePacket = {
  raceIds: Set<number>;
  byRaceId: Map<number, OverallRaceScore>;
  /** Kept (not excluded) scores of both series, best first (RRS A8.1). */
  a81KeptScores: number[];
  /** Every score, the event's last race first (RRS A8.2). */
  a82AllScores: number[];
};

export interface OverallSeriesContext {
  qualifyingDiscardConfig: DiscardConfig;
  finalDiscardConfig: DiscardConfig;
  /** SHRS 5.4: races completed in the qualifying series. */
  qualifyingRaceCount: number;
  /** SHRS 5.4: races completed by this boat's final fleet. */
  finalFleetRaceCount: number;
}

/** Qualifying round of a score's heat; 0 for a Final fleet. */
const roundOf = (row: Pick<OverallRaceScore, 'heat_name'>) =>
  getHeatRoundFromName(row.heat_name) ?? 0;

/**
 * Last race first within a series. Race numbers restart in every qualifying
 * round, so the round (from the heat name) orders races before the number.
 */
const latestRaceFirst = (
  a: Pick<OverallRaceScore, 'heat_name' | 'race_number' | 'race_id'>,
  b: Pick<OverallRaceScore, 'heat_name' | 'race_number' | 'race_id'>,
) =>
  roundOf(b) - roundOf(a) ||
  b.race_number - a.race_number ||
  b.race_id - a.race_id;

function seriesPacket(
  scores: OverallRaceScore[],
  discardConfig: DiscardConfig,
  seriesRaceCount: number,
) {
  // SHRS 5.4: the discard count is series-wide (qualifying) / fleet-wide
  // (final), capped per boat exactly as when the totals were computed, so the
  // A8.1 list agrees with the stored totals for late entrants (RULE-M22).
  const excludeCount = capExcludeCountForBoat(
    getExcludeCountForConfig(seriesRaceCount, discardConfig),
    scores.length,
  );
  return {
    kept: getKeptScores(scores, excludeCount).sort((a, b) => a - b),
    latestFirst: [...scores].sort(latestRaceFirst).map((entry) => entry.points),
  };
}

/** One boat's tie-break packet from its qualifying and final scores. */
export function overallTiePacketFromScores(
  scores: OverallRaceScore[],
  context: OverallSeriesContext,
): OverallTiePacket {
  const qualifying = seriesPacket(
    scores.filter((row) => row.heat_type === 'Qualifying'),
    context.qualifyingDiscardConfig,
    context.qualifyingRaceCount,
  );
  const final = seriesPacket(
    scores.filter((row) => row.heat_type === 'Final'),
    context.finalDiscardConfig,
    context.finalFleetRaceCount,
  );
  return {
    raceIds: new Set(scores.map((row) => row.race_id)),
    byRaceId: new Map(scores.map((row) => [row.race_id, row])),
    a81KeptScores: [...qualifying.kept, ...final.kept].sort((a, b) => a - b),
    // RRS A8.2 walks back from the event's LAST race, and the final series is
    // sailed after the qualifying series, so final races lead.
    a82AllScores: [...final.latestFirst, ...qualifying.latestFirst],
  };
}

const pointsOn = (packet: OverallTiePacket, raceIds: number[]) =>
  raceIds
    .map((raceId) => packet.byRaceId.get(raceId)?.points)
    .filter((score): score is number => score != null);

/**
 * Negative when `left` ranks ahead, 0 when the rules cannot separate them.
 *
 * The overall standings only exist for multi-heat events, so SHRS 5.7(ii)
 * applies: boats that sailed races together are compared on those races,
 * excluded scores included; boats that never met fall back to plain RRS A8.
 * A tie that survives every rule stays a tie — never ordered by boat id (M8).
 */
export function compareOverallTiePackets(
  left: OverallTiePacket,
  right: OverallTiePacket,
): number {
  const shared = [...left.raceIds].filter((raceId) =>
    right.raceIds.has(raceId),
  );
  if (shared.length === 0) {
    return (
      compareScoreArrays(left.a81KeptScores, right.a81KeptScores) ||
      compareScoreArrays(left.a82AllScores, right.a82AllScores)
    );
  }

  const byBest = (a: number, b: number) => a - b;
  const a81 = compareScoreArrays(
    pointsOn(left, shared).sort(byBest),
    pointsOn(right, shared).sort(byBest),
  );
  if (a81 !== 0) return a81;

  // A8.2 on the shared races, from the last race back: final races first,
  // then latest round, then race number.
  const latestFirst = shared
    .map((raceId) => {
      const row = left.byRaceId.get(raceId) ?? right.byRaceId.get(raceId);
      return {
        raceId,
        round: row ? roundOf(row) : 0,
        raceNumber: row?.race_number ?? Number.MIN_SAFE_INTEGER,
        seriesRank: row?.heat_type === 'Final' ? 0 : 1,
      };
    })
    .sort(
      (a, b) =>
        a.seriesRank - b.seriesRank ||
        b.round - a.round ||
        b.raceNumber - a.raceNumber ||
        b.raceId - a.raceId,
    )
    .map((entry) => entry.raceId);
  return compareScoreArrays(
    pointsOn(left, latestFirst),
    pointsOn(right, latestFirst),
  );
}

/** SHRS 5.7(ii)(3): resolve the higher place of a tie group first. */
export function resolveOverallTieGroupSequentially<
  T extends { boat_id: BoatKey },
>(rows: T[], getTiePacket: (boatId: T['boat_id']) => OverallTiePacket): T[] {
  return resolveTiesSequentially(rows, (left, right) =>
    compareOverallTiePackets(
      getTiePacket(left.boat_id),
      getTiePacket(right.boat_id),
    ),
  );
}

export interface OverallRow {
  boat_id: BoatKey;
  placement_group: string;
  /** Qualifying + final, already normalised with roundPoints. */
  overall_points: number;
}

/**
 * SHRS 5.5 overall ranking. Fleets in order (Gold, Silver, Bronze, Copper,
 * then "Fleet 5" and on), lowest total first inside a fleet, ties broken by
 * SHRS 5.7(ii). Boats the tie-break cannot separate share a rank: 1, 2, 2, 4.
 * Rows that stay level keep their input order.
 */
export function rankOverallStandings<T extends OverallRow>(
  rows: T[],
  getTiePacket: (boatId: T['boat_id']) => OverallTiePacket,
): (T & { overall_rank: number })[] {
  const sorted = [...rows].sort(
    (left, right) =>
      fleetRank(left.placement_group) - fleetRank(right.placement_group) ||
      left.overall_points - right.overall_points,
  );
  const compare = (left: T, right: T) =>
    compareOverallTiePackets(
      getTiePacket(left.boat_id),
      getTiePacket(right.boat_id),
    );

  const ordered: T[] = [];
  const tiedWithAbove = new Set<string>();
  for (let i = 0; i < sorted.length; ) {
    const { placement_group: fleet, overall_points: points } = sorted[i];
    const group: T[] = [];
    while (
      i < sorted.length &&
      sorted[i].placement_group === fleet &&
      sorted[i].overall_points === points
    ) {
      group.push(sorted[i]);
      i += 1;
    }
    if (group.length === 1) {
      ordered.push(group[0]);
    } else {
      const resolved = resolveOverallTieGroupSequentially(group, getTiePacket);
      findUnbrokenTies(resolved, compare).forEach((id) =>
        tiedWithAbove.add(id),
      );
      ordered.push(...resolved);
    }
  }

  const ranked: (T & { overall_rank: number })[] = [];
  ordered.forEach((row, index) => {
    const above = ranked[index - 1];
    const sharesAbove =
      above &&
      above.placement_group === row.placement_group &&
      above.overall_points === row.overall_points &&
      tiedWithAbove.has(String(row.boat_id));
    ranked.push({
      ...row,
      overall_rank: sharesAbove ? above.overall_rank : index + 1,
    });
  });
  return ranked;
}
