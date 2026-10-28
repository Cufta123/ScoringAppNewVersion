import { useState, useEffect, useCallback } from 'react';
import { heatRaceDB } from '../api/db';
import { reportError } from '../utils/userFeedback';
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
  const [compareInfo, setCompareInfo] = useState<CompareInfo | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    const allEntries = finalSeriesStarted ? leaderboard : eventLeaderboard;
    const base = buildCompareBase(
      allEntries,
      selectedBoatIds,
      finalSeriesStarted,
    );
    if (!base) {
      setCompareInfo(null);
      return undefined;
    }

    (async () => {
      try {
        const res = await heatRaceDB.explainTieBreak(
          eventId,
          base.boatA.boat_id,
          base.boatB.boat_id,
          finalSeriesStarted,
        );
        if (cancelled || !res) return;
        setCompareInfo(buildCompareInfo(base, res));
      } catch (error) {
        if (!cancelled) {
          reportError('Could not compute tie-break comparison.', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedBoatIds,
    finalSeriesStarted,
    eventLeaderboard,
    leaderboard,
    eventId,
  ]);

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
