import type {
  CompareEntry,
  CompareInfo,
  LeaderboardEntry,
  PlacementGroup,
  TieBreakResult,
} from '../types';

const normalizeGroup = (group?: PlacementGroup | null): string =>
  group || 'General';

/**
 * In the Final Series two boats are compared within their fleet: the fleet
 * both belong to, or null when they are in different fleets (or it is the
 * qualifying series).
 */
const getSharedPlacementGroup = (
  boatA: CompareEntry,
  boatB: CompareEntry,
  finalSeriesStarted: boolean,
): string | null =>
  finalSeriesStarted &&
  boatA?.placement_group &&
  boatB?.placement_group &&
  boatA.placement_group === boatB.placement_group
    ? boatA.placement_group
    : null;

interface GetOtherTiedCountArgs<E extends CompareEntry> {
  allEntries: E[];
  boatA: CompareEntry;
  boatB: CompareEntry;
  totalA: number;
  totalB: number;
  finalSeriesStarted: boolean;
  getTotal: (entry: E) => number;
}

/**
 * Count how many boats other than A/B have the same total score.
 * In final series, this is scoped to A/B's shared placement group.
 */
export const getOtherTiedCount = <E extends CompareEntry>({
  allEntries,
  boatA,
  boatB,
  totalA,
  totalB,
  finalSeriesStarted,
  getTotal,
}: GetOtherTiedCountArgs<E>): number => {
  const selectedPlacementGroup = getSharedPlacementGroup(
    boatA,
    boatB,
    finalSeriesStarted,
  );

  return allEntries.filter((entry) => {
    if (
      selectedPlacementGroup &&
      normalizeGroup(entry.placement_group) !== selectedPlacementGroup
    ) {
      return false;
    }

    return (
      entry.boat_id !== boatA.boat_id &&
      entry.boat_id !== boatB.boat_id &&
      getTotal(entry) === totalA &&
      getTotal(entry) === totalB
    );
  }).length;
};

interface GetNextCompareSelectionArgs<E extends CompareEntry> {
  previousSelectedBoatIds: number[];
  clickedBoatId: number;
  compareMode: boolean;
  finalSeriesStarted: boolean;
  allEntries: E[];
  clickedPlacementGroup?: PlacementGroup | null;
}

/**
 * Compare-mode selection state transition.
 * In final series, keeps selection within one placement group.
 */
export const getNextCompareSelection = <E extends CompareEntry>({
  previousSelectedBoatIds,
  clickedBoatId,
  compareMode,
  finalSeriesStarted,
  allEntries,
  clickedPlacementGroup = null,
}: GetNextCompareSelectionArgs<E>): number[] => {
  if (!compareMode) return previousSelectedBoatIds;

  if (previousSelectedBoatIds.includes(clickedBoatId)) {
    return previousSelectedBoatIds.filter((id) => id !== clickedBoatId);
  }

  if (finalSeriesStarted) {
    const clickedGroup = normalizeGroup(
      clickedPlacementGroup ||
        allEntries.find((entry) => entry.boat_id === clickedBoatId)
          ?.placement_group,
    );

    if (previousSelectedBoatIds.length > 0) {
      const firstSelectedId = previousSelectedBoatIds[0];
      const firstSelectedGroup = normalizeGroup(
        allEntries.find((entry) => entry.boat_id === firstSelectedId)
          ?.placement_group,
      );

      if (clickedGroup !== firstSelectedGroup) {
        // Switch fleet explicitly: start a fresh pair in the clicked fleet.
        return [clickedBoatId];
      }
    }
  }

  if (previousSelectedBoatIds.length >= 2) {
    return [previousSelectedBoatIds[1], clickedBoatId];
  }

  return [...previousSelectedBoatIds, clickedBoatId];
};

/** The total the leaderboard ranks by: combined once the Final Series started. */
const getCompareTotal = (
  entry: LeaderboardEntry,
  finalSeriesStarted: boolean,
): number =>
  finalSeriesStarted
    ? (entry.total_points_combined ?? entry.computed_total ?? 0)
    : (entry.computed_total ?? 0);

