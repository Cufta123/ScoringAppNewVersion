/**
 * Turns change-journal rows into sentences a race officer can read
 * ("CRO 12, Heat A1 race 1: 4 → DNF (16 points)"). Pure, so a future viewer
 * can show the same history.
 */

export type JournalRow = Record<string, unknown>;

export interface HistoryChange {
  change_id: number;
  table_name: string;
  op: 'insert' | 'update' | 'delete';
  row_key: string;
  old_row: JournalRow | null;
  new_row: JournalRow | null;
  /** Labels as they were when the change was made (sail, heat, race). */
  context: Record<string, unknown>;
}

export interface HistoryAction {
  /** null for changes made outside a user action. */
  action_id: number | null;
  channel: string | null;
  /** ISO time (UTC) the action finished. */
  at: string;
  changes: HistoryChange[];
  /** Set when this action undid an earlier one from the history. */
  reverts_action_id?: number | null;
  /** What the undone action was. */
  reverts_channel?: string | null;
  /** Set when this action took the event back to right after another one. */
  restores_to_action_id?: number | null;
}

/** What a user action was, by the IPC channel that made it. */
const ACTION_LABELS: Record<string, string> = {
  insertEvent: 'Event created',
  updateEvent: 'Event settings changed',
  associateBoatWithEvent: 'Boat entered',
  removeBoatFromEvent: 'Boat removed from the event',
  createInitialHeatsAtomic: 'Heats created',
  recreateInitialHeatsAtomic: 'Heats recreated',
  insertHeat: 'Heat added',
  insertHeatBoat: 'Boat added to a heat',
  deleteHeatsByEvent: 'Heats deleted',
  insertRace: 'Race added',
  submitHeatRaceScoresAtomic: 'Race scored',
  insertScore: 'Score added',
  updateScore: 'Score changed',
  updateRaceResult: 'Result changed',
  saveLeaderboardRaceResultsAtomic: 'Results edited on the leaderboard',
  transferBoatBetweenHeats: 'Boat moved to another heat',
  startFinalSeriesAtomic: 'Final series started',
  deleteScore: 'Score deleted',
  createNewHeatsBasedOnLeaderboard: 'Next round heats created',
  undoLastScoredRaceForHeat: 'Last race of a heat undone',
  undoLastScoredRace: 'Last race undone',
  undoLatestHeatRedistribution: 'Heat assignment undone',
  readLeaderboard: 'Missed races scored automatically',
  readFinalLeaderboard: 'Missed races scored automatically',
  updateEventLeaderboard: 'Standings recalculated',
  updateFinalLeaderboard: 'Standings recalculated',
  restoreEventSnapshotFromFile: 'Event restored from a backup file',
  revertHistoryAction: 'Undone from the history',
  restoreEventToHistoryPoint: 'Went back to an earlier point',
};

/** Rows kept for exact undo but not worth a line in the history. */
const HIDDEN_TABLES = ['RaceAssignmentSnapshots'];

export function actionLabel(channel: string | null): string {
  if (channel == null) return 'Automatic change';
  return ACTION_LABELS[channel] ?? channel;
}

const SCORED_PENALTIES = ['ZFP', 'SCP', 'T1'];

const plural = (n: unknown) => (Number(n) === 1 ? 'point' : 'points');

/** "4", "4 ZFP" or "DNF", then the points: "4 ZFP (5.2 points)". */
function resultOf(row: JournalRow): string {
  const status = String(row.status ?? 'FINISHED');
  const { position, points } = row;
  let result = status;
  if (status === 'FINISHED') result = String(position);
  else if (SCORED_PENALTIES.includes(status)) result = `${position} ${status}`;
  return `${result} (${points} ${plural(points)})`;
}

const raceLabel = (context: Record<string, unknown>) => {
  const heat = context.heat_name ?? 'a heat that no longer exists';
  return context.race_number != null
    ? `${heat} race ${context.race_number}`
    : String(heat);
};

const sail = (context: Record<string, unknown>, row: JournalRow | null) =>
  String(context.sail ?? `boat ${row?.boat_id ?? '?'}`);

