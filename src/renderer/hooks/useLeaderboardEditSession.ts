import { useCallback, useRef, useState } from 'react';
import { cloneEntries } from '../utils/leaderboardUtils';
import type { UserRaceEdit } from '../utils/leaderboardEdit';
import type { LeaderboardEntry, RdgMetaEntry, Rdg2PickerState } from '../types';

/**
 * The state of one leaderboard edit session: whether editing is on, the draft
 * rows, the cells the user touched, the RDG metadata and picker. It holds state
 * only; the actions that change it live in useLeaderboardEdit. The draft is
 * what the page shows while editing; outside edit mode it shows the saved
 * standings themselves (useLeaderboard).
 */
export default function useLeaderboardEditSession() {
  const [editMode, setEditModeState] = useState(false);
  // The same, readable at once in a callback or an effect (an answer that
  // arrives after editing ended must see it ended, whatever React rendered).
  const editModeRef = useRef(false);
  const setEditMode = useCallback((on: boolean) => {
    editModeRef.current = on;
    setEditModeState(on);
  }, []);
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
  // Set when the saved results changed behind the page while editing (an undo
  // or a go-back in the history, read again by the query cache): the draft
  // shows results that are no longer there, so Save is refused until the edit
  // is started again. The draft itself is never replaced underneath the user.
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

  /** Start the draft from the saved rows. */
  const showRows = useCallback((rows: LeaderboardEntry[]) => {
    setEditableLeaderboard(cloneEntries(rows));
  }, []);

  return {
    editMode,
    editModeRef,
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
    showRows,
  };
}

export type LeaderboardEditSession = ReturnType<
  typeof useLeaderboardEditSession
>;