/** What the compare panel shows before the main process has explained the tie. */
export interface CompareBase {
  allEntries: LeaderboardEntry[];
  boatA: LeaderboardEntry;
  boatB: LeaderboardEntry;
  totalA: number;
  totalB: number;
  otherTiedCount: number;
  tiedGroupEntries: LeaderboardEntry[];
}

/**
 * Display assembly for two selected boats: their totals, how many others share
 * the score, and the boats tied with them in rank order. Null unless exactly
 * two boats are selected and both are on the leaderboard.
 */
export const buildCompareBase = (
  allEntries: LeaderboardEntry[],
  selectedBoatIds: number[],
  finalSeriesStarted: boolean,
): CompareBase | null => {
  if (selectedBoatIds.length !== 2) return null;
  const boatA = allEntries.find((e) => e.boat_id === selectedBoatIds[0]);
  const boatB = allEntries.find((e) => e.boat_id === selectedBoatIds[1]);
  if (!boatA || !boatB) return null;

  const getTotal = (e: LeaderboardEntry): number =>
    getCompareTotal(e, finalSeriesStarted);
  const totalA = getTotal(boatA);
  const totalB = getTotal(boatB);

  const otherTiedCount = getOtherTiedCount({
    allEntries,
    boatA,
    boatB,
    totalA,
    totalB,
    finalSeriesStarted,
    getTotal,
  });

  const scopedPlacementGroup = getSharedPlacementGroup(
    boatA,
    boatB,
    finalSeriesStarted,
  );

  const rankOf = (e: LeaderboardEntry): number =>
    (finalSeriesStarted ? e.overall_rank : e.place) ?? Infinity;

  const tiedGroupEntries = allEntries
    .filter((entry) => {
      if (
        scopedPlacementGroup &&
        normalizeGroup(entry.placement_group) !== scopedPlacementGroup
      ) {
        return false;
      }
      return getTotal(entry) === totalA && getTotal(entry) === totalB;
    })
    .sort((a, b) => {
      const rankA = rankOf(a);
      const rankB = rankOf(b);
      if (rankA !== rankB) return rankA - rankB;
      return String(a.boat_id).localeCompare(String(b.boat_id));
    });

  return {
    allEntries,
    boatA,
    boatB,
    totalA,
    totalB,
    otherTiedCount,
    tiedGroupEntries,
  };
};

/**
 * The compare panel's data: the authoritative SHRS 5.7 decision (winner,
 * route, steps, race grid) comes from the main process (`res`) so the panel can
 * never disagree with the ranking; only names and the tied-group listing are
 * assembled here.
 */
export const buildCompareInfo = (
  base: CompareBase,
  res: TieBreakResult,
): CompareInfo => {
  const winner =
    res.winnerBoatId != null
      ? base.allEntries.find(
          (e) => String(e.boat_id) === String(res.winnerBoatId),
        ) || null
      : null;
  // Race IDs are strings in the leaderboard rows (CSV-split), so the
  // shared-race highlight sets must be strings to match table cells.
  const sharedIds = new Set(
    (res.sharedRacePairs || []).map((pair) => String(pair.raceId)),
  );
  const sharedQualIds = new Set(
    (res.sharedQualRacePairs || []).map((pair) => String(pair.raceId)),
  );
  return {
    boatA: base.boatA,
    boatB: base.boatB,
    totalA: res.totalA ?? base.totalA,
    totalB: res.totalB ?? base.totalB,
    tied: res.tied,
    tieBreak: res.tied
      ? {
          steps: res.steps || [],
          winner,
          rule: res.route?.rule || 'SHRS 5.7',
          detail: res.route?.note || '',
        }
      : null,
    routeStep: res.route || null,
    raceGrid: res.raceGrid || [],
    sharedRacePairs: res.sharedRacePairs || [],
    sharedQualRacePairs: res.sharedQualRacePairs || [],
    sharedIds,
    sharedQualIds,
    otherTiedCount: base.otherTiedCount,
    tiedGroupEntries: base.tiedGroupEntries,
  };
};
