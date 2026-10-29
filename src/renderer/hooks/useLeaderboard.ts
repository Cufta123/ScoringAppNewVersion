import { useMemo } from 'react';
import { compareFleetGroups, getFlagCode } from '../utils/leaderboardUtils';
import { reportWarning } from '../utils/userFeedback';
import { useEventDataChanged } from '../utils/eventDataChanged';
import useLeaderboardEditSession from './useLeaderboardEditSession';
import useLeaderboardStandings from './useLeaderboardStandings';
import useLeaderboardCompare from './useLeaderboardCompare';
import useLeaderboardEdit from './useLeaderboardEdit';
import type { LeaderboardEntry } from '../types';

/**
 * The leaderboard page's state and actions, put together from:
 *  - useLeaderboardStandings: loading the standings,
 *  - useLeaderboardEditSession + useLeaderboardEdit: editing and saving results,
 *  - useLeaderboardCompare: the compare / tie-break panel.
 */
export default function useLeaderboard(eventId: number) {
  const session = useLeaderboardEditSession();
  const standings = useLeaderboardStandings(eventId, {
    onReload: session.endEdits,
    onLoaded: session.showRows,
  });
  const {
    leaderboard,
    eventLeaderboard,
    overallLeaderboard,
    loading,
    finalSeriesStarted,
    discardProfiles,
    maxHeatSizes,
    fetchLeaderboard,
    checkFinalSeriesStarted,
  } = standings;

  const compare = useLeaderboardCompare(
    eventId,
    finalSeriesStarted,
    leaderboard,
    eventLeaderboard,
  );

  const edit = useLeaderboardEdit(session, {
    eventId,
    finalSeriesStarted,
    leaderboard,
    eventLeaderboard,
    discardProfile: finalSeriesStarted
      ? discardProfiles.final
      : discardProfiles.qualifying,
    maxHeatSize: finalSeriesStarted
      ? maxHeatSizes.final
      : maxHeatSizes.qualifying,
    fetchLeaderboard,
    checkFinalSeriesStarted,
    resetCompare: compare.resetCompare,
  });

  // The results changed behind this page (an undo or going back in the event
  // history). Reload, unless the user is editing: their unsaved edits must not
  // be thrown away. While editing, the screen now shows results that are no
  // longer there; saving them would silently put the old results back, so Save
  // is refused until the edit is started again.
  const { editMode, editIsStaleRef } = session;
  useEventDataChanged(eventId, () => {
    if (editMode) {
      editIsStaleRef.current = true;
      reportWarning(
        'The results were changed in the history while you were editing. Press Cancel Editing to see them, then edit again.',
        'Results changed',
      );
      return;
    }
    checkFinalSeriesStarted();
    fetchLeaderboard();
  });

  const hasEventData = eventLeaderboard.length > 0;
  // "Final data" means at least one final race has been scored — not merely
  // that fleets exist. Fleet rows now persist from the moment the final series
  // starts (so unraced fleets stay visible once ANY fleet has raced), but with
  // zero races everywhere the page must still show the qualifying standings
  // (SHRS 1.5) behind the "final series ready" notice.
  const hasFinalData = leaderboard.some(
    (entry) => (entry.races?.length ?? 0) > 0,
  );

  const { editableLeaderboard } = session;
  const groupedLeaderboard = useMemo(
    () =>
      editableLeaderboard?.reduce(
        (acc, entry) => {
          const group = entry.placement_group || 'General';
          if (!acc[group]) acc[group] = [];
          acc[group].push(entry);
          return acc;
        },
        {} as Record<string, LeaderboardEntry[]>,
      ) || {},
    [editableLeaderboard],
  );

  // SHRS 5.5 fleet precedence, shared with the export grouping and the main
  // process so every fleet — including the 5th and later — has a real rank.
  const sortedGroups = useMemo(
    () => Object.keys(groupedLeaderboard).sort(compareFleetGroups),
    [groupedLeaderboard],
  );

  return {
    // State
    leaderboard,
    eventLeaderboard,
    discardProfiles,
    loading,
    finalSeriesStarted,
    editMode,
    saving: edit.saving,
    editableLeaderboard,
    overallLeaderboard,
    compareMode: compare.compareMode,
    selectedBoatIds: compare.selectedBoatIds,
    rdgMeta: session.rdgMeta,
    rdg2Picker: session.rdg2Picker,
    hasUnsavedChanges: edit.hasUnsavedChanges,
    invalidCells: session.invalidCells,
    // Derived
    hasEventData,
    hasFinalData,
    groupedLeaderboard,
    sortedGroups,
    compareInfo: compare.compareInfo,
    // Setters
    setCompareMode: compare.setCompareMode,
    setSelectedBoatIds: compare.setSelectedBoatIds,
    setRdg2Picker: session.setRdg2Picker,
    // Actions
    toggleEditMode: edit.toggleEditMode,
    handleSave: edit.handleSave,
    handleRaceChange: edit.handleRaceChange,
    confirmRdg2: edit.confirmRdg2,
    handleCompareRowClick: compare.handleCompareRowClick,
    reportInvalidCell: session.reportInvalidCell,
    getFlagCode,
  };
}
