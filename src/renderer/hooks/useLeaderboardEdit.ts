import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { heatRaceDB } from '../api/db';
import { useWrite } from '../api/writes';
import {
  confirmAction,
  reportError,
  reportInfo,
  reportWarning,
} from '../utils/userFeedback';
import {
  applyRaceEdit,
  clampFinishingPlace,
  findRaceGroup,
  largestHeatFor,
  resolveEditedCell,
} from '../utils/leaderboardEdit';
import { buildRaceOperations } from '../utils/leaderboardSave';
import { buildStandings } from '../utils/leaderboardStandings';
import type { LeaderboardEditSession } from './useLeaderboardEditSession';
import { cloneEntries } from '../utils/leaderboardUtils';
import type { LeaderboardEntry } from '../types';

interface EditInputs {
  eventId: number;
  finalSeriesStarted: boolean;
  /** The saved rows being shown (final fleets, or qualifying before that). */
  leaderboard: LeaderboardEntry[];
  eventLeaderboard: LeaderboardEntry[];
  /** Largest heat of the series being edited (SHRS 5.2). */
  maxHeatSize: number;
  resetCompare: () => void;
}

/**
 * Editing the leaderboard: cell edits (places, status codes, RDG1/RDG2/RDG3,
 * DPI), the RDG2 race picker, Save, and detecting unsaved changes. The draft
 * re-ranks the edited race with regatta-core (utils/leaderboardEdit); totals,
 * discards and redress averages are the library's, from the preview. The
 * state is in useLeaderboardEditSession.
 *
 * The saved standings come from the query cache, which reads them again after
 * any write to the event. While editing, a change of them that is not our own
 * Save (an undo or a go-back in the history) leaves the draft as it is and
 * marks it stale: Save is refused until the edit is started again.
 */
