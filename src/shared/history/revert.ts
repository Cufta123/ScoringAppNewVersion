/**
 * Undoing one action from the event history. Pure: decides whether an action
 * can be undone and which row writes put back the state from before it.
 *
 * Only RESULT changes can be undone here (scores, protest decisions, redress,
 * a score added or removed by hand), because nothing else is built on a single
 * result: SHRS 3.1.5 keeps heat assignments as they were when a protest
 * decision changes a result later. Scoring a whole race, creating heats or
 * changing the entry list feed the heats that follow, so those are undone with
 * the scoring page's own Undo buttons, which check that nothing depends on
 * them.
 */
import {
  HistoryAction,
  HistoryChange,
  JournalRow,
  netChanges,
} from './describe';
import { deriveNonFinisherPoints } from '../scoring/statusPoints';

/** The tables an undo may write, with the columns that identify a row. */
export const REVERTABLE_TABLES: Record<string, string[]> = {
  Scores: ['score_id'],
  RaceAssignmentSnapshots: ['race_id', 'rank'],
};

/**
 * Event columns a result change may flip as a side effect. They only ever go
 * from unlocked to locked once a race is scored, and an undo leaves them as
 * they are.
 */
const ONE_WAY_EVENT_FIELDS = [
  'shrs_discard_locked_qualifying',
  'shrs_discard_locked_final',
];

/** The user actions that change results, and only results. */
const RESULT_CHANNELS = [
  'updateRaceResult',
  'saveLeaderboardRaceResultsAtomic',
  'updateScore',
  'insertScore',
  'deleteScore',
  'revertHistoryAction',
];

const SCORING_PAGE_REASON =
  'Scoring a race, heats and the entry list are undone on the scoring page (Undo last race), which checks that later heats do not depend on them.';

/** Actions the app takes by itself, which it would simply take again. */
const AUTOMATIC_CHANNELS = [
  'readLeaderboard',
  'readFinalLeaderboard',
  'updateEventLeaderboard',
  'updateFinalLeaderboard',
];

const onlyOneWayEventFields = (change: HistoryChange) => {
  if (change.table_name !== 'Events' || change.op !== 'update') return false;
  const before = change.old_row ?? {};
  const after = change.new_row ?? {};
  return Object.keys(after).every(
    (key) =>
      ONE_WAY_EVENT_FIELDS.includes(key) ||
      JSON.stringify(before[key]) === JSON.stringify(after[key]),
  );
};

/**
 * Score columns the standings rebuild re-derives from the rules, so they say
 * nothing about what a person entered: RDG1/RDG2 averages (RRS A9, recomputed
 * as the series grows) and the points of a non-finisher or scoring penalty
 * (SHRS 5.2 / RRS 44.3(c), recomputed when the largest heat changes). An undo
 * neither checks nor restores them; the rebuild after the undo sets them.
 */
export function derivedScoreColumns(row: JournalRow | null): string[] {
  const status = String(row?.status ?? '');
  if (status === 'RDG1') return ['position', 'points'];
  if (status === 'RDG2' && row?.rdg_race_ids != null) {
    return ['position', 'points'];
  }
  if (deriveNonFinisherPoints(status, 1, 2) != null) return ['points'];
  return [];
}

const differingColumns = (a: JournalRow, b: JournalRow) =>
  Object.keys(b).filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );

/** A score update that only moved derived points: the rebuild's own work. */
const onlyDerivedScoreColumns = (change: HistoryChange) => {
  if (change.table_name !== 'Scores' || change.op !== 'update') return false;
  const before = change.old_row ?? {};
  const after = change.new_row ?? {};
  if (before.status !== after.status) return false;
  const derived = derivedScoreColumns(after);
  return differingColumns(before, after).every((key) => derived.includes(key));
};

/**
 * The changes an undo reverses: side-effect lock flags and the standings
 * rebuild's own point updates are left out.
 */
