import { useState, useEffect, useMemo, useRef } from 'react';
import { heatRaceDB } from '../api/db';
import {
  confirmAction,
  reportError,
  reportInfo,
  reportWarning,
} from '../utils/userFeedback';
import {
  applyRaceEdit,
  averageSelectedRacePoints,
  clampFinishingPlace,
  createEditScoringContext,
  findRaceGroup,
  getPenaltyPosition,
  refreshSessionRdgAverages,
  resolveEditedCell,
  withRedressAverage,
} from '../utils/leaderboardEdit';
import { buildRaceOperations } from '../utils/leaderboardSave';
import type { LeaderboardEditSession } from './useLeaderboardEditSession';
import { cloneEntries } from '../utils/leaderboardUtils';
import type { LeaderboardEntry } from '../types';

interface EditInputs {
  eventId: number;
  finalSeriesStarted: boolean;
  /** The saved rows being shown (final fleets, or qualifying before that). */
  leaderboard: LeaderboardEntry[];
  eventLeaderboard: LeaderboardEntry[];
  discardProfile: string;
  /** Largest heat of the series being edited (SHRS 5.2). */
  maxHeatSize: number;
  fetchLeaderboard: () => Promise<void>;
  checkFinalSeriesStarted: () => Promise<void>;
  resetCompare: () => void;
}

/**
 * Editing the leaderboard: cell edits (places, status codes, RDG1/RDG2/RDG3,
 * DPI), the RDG2 race picker, Save, and detecting unsaved changes. The preview
 * maths is in utils/leaderboardEdit; the state is in useLeaderboardEditSession.
 */
