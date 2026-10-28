import { db } from '../../../public/Database/DBManager';
import type {
  HistoryAction,
  HistoryChange,
} from '../../shared/history/describe';

// The change journal's rows are written by SQLite triggers
// (public/Database/journal.js). This module groups the rows one user action
// wrote under a ChangeActions row, and reads an event's history back.

/** The newest journal row so far; changes after it belong to the next action. */
export function lastChangeId(): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(change_id), 0) AS id FROM ChangeLog')
    .get() as { id: number };
  return Number(row.id);
}

/**
 * Put every journal row written since `afterChangeId` that no action has
 * claimed yet under one new action named after the IPC channel. Returns the
 * action id, or null when the call changed nothing.
 */
export function tagChanges(afterChangeId: number, channel: string) {
  return db.transaction(() => {
    const pending = db
      .prepare(
        'SELECT COUNT(*) AS n FROM ChangeLog WHERE change_id > ? AND action_id IS NULL',
      )
      .get(afterChangeId) as { n: number };
    if (Number(pending.n) === 0) return null;
    const actionId = Number(
      db.prepare('INSERT INTO ChangeActions (channel) VALUES (?)').run(channel)
        .lastInsertRowid,
    );
    db.prepare(
      'UPDATE ChangeLog SET action_id = ? WHERE change_id > ? AND action_id IS NULL',
    ).run(actionId, afterChangeId);
    return actionId;
  })();
}

/**
 * Hooks for the IPC wrapper (handle.ts): note where the journal stood before a
 * call, and group what the call wrote once it is done. A call whose handler
 * waits on something (a file dialog) only claims rows nobody else claimed, so
 * an action that finishes in between keeps its own rows.
 */
export const journalObserver = {
  before: () => lastChangeId(),
  after: (mark: number, channel: string) => {
    tagChanges(mark, channel);
  },
};

const parse = (json: string | null) => (json == null ? null : JSON.parse(json));

const toChange = (row: any): HistoryChange => ({
  change_id: row.change_id,
  table_name: row.table_name,
  op: row.op,
  row_key: row.row_key,
  old_row: parse(row.old_row),
  new_row: parse(row.new_row),
  context: parse(row.context) ?? {},
});

/** One action with every row it wrote (in any event), oldest first. */
export function readAction(
  action_id: number,
): (HistoryAction & { eventIds: number[] }) | null {
  const action = db
    .prepare(
      'SELECT action_id, channel, at FROM ChangeActions WHERE action_id = ?',
    )
    .get(action_id) as
    | { action_id: number; channel: string; at: string }
    | undefined;
  if (!action) return null;
  const rows = db
    .prepare('SELECT * FROM ChangeLog WHERE action_id = ? ORDER BY change_id')
    .all(action_id) as any[];
  return {
    ...action,
    changes: rows.map(toChange),
    eventIds: [...new Set(rows.map((row) => Number(row.event_id)))],
  };
}

/** The first action after `afterChangeId` that wrote the given row. */
export function laterActionOn(
  table: string,
  rowKey: string,
  afterChangeId: number,
): { channel: string | null; at: string } | null {
  const row = db
    .prepare(
      `SELECT a.channel, c.at FROM ChangeLog c
       LEFT JOIN ChangeActions a ON a.action_id = c.action_id
       WHERE c.table_name = ? AND c.row_key = ? AND c.change_id > ?
       ORDER BY c.change_id LIMIT 1`,
    )
    .get(table, rowKey, afterChangeId) as
    | { channel: string | null; at: string }
    | undefined;
  return row ?? null;
}

/**
 * An event's history, newest action first. Rows no action claimed (written
 * outside an IPC call) are grouped by consecutive runs as `channel: null`.
 */
export function readEventHistory(event_id: number): HistoryAction[] {
  const rows = db
    .prepare(
      `SELECT c.change_id, c.action_id, c.at, c.table_name, c.op, c.row_key,
              c.old_row, c.new_row, c.context, a.channel, a.at AS action_at,
              a.reverts_action_id, ra.channel AS reverts_channel,
              a.restores_to_action_id
       FROM ChangeLog c
       LEFT JOIN ChangeActions a ON a.action_id = c.action_id
       LEFT JOIN ChangeActions ra ON ra.action_id = a.reverts_action_id
       WHERE c.event_id = ?
       ORDER BY c.change_id DESC`,
    )
    .all(event_id) as any[];

  const actions: HistoryAction[] = [];
  rows.forEach((row) => {
    const change = toChange(row);
    const last = actions[actions.length - 1];
    if (last && last.action_id === row.action_id) {
      last.changes.push(change);
      return;
    }
    actions.push({
      action_id: row.action_id,
      channel: row.channel ?? null,
      at: row.action_at ?? row.at,
      changes: [change],
      reverts_action_id: row.reverts_action_id ?? null,
      reverts_channel: row.reverts_channel ?? null,
      restores_to_action_id: row.restores_to_action_id ?? null,
    });
  });
  // Inside an action, show the changes in the order they were made.
  actions.forEach((action) => action.changes.reverse());
  return actions;
}