export function changesToRevert(action: HistoryAction): HistoryChange[] {
  return netChanges(action.changes).filter(
    (change) =>
      !onlyOneWayEventFields(change) && !onlyDerivedScoreColumns(change),
  );
}

/** Why this action cannot be undone from the history, or null if it can. */
export function whyNotRevertable(action: HistoryAction): string | null {
  if (action.channel == null || AUTOMATIC_CHANNELS.includes(action.channel)) {
    return 'The app made this change by itself and would make it again.';
  }
  if (action.channel === 'updateEvent') {
    return 'Event settings are changed in the event settings.';
  }
  if (!RESULT_CHANNELS.includes(action.channel)) return SCORING_PAGE_REASON;
  const changes = changesToRevert(action);
  if (changes.length === 0) return 'This action left nothing to undo.';
  // A result change only ever writes these tables; anything else means the
  // action did more than change results, and is not undone from here.
  const other = changes.find(
    (change) => !(change.table_name in REVERTABLE_TABLES),
  );
  return other ? SCORING_PAGE_REASON : null;
}

export interface RevertStep {
  table: string;
  /** The write that puts the row back. */
  op: 'insert' | 'update' | 'delete';
  key: Record<string, unknown>;
  /** The row as it was before the action (insert/update). */
  row: JournalRow | null;
  /** The row as the action left it: what must still be there (update/delete). */
  expected: JournalRow | null;
  change: HistoryChange;
}

const keyOf = (table: string, row: JournalRow) =>
  Object.fromEntries(REVERTABLE_TABLES[table].map((c) => [c, row[c]]));

/** The writes that undo `action`, last change first. */
export function revertSteps(action: HistoryAction): RevertStep[] {
  return changesToRevert(action)
    .slice()
    .reverse()
    .map((change) => {
      const table = change.table_name;
      const row = (change.new_row ?? change.old_row) as JournalRow;
      let op: RevertStep['op'] = 'update';
      if (change.op === 'insert') op = 'delete';
      else if (change.op === 'delete') op = 'insert';
      return {
        table,
        op,
        key: keyOf(table, row),
        row: change.old_row,
        expected: change.new_row,
        change,
      };
    });
}

const normalize = (value: unknown) => (value === undefined ? null : value);

/**
 * True when the row is still as the action left it, so undoing it cannot
 * overwrite a later change. `current` is the row now (null if absent).
 */
export function isUntouchedSince(
  step: RevertStep,
  current: JournalRow | null,
): boolean {
  if (step.expected == null) return current == null;
  if (current == null) return false;
  const { expected } = step;
  const ignored =
    step.table === 'Scores' && current.status === expected.status
      ? derivedScoreColumns(expected)
      : [];
  return Object.keys(expected).every(
    (column) =>
      ignored.includes(column) ||
      normalize(current[column]) === normalize(expected[column]),
  );
}

/**
 * Whether each action has been undone: an action is undone when an undo of it
 * is in the history and that undo has not itself been undone.
 */
export function undoneActionIds(
  actions: { action_id: number | null; reverts_action_id?: number | null }[],
): Set<number> {
  const revertsOf = new Map<number, number[]>();
  actions.forEach((action) => {
    if (action.reverts_action_id != null && action.action_id != null) {
      const list = revertsOf.get(action.reverts_action_id) ?? [];
      list.push(action.action_id);
      revertsOf.set(action.reverts_action_id, list);
    }
  });
  const memo = new Map<number, boolean>();
  const isUndone = (id: number): boolean => {
    if (memo.has(id)) return memo.get(id) as boolean;
    memo.set(id, false); // guards a cycle, which the data cannot hold
    const undone = (revertsOf.get(id) ?? []).some(
      (revert) => !isUndone(revert),
    );
    memo.set(id, undone);
    return undone;
  };
  const result = new Set<number>();
  actions.forEach((action) => {
    if (action.action_id != null && isUndone(action.action_id)) {
      result.add(action.action_id);
    }
  });
  return result;
}