export default function useLeaderboardEdit(
  session: LeaderboardEditSession,
  {
    eventId,
    finalSeriesStarted,
    leaderboard,
    eventLeaderboard,
    discardProfile,
    maxHeatSize,
    fetchLeaderboard,
    checkFinalSeriesStarted,
    resetCompare,
  }: EditInputs,
) {
  const {
    editMode,
    setEditMode,
    editableLeaderboard,
    setEditableLeaderboard,
    userEditsRef,
    setRdgMeta,
    rdg2Picker,
    setRdg2Picker,
    editIsStaleRef,
    invalidCells,
    clearEdits,
  } = session;

  // True while a save (atomic write + leaderboard refetch/recompute) is running,
  // so the toolbar can disable the button and show progress instead of looking
  // frozen during the recompute.
  const [saving, setSaving] = useState(false);
  // LB-2: synchronous re-entrancy guard for handleSave. `saving` state is
  // batched and only set AFTER the confirmChoice dialog, so two rapid clicks
  // both pass `if (saving) return`; a ref set before any await closes that.
  const savingRef = useRef(false);

  const savedRows = finalSeriesStarted ? leaderboard : eventLeaderboard;

  const hasUnsavedChanges = useMemo(() => {
    if (!editMode) return false;
    // Something typed but not valid yet is still unsaved work to ask about.
    if (Object.keys(invalidCells).length > 0) return true;
    if (!Array.isArray(savedRows) || savedRows.length === 0) return false;
    return JSON.stringify(editableLeaderboard) !== JSON.stringify(savedRows);
  }, [editMode, invalidCells, editableLeaderboard, savedRows]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  const toggleEditMode = async () => {
    if (editMode && hasUnsavedChanges) {
      const shouldDiscard = await confirmAction(
        'You have unsaved leaderboard changes. Cancel editing and discard them?',
        'Discard changes',
        { confirmLabel: 'Discard', confirmClassName: 'btn-danger' },
      );
      if (!shouldDiscard) return;
    }

    session.showRows(savedRows);
    if (editMode && editIsStaleRef.current) {
      // Leaving a stale edit: show what is there now.
      editIsStaleRef.current = false;
      checkFinalSeriesStarted();
      fetchLeaderboard();
    }
    clearEdits();
    // Editing and comparing don't mix: row clicks (bubbling up from the edit
    // inputs) would toggle compare selection, and the compare panel reads
    // saved backend data that contradicts the on-screen draft.
    if (!editMode) resetCompare();
    setEditMode(!editMode);
  };

  const handleRaceChange = (
    boatId: number,
    raceIndex: number,
    newRaceValue: string | number | null,
    newStatus = 'FINISHED',
  ) => {
    const cloned = cloneEntries(editableLeaderboard);
    const targetEntry = cloned.find((e) => e.boat_id === boatId);
    if (!targetEntry) return;

    // LB-3: choosing any status other than RDG2 for a cell closes its open RDG2
    // picker. Without this, the picker stays open after e.g. DNS/FINISHED and
    // `confirmRdg2` (Apply) would silently revert the user back to RDG2.
    if (
      rdg2Picker &&
      rdg2Picker.boatId === boatId &&
      rdg2Picker.raceIndex === raceIndex &&
      newStatus !== 'RDG2'
    ) {
      setRdg2Picker(null);
    }

    // RDG2 is applied from the race picker (confirmRdg2), not typed.
    if (newStatus === 'RDG2') return;

    const ctx = createEditScoringContext(
      editableLeaderboard,
      finalSeriesStarted,
      discardProfile,
      maxHeatSize,
    );
    const penaltyPosition = getPenaltyPosition(ctx, cloned.length);
    const maxBoats = penaltyPosition - 1;

    const resolved = resolveEditedCell(
      targetEntry,
      raceIndex,
      newRaceValue,
      newStatus,
      penaltyPosition,
    );
    if (!resolved) return;
    if (newStatus === 'RDG1' || newStatus === 'RDG3') {
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: newStatus },
      }));
    }

    // RULE-M16 / RRS A6.1 and the manual ripple are both decided inside
    // shared/raceColumnEdit (see applyRaceEdit); the hook only supplies the
    // before/after facts.
    const group = findRaceGroup(cloned, boatId, raceIndex);
    const cell = clampFinishingPlace(
      resolved,
      newStatus,
      group.length || 1,
      maxBoats,
    );

    // Remember the raw user edit for the save payload.
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: cell.position,
      status: newStatus,
    });

    const updated = applyRaceEdit(cloned, group, ctx, {
      boatId,
      raceIndex,
      position: cell.position,
      points: cell.points,
      status: newStatus,
      maxBoats,
    });

    const refreshed = refreshSessionRdgAverages(
      updated,
      userEditsRef.current,
      ctx,
    );
    refreshed.changedEdits.forEach(([key, edit]) =>
      userEditsRef.current.set(key, edit),
    );
    setEditableLeaderboard(refreshed.rows);
  };

  const confirmRdg2 = () => {
    if (!rdg2Picker) return;
    const { boatId, raceIndex, selectedIndices } = rdg2Picker;
    const cloned = cloneEntries(editableLeaderboard);
    const entry = cloned.find((e) => e.boat_id === boatId);
    if (!entry) {
      setRdg2Picker(null);
      return;
    }

    // LB-3: only apply RDG2 while the picker is still this cell's intent. The
    // picker is closed the moment a non-RDG2 status is applied to the cell
    // (handleRaceChange + ScoreCell), so the `if (!rdg2Picker) return` above is
    // the guard: a live picker here means the status has not been overridden
    // since it opened, and applying RDG2 is safe.

    const ctx = createEditScoringContext(
      editableLeaderboard,
      finalSeriesStarted,
      discardProfile,
      maxHeatSize,
    );
    const penaltyPosition = getPenaltyPosition(ctx, cloned.length);

    // RRS A9(b): average of her points in the selected group of races.
    // Penalty scores are her points and are included.
    // SHRS 5.6 (RULE-M10): the group is confined to the series the redressed
    // cell belongs to. `entry` is the row on the leaderboard being edited, so
    // its races are exactly that series' races.
    const seriesIndices = [...(selectedIndices || new Set<number>())];
    const avg = averageSelectedRacePoints(
      entry,
      seriesIndices,
      raceIndex,
      penaltyPosition,
    );

    // Record the raw edit so handleSave persists this RDG2 cell. The preview
    // replaces only this cell (no column re-rank), and so does Save. The
    // selection is kept so the average can be refreshed if later edits change
    // the selected races' points.
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: avg,
      status: 'RDG2',
      rdgSelection: { seriesIndices },
    });

    const updatedEntry = withRedressAverage(
      entry,
      ctx,
      raceIndex,
      avg,
      'RDG2',
      penaltyPosition,
    );

    // The selected races are always in the edited cell's own series (SHRS 5.6),
    // so one prefix covers them all: F… once the final series started, Q… while
    // the event is still qualifying-only.
    const currentSeriesPrefix = finalSeriesStarted ? 'F' : 'Q';
    const selectedRaceLabels = [...seriesIndices]
      .sort((a, b) => a - b)
      .map((i) => `${currentSeriesPrefix}${i + 1}`);
    setRdgMeta((prev) => ({
      ...prev,
      [`${boatId}-${raceIndex}`]: { type: 'RDG2', selectedRaceLabels },
    }));
    // This RDG2 changes the boat's points in this race, which can feed other
    // session-granted RDG averages on the same boat — refresh them too.
    const refreshed = refreshSessionRdgAverages(
      cloned.map((e) => (e.boat_id === boatId ? updatedEntry : e)),
      userEditsRef.current,
      ctx,
    );
    refreshed.changedEdits.forEach(([key, edit]) =>
      userEditsRef.current.set(key, edit),
    );
    setEditableLeaderboard(refreshed.rows);
    setRdg2Picker(null);
  };

  const handleSave = async () => {
    // LB-2: synchronous re-entrancy guard (see savingRef declaration). `saving`
    // state is set only after the confirm dialog, so it cannot block a second
    // click that arrives while that dialog is open.
    if (savingRef.current) return;
    if (editIsStaleRef.current) {
      reportWarning(
        'Nothing was saved: the results were changed in the history while you were editing. Press Cancel Editing to see them, then edit again.',
        'Results changed',
      );
      return;
    }
    const invalidMessages = Object.values(invalidCells);
    if (invalidMessages.length > 0) {
      reportWarning(
        `Nothing was saved. Fix the results marked in red first:\n${invalidMessages.join('\n')}`,
        'Some results are not valid',
        // The red cells and the count in the edit banner stay.
        { inline: true },
      );
      return;
    }
    savingRef.current = true;
    try {
      if (!editableLeaderboard || !leaderboard) {
        throw new Error('Leaderboard data is not initialized');
      }

      const updateOperations = buildRaceOperations(
        editableLeaderboard,
        savedRows,
        userEditsRef.current,
      );

      if (updateOperations.length === 0) {
        clearEdits();
        setEditMode(false);
        session.showRows(savedRows);
        reportInfo('No result was changed.', 'Nothing to save');
        return;
      }

      setSaving(true);
      try {
        await heatRaceDB.saveLeaderboardRaceResultsAtomic(
          eventId,
          updateOperations,
          finalSeriesStarted,
        );

        // LB-5: clear the queued edits and leave edit mode BEFORE refetching.
        // If the refetch throws, the save has still persisted — leaving these
        // here (in the old ordering) meant a retry re-sent stale pre-save edits
        // on top of the already-persisted data.
        clearEdits();
        setEditMode(false);

        await fetchLeaderboard();
        reportInfo(
          'Your leaderboard changes have been saved.',
          'Leaderboard saved',
        );
      } finally {
        setSaving(false);
      }
    } catch (error) {
      // Keep the draft, the queued edits, and edit mode intact so the user can
      // fix the problem and retry. Resetting only the visible state here would
      // leave the queued edits invisible but still pending — a later save
      // would silently resend work the user could no longer see.
      reportError('Could not save leaderboard changes.', error);
    } finally {
      savingRef.current = false;
    }
  };

  return {
    saving,
    hasUnsavedChanges,
    toggleEditMode,
    handleRaceChange,
    confirmRdg2,
    handleSave,
  };
}
