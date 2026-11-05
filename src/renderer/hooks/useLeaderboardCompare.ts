import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, useReportQueryError } from '../api/queries';
import {
  buildCompareBase,
  buildCompareInfo,
  getNextCompareSelection,
} from '../utils/compareUtils';
import type { CompareInfo, LeaderboardEntry } from '../types';

/**
 * The compare / tie-break panel: which two boats are selected and the
 * comparison shown for them. The authoritative SHRS 5.7 decision (winner,
 * route, steps, race grid) comes from the main process so the panel can never
 * disagree with the ranking; only display assembly (names, tied-group listing)
 * happens here (utils/compareUtils).
 */
export default function useLeaderboardCompare(
  eventId: number,
  finalSeriesStarted: boolean,
  leaderboard: LeaderboardEntry[],
  eventLeaderboard: LeaderboardEntry[],
) {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedBoatIds, setSelectedBoatIds] = useState<number[]>([]);

  const handleCompareRowClick = (
    boat_id: number,
    placementGroup: string | null = null,
  ) => {
    if (!compareMode) return;
    const allEntries = finalSeriesStarted ? leaderboard : eventLeaderboard;
    setSelectedBoatIds((prev) =>
      getNextCompareSelection({
        previousSelectedBoatIds: prev,
        clickedBoatId: boat_id,
        compareMode,
        finalSeriesStarted,
        allEntries,
        clickedPlacementGroup: placementGroup,
      }),
    );
  };

  /** Leave compare mode with nothing selected (editing and comparing don't mix). */
  const resetCompare = useCallback(() => {
    setCompareMode(false);
    setSelectedBoatIds([]);
  }, []);

  // The two boats as the standings show them now (null: not two selected).
  const base = useMemo(
    () =>
      buildCompareBase(
        finalSeriesStarted ? leaderboard : eventLeaderboard,
        selectedBoatIds,
        finalSeriesStarted,
      ),
    [selectedBoatIds, finalSeriesStarted, eventLeaderboard, leaderboard],
  );
  const tieBreak = useQuery({
    ...queries.tieBreak(
      eventId,
      base?.boatA.boat_id ?? -1,
      base?.boatB.boat_id ?? -1,
      finalSeriesStarted,
    ),
    enabled: base != null,
  });
  useReportQueryError(tieBreak, 'Could not compute tie-break comparison.');

  // Until the decision for a new pair (or the standings read again) arrives,
  // the panel keeps showing the last one, as it always did.
  const lastInfoRef = useRef<CompareInfo | null>(null);
  const compareInfo = useMemo(() => {
    if (!base) return null;
    if (!tieBreak.data) return lastInfoRef.current;
    return buildCompareInfo(base, tieBreak.data);
  }, [base, tieBreak.data]);
  lastInfoRef.current = compareInfo;

  return {
    compareMode,
    selectedBoatIds,
    compareInfo,
    setCompareMode,
    setSelectedBoatIds,
    handleCompareRowClick,
    resetCompare,
  };
}
