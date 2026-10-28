import { db } from '../../../public/Database/DBManager';
import {
  laterActionOn,
  lastChangeId,
  readAction,
  tagChanges,
} from './changeJournal';
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from './leaderboardRecompute';
import { hasFinalSeriesStarted } from './seriesGuards';
import { rescoreRace } from './raceScoring';
import { invalidateAssignmentSnapshotCache } from './raceAssignmentSnapshot';
import {
  RevertStep,
  isUntouchedSince,
  revertSteps,
  whyNotRevertable,
} from '../../shared/history/revert';
import { actionLabel, describeChange } from '../../shared/history/describe';

const columnsOf = (table: string): Set<string> =>
  new Set(
    (
      db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]
    ).map((row) => row.name),
  );

/** Only the table's own column names ever reach the SQL text. */
function checkedColumns(table: string, names: string[]): string[] {
  const known = columnsOf(table);
  names.forEach((name) => {
    if (!known.has(name)) {
      throw new Error(
        'This change cannot be undone automatically: its history entry has data this version of the app does not recognise.',
      );
    }
  });
  return names;
}

function whereKey(step: RevertStep) {
  const columns = checkedColumns(step.table, Object.keys(step.key));
  return {
    sql: columns.map((column) => `${column} = ?`).join(' AND '),
    values: columns.map((column) => step.key[column]),
  };
}

function currentRow(step: RevertStep) {
  const where = whereKey(step);
  return (
    (db
      .prepare(`SELECT * FROM ${step.table} WHERE ${where.sql}`)
      .get(...where.values) as Record<string, unknown> | undefined) ?? null
  );
}

function apply(step: RevertStep) {
  const where = whereKey(step);
  if (step.op === 'delete') {
    db.prepare(`DELETE FROM ${step.table} WHERE ${where.sql}`).run(
      ...where.values,
    );
    return;
  }
  const row = step.row as Record<string, unknown>;
  const columns = checkedColumns(step.table, Object.keys(row));
  const values = columns.map((column) => row[column]);
  if (step.op === 'insert') {
    db.prepare(
      `INSERT INTO ${step.table} (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(...values);
    return;
  }
  db.prepare(
    `UPDATE ${step.table} SET ${columns.map((c) => `${c} = ?`).join(', ')}
     WHERE ${where.sql}`,
  ).run(...values, ...where.values);
}

/**
 * Undo one action from an event's history: put back every row it changed, as
 * it was before, then rebuild the standings — all or nothing. Refused when the
 * action is not a result change (see shared/history/revert.ts) or when a later
 * action changed the same rows, so an undo never overwrites newer work. The
 * undo is itself an action in the history, so it can be undone too.
 */
export default function revertHistoryAction(
  event_id: number,
  action_id: number,
) {
  const action = readAction(action_id);
  if (!action || action.changes.length === 0) {
    throw new Error('This change is no longer in the history.');
  }
  if (action.eventIds.some((id) => id !== event_id)) {
    throw new Error('This change belongs to another event.');
  }
  const reason = whyNotRevertable(action);
  if (reason) throw new Error(reason);

  const lastOfAction = Math.max(...action.changes.map((c) => c.change_id));
  const steps = revertSteps(action);
  const mark = lastChangeId();

  try {
    return db.transaction(() => {
      steps.forEach((step) => {
        if (!isUntouchedSince(step, currentRow(step))) {
          const later = laterActionOn(
            step.table,
            step.change.row_key,
            lastOfAction,
          );
          const by = later ? ` by “${actionLabel(later.channel)}”` : '';
          // The SHRS 3.1.5 rows are internal: name what they mean.
          const what =
            step.table === 'Scores'
              ? describeChange(step.change)
              : 'the heat order frozen by this protest decision (SHRS 3.1.5)';
          throw new Error(
            `Cannot undo: ${what} was changed again later${by}. Undo that change first.`,
          );
        }
        apply(step);
      });
      // Rows come back one by one, so score each touched race again: a place
      // shared with a boat a later action moved there must split its points
      // (RRS A7).
      const touchedRaces = new Set<number>();
      steps.forEach((step) => {
        if (step.table !== 'Scores') return;
        const row = step.row ?? step.expected;
        if (row?.race_id != null) touchedRaces.add(Number(row.race_id));
      });
      touchedRaces.forEach((raceId) => {
        const exists = db
          .prepare('SELECT 1 FROM Races WHERE race_id = ?')
          .get(raceId);
        if (exists) rescoreRace(raceId);
      });
      recomputeEventLeaderboard(event_id);
      if (hasFinalSeriesStarted(event_id)) recomputeFinalLeaderboard(event_id);

      const undoId = tagChanges(mark, 'revertHistoryAction');
      if (undoId != null) {
        db.prepare(
          'UPDATE ChangeActions SET reverts_action_id = ? WHERE action_id = ?',
        ).run(action_id, undoId);
      }
      return { success: true as const, actionId: undoId };
    })();
  } finally {
    // The SHRS 3.1.5 snapshot rows may have changed under the in-memory cache.
    invalidateAssignmentSnapshotCache();
  }
}
