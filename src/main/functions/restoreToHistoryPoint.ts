import * as DBManager from '../../../public/Database/DBManager';
import { lastChangeId, tagChanges } from './changeJournal';
import refreshStandings from './standings';
import { invalidateAssignmentSnapshotCache } from './raceAssignmentSnapshot';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  backupDirFor,
  writeBackup,
} = require('../../../public/Database/backup');

const { db } = DBManager;

/**
 * The columns that identify a row of each journalled table (journal.js keys
 * its rows the same way). A table outside this list is never written here.
 */
const KEY_COLUMNS: Record<string, string[]> = {
  Events: ['event_id'],
  Boat_Event: ['boat_event_id'],
  Heats: ['heat_id'],
  Heat_Boat: ['heat_id', 'boat_id'],
  Races: ['race_id'],
  RaceAssignmentSnapshots: ['race_id', 'rank'],
  Scores: ['score_id'],
};

type Row = Record<string, unknown>;

interface JournalRow {
  change_id: number;
  table_name: string;
  op: 'insert' | 'update' | 'delete';
  old_row: string | null;
  new_row: string | null;
}

const columnsCache = new Map<string, Set<string>>();
const columnsOf = (table: string): Set<string> => {
  if (!columnsCache.has(table)) {
    columnsCache.set(
      table,
      new Set(
        (
          db.prepare(`PRAGMA table_info('${table}')`).all() as {
            name: string;
          }[]
        ).map((c) => c.name),
      ),
    );
  }
  return columnsCache.get(table) as Set<string>;
};

/** Only the table's own column names ever reach the SQL text. */
const known = (table: string, names: string[]) => {
  const columns = columnsOf(table);
  return names.filter((name) => columns.has(name));
};

const same = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) ||
  (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

/** The row as it is now, or null. */
function current(table: string, key: Row): Row | null {
  const keys = KEY_COLUMNS[table];
  return (
    (db
      .prepare(
        `SELECT * FROM ${table} WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}`,
      )
      .get(...keys.map((k) => key[k] as any)) as Row | undefined) ?? null
  );
}

class HistoryMismatch extends Error {}

/** Put back the row as it was before one journalled change. */
function invert(change: JournalRow) {
  const table = change.table_name;
  const keys = KEY_COLUMNS[table];
  if (!keys) {
    throw new HistoryMismatch(`unknown table ${table} in the history`);
  }
  const before = change.old_row ? (JSON.parse(change.old_row) as Row) : null;
  const after = change.new_row ? (JSON.parse(change.new_row) as Row) : null;
  const key = (after ?? before) as Row;
  const now = current(table, key);

  // The row must be exactly as this change left it; otherwise something
  // outside this event's history changed it, and going back would be a
  // guess. Refuse instead (the whole step is rolled back).
  if (after == null) {
    if (now != null) throw new HistoryMismatch(`${table} row came back`);
  } else if (
    now == null ||
    Object.keys(after).some(
      (column) =>
        columnsOf(table).has(column) && !same(now[column], after[column]),
    )
  ) {
    throw new HistoryMismatch(`${table} row was changed outside the history`);
  }

  const where = keys.map((k) => `${k} = ?`).join(' AND ');
  const keyValues = keys.map((k) => key[k] as any);
  if (change.op === 'insert') {
    db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...keyValues);
  } else if (change.op === 'delete') {
    const columns = known(table, Object.keys(before as Row));
    db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
        .map(() => '?')
        .join(', ')})`,
    ).run(...columns.map((c) => (before as Row)[c] as any));
  } else {
    const columns = known(table, Object.keys(before as Row));
    db.prepare(
      `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE ${where}`,
    ).run(...columns.map((c) => (before as Row)[c] as any), ...keyValues);
  }
}

/** A copy of the whole database first, kept with the backups (never pruned). */
function backupFirst() {
  const { dbPath } = DBManager as { dbPath?: string };
  if (!dbPath) return null; // tests run on an in-memory database
  return writeBackup(db, backupDirFor(dbPath), 'before-going-back');
}

/**
 * Take an event back to exactly how it was right after one action of its
 * history: every change recorded after that action is put back, newest first,
 * in one transaction — all of it, or nothing. Results, heats, entries, rounds,
 * the final series and the event settings all go back.
 *
 * Safe by construction: each row must be exactly as the change being put back
 * left it, or nothing is changed. A copy of the database is saved first. The
 * step is itself recorded in the history (restores_to_action_id), so going
 * back can be reversed by going back to the entry just before it.
 *
 * Not in the history, so not taken back: sailor and boat details, which apply
 * to every event by design.
 */
export default function restoreToHistoryPoint(
  event_id: number,
  action_id: number,
) {
  const target = db
    .prepare(
      `SELECT MAX(change_id) AS last, COUNT(*) AS n FROM ChangeLog
       WHERE action_id = ? AND event_id = ?`,
    )
    .get(action_id, event_id) as { last: number | null; n: number };
  if (!target || Number(target.n) === 0 || target.last == null) {
    throw new Error('This point is no longer in the history of this event.');
  }
  const later = db
    .prepare(
      `SELECT change_id, table_name, op, old_row, new_row FROM ChangeLog
       WHERE event_id = ? AND change_id > ? ORDER BY change_id DESC`,
    )
    .all(event_id, target.last) as JournalRow[];
  if (later.length === 0) {
    throw new Error('Nothing was changed after this point.');
  }
  const laterActions = db
    .prepare(
      `SELECT COUNT(DISTINCT action_id) AS n FROM ChangeLog
       WHERE event_id = ? AND change_id > ? AND action_id IS NOT NULL`,
    )
    .get(event_id, target.last) as { n: number };

  try {
    backupFirst();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Backup before going back failed:', error);
    throw new Error(
      'Could not save a backup first, so nothing was changed. Check that the disk is not full.',
    );
  }

  const mark = lastChangeId();
  try {
    return db.transaction(() => {
      later.forEach(invert);
      // The standings are a cache of the results: rebuild them from what is
      // there now (no final standings if the final series is gone).
      db.prepare('DELETE FROM Leaderboard WHERE event_id = ?').run(event_id);
      db.prepare('DELETE FROM FinalLeaderboard WHERE event_id = ?').run(
        event_id,
      );
      refreshStandings(event_id);

      const restoreId = tagChanges(mark, 'restoreEventToHistoryPoint');
      if (restoreId != null) {
        db.prepare(
          'UPDATE ChangeActions SET restores_to_action_id = ? WHERE action_id = ?',
        ).run(action_id, restoreId);
      }
      return {
        success: true as const,
        actionId: restoreId,
        undoneActions: Number(laterActions.n),
      };
    })();
  } catch (error) {
    if (error instanceof HistoryMismatch) {
      throw new Error(
        'Cannot go back: the data no longer matches the history (it was changed another way). Nothing was changed; a backup was saved.',
      );
    }
    if (/FOREIGN KEY/i.test((error as Error)?.message ?? '')) {
      throw new Error(
        'Cannot go back: a boat or sailor this event used then has since been deleted from the app. Nothing was changed.',
      );
    }
    throw error;
  } finally {
    // SHRS 3.1.5 rows may have changed under the in-memory cache.
    invalidateAssignmentSnapshotCache();
  }
}
