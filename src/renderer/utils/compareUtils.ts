/* eslint-disable camelcase */

import type { CompareEntry, PlacementGroup } from '../types';

const normalizeGroup = (group?: PlacementGroup | null): string =>
  group || 'General';

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
  let selectedPlacementGroup: string | null = null;
  if (
    finalSeriesStarted &&
    boatA?.placement_group &&
    boatB?.placement_group &&
    boatA.placement_group === boatB.placement_group
  ) {
    selectedPlacementGroup = boatA.placement_group;
  }

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