export default function useLeaderboardEdit(
  session: LeaderboardEditSession,
  {
    eventId,
    finalSeriesStarted,
    leaderboard,
    eventLeaderboard,
    maxHeatSize,
    resetCompare,
  }: EditInputs,
) {
  const {
    editMode,
    editModeRef,
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

  // Save: the event is read again before it resolves (api/writes.ts).
  const saveResults = useWrite(
    (...args: Parameters<typeof heatRaceDB.saveLeaderboardRaceResultsAtomic>) =>
      heatRaceDB.saveLeaderboardRaceResultsAtomic(...args),
    (_result, [id]) => ({ eventId: id }),
  );

  // The library's preview of the draft: a write the main process rolls back,
  // so it changes nothing and invalidates nothing. Only the answer to the
  // LATEST edit is applied (TanStack Query calls a mutate's own callbacks for
  // the newest call only), and `resetPreview` drops the one on its way
  // (leaving edit mode, Save, the results changing underneath).
  const { mutate: requestPreview, reset: resetPreview } = useMutation({
    mutationFn: (operations: ReturnType<typeof buildRaceOperations>) =>
      heatRaceDB.previewLeaderboardEdit(eventId, operations),
    // Each answer holds the three standings: none is kept once superseded.
    gcTime: 0,
  });

  // The saved results changed while editing, and not by our own Save: the
  // draft is left as the user made it, but Save is refused (it would put the
  // old results back over the new ones) until the edit is started again.
  const lastSavedRowsRef = useRef(savedRows);
  useEffect(() => {
    if (lastSavedRowsRef.current === savedRows) return;
    lastSavedRowsRef.current = savedRows;
    if (!editModeRef.current || savingRef.current) return;
    if (editIsStaleRef.current) return;
    editIsStaleRef.current = true;
    resetPreview();
    reportWarning(
      'The results were changed in the history while you were editing. Press Cancel Editing to see them, then edit again.',
      'Results changed',
    );
  }, [savedRows, editModeRef, editIsStaleRef, resetPreview]);

  /**
   * Show what Save would store. The rows just edited (the race re-ranked
   * here at once) are sent as Save sends them; the main process saves them,
   * reads the standings back and rolls back (previewLeaderboardEdit), and
   * those rows replace the draft. Totals, discards, redress averages and
   * places on screen are regatta-core's; nothing here works them out.
   * Without an answer the draft keeps the re-ranked race and the totals
   * from before the edit; Save is the check either way.
   */
  const previewWithLibrary = (rows: LeaderboardEntry[]) => {
    if (editIsStaleRef.current) return;
    let operations: ReturnType<typeof buildRaceOperations>;
    try {
      operations = buildRaceOperations(rows, savedRows, userEditsRef.current);
    } catch {
      return;
    }
    requestPreview(operations, {
      onSuccess: (preview) => {
        if (!preview || !editModeRef.current) return;
        if (editIsStaleRef.current || savingRef.current) return;
        if (!preview.ok) {
          reportWarning(preview.reason, 'This change cannot be saved');
          return;
        }
        const { leaderboard: shown } = buildStandings({
          eventResults: preview.eventResults,
          finalResults: preview.finalResults,
          overallResults: preview.overallResults,
          finalSeriesStarted,
        });
        const byBoat = new Map(shown.map((row) => [row.boat_id, row]));
        setEditableLeaderboard((current) =>
          current.map((row) => byBoat.get(row.boat_id) ?? row),
        );
      },
      // No preview: the draft stays as re-ranked here.
    });
  };

  const toggleEditMode = async () => {
    if (editMode && hasUnsavedChanges) {
      const shouldDiscard = await confirmAction(
        'You have unsaved leaderboard changes. Cancel editing and discard them?',
        'Discard changes',
        { confirmLabel: 'Discard', confirmClassName: 'btn-danger' },
      );
      if (!shouldDiscard) return;
    }

    // Late preview answers are for the edit being left (or not started).
    resetPreview();
    session.showRows(savedRows);
    // Leaving a stale edit: the saved standings (read again already) show.
    if (editMode) editIsStaleRef.current = false;
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

    const maxBoats = largestHeatFor(maxHeatSize, cloned.length);
    const resolved = resolveEditedCell(
      targetEntry,
      raceIndex,
      newRaceValue,
      newStatus,
    );
    if (!resolved) return;
    if (newStatus === 'RDG1' || newStatus === 'RDG3') {
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: newStatus },
      }));
    }

    // What the correction does to the race (RRS A6.1, the move of a new
    // place, A6.2, A7) is regatta-core's (see applyRaceEdit).
    const group = findRaceGroup(cloned, boatId, raceIndex);
    const cell = clampFinishingPlace(resolved, newStatus, group.length || 1);

    // Remember the raw user edit for the save payload.
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: cell.position,
      status: newStatus,
    });

    const updated = applyRaceEdit(cloned, group, {
      boatId,
      raceIndex,
      position: cell.position,
      points: cell.points,
      status: newStatus,
      maxBoats,
    });
    setEditableLeaderboard(updated);
    previewWithLibrary(updated);
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

    // RRS A9(b): the average of her points in the chosen races is
    // regatta-core's, worked out from the races sent with the cell (SHRS
    // 5.6: the races of the edited cell's own series, the rows on screen).
    // Until the library's preview shows it, the cell keeps her current
    // points there, a value Save accepts.
    const seriesIndices = [...(selectedIndices || new Set<number>())];
    const resolved = resolveEditedCell(entry, raceIndex, null, 'RDG2');
    if (!resolved) {
      setRdg2Picker(null);
      return;
    }
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: resolved.position,
      status: 'RDG2',
      rdgSelection: { seriesIndices },
    });

    // RRS A6.2: redress moves no other boat; she keeps her place.
    const updated = applyRaceEdit(
      cloned,
      findRaceGroup(cloned, boatId, raceIndex),
      {
        boatId,
        raceIndex,
        position: resolved.position,
        points: resolved.points,
        status: 'RDG2',
        maxBoats: largestHeatFor(maxHeatSize, cloned.length),
      },
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
    setEditableLeaderboard(updated);
    setRdg2Picker(null);
    previewWithLibrary(updated);
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
    resetPreview();
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
        // Resolves once the standings are read again (a read that fails is
        // reported by the standings themselves; the save has persisted).
        await saveResults(eventId, updateOperations, finalSeriesStarted);

        // LB-5: the save has persisted, so the queued edits are done with
        // whatever the read after it gave: a retry must never re-send stale
        // pre-save edits on top of the already-persisted data. Leaving edit
        // mode shows the saved standings.
        clearEdits();
        setEditMode(false);
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
