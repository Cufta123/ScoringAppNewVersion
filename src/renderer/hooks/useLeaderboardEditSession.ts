import { useCallback, useRef, useState } from 'react';
import { cloneEntries } from '../utils/leaderboardUtils';
import type { UserRaceEdit } from '../utils/leaderboardEdit';
import type { LeaderboardEntry, RdgMetaEntry, Rdg2PickerState } from '../types';

/**
 * The state of one leaderboard edit session: whether editing is on, the draft
 * rows, the cells the user touched, the RDG metadata and picker. It holds state
 * only; the actions that change it live in useLeaderboardEdit, and the loader
 * (useLeaderboardStandings) resets it through `endEdits` / `showRows`.
 */
export default function useLeaderboardEditSession() {
  const [editMode, setEditMode] = useState(false);
  const [editableLeaderboard, setEditableLeaderboard] = useState<
    LeaderboardEntry[]
  >([]);
  // Cells the user explicitly edited this session, keyed `${boatId}-${raceIndex}`
  // → the RAW position + status the user chose (before column re-ranking).
  // `rdgSelection` keeps the RDG2 race choice so the average can be refreshed
  // when later edits change the boat's points in the selected races.
  const userEditsRef = useRef<Map<string, UserRaceEdit>>(new Map());
  // rdgMeta stores per-cell info: { type, selectedRaceLabels? }
  // key is `${boatId}-${raceIndex}`
  const [rdgMeta, setRdgMeta] = useState<Record<string, RdgMetaEntry>>({});
  // rdg2Picker: the open multi-race selector state for one specific cell
  const [rdg2Picker, setRdg2Picker] = useState<Rdg2PickerState | null>(null);
  // Set when the results changed behind the page while editing (an undo or a
  // go-back in the history): the draft shows results that are no longer there,
  // so Save is refused until the edit is started again.
  const editIsStaleRef = useRef(false);
  // Cells holding typed input that cannot be saved (a place outside 1..boats
  // in the race, points of 0 …), keyed `${boatId}-${raceIndex}` → a sentence
  // naming the sail and race. Save refuses while any is listed.
  const [invalidCells, setInvalidCells] = useState<Record<string, string>>({});
  const reportInvalidCell = useCallback(
    (key: string, message: string | null) =>
      setInvalidCells((prev) => {
        if (message == null) {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (prev[key] === message) return prev;
        return { ...prev, [key]: message };
      }),
    [],
  );

  /** Forget every queued edit, RDG note and open picker (editing stays as is). */
  const clearEdits = useCallback(() => {
    userEditsRef.current.clear();
    setRdgMeta({});
    setRdg2Picker(null);
  }, []);

  /** A (re)load replaces the source of truth: drop the edits, leave edit mode. */
  const endEdits = useCallback(() => {
    clearEdits();
    setEditMode(false);
  }, [clearEdits]);

  /** Start the draft from freshly loaded or saved rows. */
  const showRows = useCallback((rows: LeaderboardEntry[]) => {
    setEditableLeaderboard(cloneEntries(rows));
  }, []);

  return {
    editMode,
    setEditMode,
    editableLeaderboard,
    setEditableLeaderboard,
    userEditsRef,
    rdgMeta,
    setRdgMeta,
    rdg2Picker,
    setRdg2Picker,
    editIsStaleRef,
    invalidCells,
    reportInvalidCell,
    clearEdits,
    endEdits,
    showRows,
  };
}

export type LeaderboardEditSession = ReturnType<
  typeof useLeaderboardEditSession
>;