/** Event settings shown by name; anything else by its column name. */
const EVENT_FIELDS: Record<string, string> = {
  event_name: 'Name',
  event_location: 'Location',
  start_date: 'Start date',
  end_date: 'End date',
  shrs_version: 'SHRS version',
  shrs_qualifying_assignment_mode: 'Qualifying heat assignment',
  shrs_discard_profile_qualifying: 'Discards (qualifying)',
  shrs_discard_profile_final: 'Discards (final)',
  shrs_discard_locked_qualifying: 'Qualifying discards locked',
  shrs_discard_locked_final: 'Final discards locked',
  shrs_heat_overflow_policy: 'Heat size overflow',
};

function changedFields(change: HistoryChange): string[] {
  const before = change.old_row ?? {};
  const after = change.new_row ?? {};
  return Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

/** One sentence for one journal row. */
export function describeChange(change: HistoryChange): string {
  const { op, context } = change;
  const row = change.new_row ?? change.old_row ?? {};

  switch (change.table_name) {
    case 'Scores': {
      const where = `${sail(context, row)}, ${raceLabel(context)}`;
      if (op === 'insert') return `${where}: ${resultOf(row)}`;
      if (op === 'delete')
        return `${where}: score removed (was ${resultOf(row)})`;
      return `${where}: ${resultOf(change.old_row ?? {})} → ${resultOf(
        change.new_row ?? {},
      )}`;
    }
    case 'Races': {
      const label = `${context.heat_name ?? 'Heat'} race ${row.race_number}`;
      if (op === 'insert') return `${label} added`;
      if (op === 'delete') return `${label} removed`;
      return `${label} changed`;
    }
    case 'Heats': {
      const label = `${row.heat_name} (${row.heat_type})`;
      if (op === 'insert') return `${label} created`;
      if (op === 'delete') return `${label} deleted`;
      return `${change.old_row?.heat_name} renamed to ${change.new_row?.heat_name}`;
    }
    case 'Heat_Boat': {
      const heat = context.heat_name ?? 'a heat';
      return op === 'delete'
        ? `${sail(context, row)} taken out of ${heat}`
        : `${sail(context, row)} put in ${heat}`;
    }
    case 'Boat_Event':
      return op === 'delete'
        ? `${sail(context, row)} removed from the entry list`
        : `${sail(context, row)} entered`;
    case 'Events': {
      if (op === 'insert') return `Event "${row.event_name}" created`;
      const show = (key: string, value: unknown) => {
        if (key.startsWith('shrs_discard_locked_'))
          return Number(value) ? 'yes' : 'no';
        return String(value);
      };
      const fields = changedFields(change).map(
        (key) =>
          `${EVENT_FIELDS[key] ?? key}: ${show(
            key,
            change.old_row?.[key],
          )} → ${show(key, change.new_row?.[key])}`,
      );
      return fields.length > 0 ? fields.join('; ') : 'Event changed';
    }
    default:
      return `${change.table_name} ${op} (${change.row_key})`;
  }
}

const sameRow = (a: JournalRow | null, b: JournalRow | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The net effect of an action on each row: a row written several times in one
 * action (scoring a race first enters every boat as DNS, then her finish)
 * shows once, from how it was before the action to how it was after. A row
 * the action created and removed again, or changed and changed back, is left
 * out. Rows keep the order in which the action first touched them.
 */
export function netChanges(changes: HistoryChange[]): HistoryChange[] {
  const byRow = new Map<string, HistoryChange>();
  changes.forEach((change) => {
    const id = `${change.table_name}:${change.row_key}`;
    const seen = byRow.get(id);
    if (!seen) {
      byRow.set(id, { ...change });
      return;
    }
    seen.new_row = change.new_row;
    seen.context = { ...seen.context, ...change.context };
    if (seen.old_row == null && seen.new_row == null) {
      byRow.delete(id);
    } else if (seen.old_row == null) {
      seen.op = 'insert';
    } else {
      seen.op = seen.new_row == null ? 'delete' : 'update';
    }
  });
  return [...byRow.values()].filter(
    (change) =>
      change.op !== 'update' || !sameRow(change.old_row, change.new_row),
  );
}

/** An action as a title and one sentence per row it changed. */
export function summarizeAction(action: HistoryAction): {
  label: string;
  lines: string[];
} {
  const label =
    action.reverts_action_id != null
      ? `Undid “${actionLabel(action.reverts_channel ?? null)}”`
      : actionLabel(action.channel);
  return {
    label,
    lines: netChanges(action.changes)
      .filter((change) => !HIDDEN_TABLES.includes(change.table_name))
      .map(describeChange),
  };
}
