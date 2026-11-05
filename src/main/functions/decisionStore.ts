/**
 * The event's decision log in the database (Decisions, migration 9): the
 * event itself, from which regatta-core works out the heats, races and
 * results the other tables hold (phase 3 of docs/regatta-core-switch.md).
 *
 * - An event that has no log yet (made before this version, or by an older
 *   import) gets one converted from its tables the first time it is used
 *   (functions/eventLog.ts), with the conversion's notes and anomalies kept
 *   in EventLogs.
 * - A decision is never deleted: taking it back marks it withdrawn, so the
 *   history keeps it and an undo can be undone.
 * - Decisions written during an IPC call are tagged with that call's
 *   ChangeActions row afterwards (changeJournal.tagChanges), like the
 *   journal's row changes: `action_id` / `withdrawn_by` are -1 meanwhile.
 *
 * A database without the table (a test that builds its own schema) has no
 * stored log: the log is converted from the tables every time, as before.
 */
import type { Decision } from 'regatta-core';
import { db } from '../database/DBManager';
import { eventToLog, logDifferences } from './eventLog';
import { ensureCompleteRaceScoresForEvent } from './raceScoring';
import { hasFinalSeriesStarted } from './seriesGuards';

/** Marks a row written or withdrawn by the call still running. */
export const PENDING = -1;

interface Row {
  decision_id: number;
  seq: number;
  body: string;
}

export function hasLogStore(): boolean {
  try {
    return Boolean(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Decisions'",
        )
        .get(),
    );
  } catch {
    return false;
  }
}

/** The tables as a log, with the rows the older write paths left out. */
function convertTables(eventId: number) {
  ensureCompleteRaceScoresForEvent(eventId, 'Qualifying');
  if (hasFinalSeriesStarted(eventId)) {
    ensureCompleteRaceScoresForEvent(eventId, 'Final');
  }
  return eventToLog(eventId);
}

const inForce = (eventId: number) =>
  db
    .prepare(
      `SELECT decision_id, seq, body FROM Decisions
       WHERE event_id = ? AND withdrawn_by IS NULL ORDER BY seq`,
    )
    .all(eventId) as Row[];

function nextSeq(eventId: number): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM Decisions WHERE event_id = ?',
    )
    .get(eventId) as { seq: number };
  return Number(row.seq) + 1;
}

function append(
  eventId: number,
  decisions: Decision[],
  actionId: number | null,
) {
  let seq = nextSeq(eventId);
  const insert = db.prepare(
    'INSERT INTO Decisions (event_id, seq, body, action_id) VALUES (?, ?, ?, ?)',
  );
  decisions.forEach((decision) => {
    insert.run(eventId, seq, JSON.stringify(decision), actionId);
    seq += 1;
  });
}

const hasColumn = (table: string, column: string) =>
  (
    db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]
  ).some((row) => row.name === column);

/**
 * Convert the event's tables, append the log and record the conversion in
 * EventLogs: its notes, its anomalies and (migration 11) what regatta-core
 * scores differently from the tables, which the race officer is shown.
 */
function convertAndRecord(eventId: number) {
  const converted = convertTables(eventId);
  // Compared before anything is written: the tables are still the old
  // app's.
  const differences = logDifferences(eventId, converted);
  append(eventId, converted.decisions, null);
  const changes = JSON.stringify({
    refused: differences.refused,
    heats: differences.heats,
    points: differences.points.map(({ stored: _stored, ...point }) => point),
  });
  if (hasColumn('EventLogs', 'changes')) {
    db.prepare(
      'INSERT INTO EventLogs (event_id, converted_by, notes, anomalies, changes) VALUES (?, ?, ?, ?, ?)',
    ).run(
      eventId,
      PENDING,
      JSON.stringify(converted.notes),
      JSON.stringify(converted.anomalies),
      changes,
    );
  } else {
    db.prepare(
      'INSERT INTO EventLogs (event_id, converted_by, notes, anomalies) VALUES (?, ?, ?, ?)',
    ).run(
      eventId,
      PENDING,
      JSON.stringify(converted.notes),
      JSON.stringify(converted.anomalies),
    );
  }
}

/**
 * Make the event's log exist: converted from its tables (and recorded in
 * EventLogs) when it has none. Returns false without a store.
 */
export function ensureEventLog(eventId: number): boolean {
  if (!hasLogStore()) return false;
  const known = db
    .prepare('SELECT 1 FROM EventLogs WHERE event_id = ?')
    .get(eventId);
  if (known) return true;
  db.transaction(() => convertAndRecord(eventId))();
  return true;
}

/** The event's decisions in force, oldest first. */
export function loadLog(eventId: number): Decision[] {
  if (!ensureEventLog(eventId)) return convertTables(eventId).decisions;
  return inForce(eventId).map((row) => JSON.parse(row.body) as Decision);
}

/**
 * Store `next` as the event's log: decisions no longer in it are withdrawn,
 * new ones appended (in order). Unchanged decisions keep their rows.
 * Without a store, nothing is stored (the tables are written by the
 * projection and converted again on the next read).
 */
export function saveLog(eventId: number, next: Decision[]) {
  if (!ensureEventLog(eventId)) return;
  const current = inForce(eventId);
  // The longest start of `next` the stored rows give in order (skipping
  // rows to withdraw); the rest of `next` is appended in its order, so the
  // stored log is always `next`, order included.
  const kept = new Set<number>();
  const added: Decision[] = [];
  let at = 0;
  let matching = true;
  next.forEach((decision) => {
    const body = JSON.stringify(decision);
    if (matching) {
      let i = at;
      while (i < current.length && current[i].body !== body) i += 1;
      if (i < current.length) {
        kept.add(current[i].decision_id);
        at = i + 1;
        return;
      }
      matching = false;
    }
    added.push(decision);
  });
  const withdraw = db.prepare(
    'UPDATE Decisions SET withdrawn_by = ? WHERE decision_id = ?',
  );
  current.forEach((row) => {
    if (!kept.has(row.decision_id)) withdraw.run(PENDING, row.decision_id);
  });
  append(eventId, added, PENDING);
}

/**
 * Replace an event's log by a new conversion of its tables (after a write
 * that changed the tables directly: a restored backup, a history restore
 * from before the log). The old decisions are withdrawn, not lost.
 */
export function reconvertEventLog(eventId: number) {
  if (!hasLogStore()) return;
  db.transaction(() => {
    db.prepare(
      'UPDATE Decisions SET withdrawn_by = ? WHERE event_id = ? AND withdrawn_by IS NULL',
    ).run(PENDING, eventId);
    db.prepare('DELETE FROM EventLogs WHERE event_id = ?').run(eventId);
    convertAndRecord(eventId);
  })();
}

/**
 * Make `next` the event's whole log, from a backup file that carries one
 * (eventSnapshot: a restore, or an import as a new event): every decision
 * in force is withdrawn and all of `next` appended in order, so the history
 * shows one action and going back before it brings the old log back
 * exactly. Nothing is converted. An event with no log yet (a new event, or
 * one never converted) gets its EventLogs row here, with `note` and no
 * anomalies, so the start-up conversion leaves it alone. Run inside a
 * transaction, after `next` was replayed.
 */
export function replaceLog(eventId: number, next: Decision[], note: string) {
  if (!hasLogStore()) return;
  const known = db
    .prepare('SELECT 1 FROM EventLogs WHERE event_id = ?')
    .get(eventId);
  if (known) {
    db.prepare(
      'UPDATE Decisions SET withdrawn_by = ? WHERE event_id = ? AND withdrawn_by IS NULL',
    ).run(PENDING, eventId);
  } else if (hasColumn('EventLogs', 'changes')) {
    db.prepare(
      'INSERT INTO EventLogs (event_id, converted_by, notes, anomalies, changes) VALUES (?, ?, ?, ?, ?)',
    ).run(
      eventId,
      PENDING,
      JSON.stringify([note]),
      '[]',
      JSON.stringify({ refused: null, heats: [], points: [] }),
    );
  } else {
    db.prepare(
      'INSERT INTO EventLogs (event_id, converted_by, notes, anomalies) VALUES (?, ?, ?, ?)',
    ).run(eventId, PENDING, JSON.stringify([note]), '[]');
  }
  append(eventId, next, PENDING);
}

/** Every decision of an event goes with it (deleteEvent). */
export function deleteEventLog(eventId: number) {
  if (!hasLogStore()) return;
  db.prepare('DELETE FROM Decisions WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM EventLogs WHERE event_id = ?').run(eventId);
}

/** Tag the decisions a call wrote or withdrew with its action. */
export function tagDecisions(actionId: number) {
  if (!hasLogStore()) return;
  db.prepare('UPDATE Decisions SET action_id = ? WHERE action_id = ?').run(
    actionId,
    PENDING,
  );
  db.prepare(
    'UPDATE Decisions SET withdrawn_by = ? WHERE withdrawn_by = ?',
  ).run(actionId, PENDING);
  db.prepare(
    'UPDATE EventLogs SET converted_by = ? WHERE converted_by = ?',
  ).run(actionId, PENDING);
}

/** The action whose call converted the event's tables to its log. */
export function conversionAction(eventId: number): number | null {
  if (!hasLogStore()) return null;
  const row = db
    .prepare('SELECT converted_by FROM EventLogs WHERE event_id = ?')
    .get(eventId) as { converted_by: number | null } | undefined;
  return row?.converted_by != null && row.converted_by > 0
    ? Number(row.converted_by)
    : null;
}

/** Whether a call wrote or withdrew decisions not yet tagged. */
export function hasPendingDecisions(): boolean {
  if (!hasLogStore()) return false;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM Decisions WHERE action_id = ? OR withdrawn_by = ?
         UNION SELECT 1 FROM EventLogs WHERE converted_by = ? LIMIT 1`,
      )
      .get(PENDING, PENDING, PENDING),
  );
}

// ── History on the log (switch phase 4) ────────────────────────────────

interface FullRow extends Row {
  action_id: number | null;
  withdrawn_by: number | null;
}

const rowsOf = (eventId: number) =>
  db
    .prepare(
      `SELECT decision_id, seq, body, action_id, withdrawn_by
       FROM Decisions WHERE event_id = ? ORDER BY seq`,
    )
    .all(eventId) as FullRow[];

/** Whether an action wrote or withdrew decisions of the event. */
export function actionHasDecisions(eventId: number, actionId: number): boolean {
  if (!hasLogStore()) return false;
  return rowsOf(eventId).some(
    (row) => row.action_id === actionId || row.withdrawn_by === actionId,
  );
}

/**
 * The decisions an action made (still in force) and the ones it withdrew,
 * as decisions.
 */
export function decisionsOfAction(eventId: number, actionId: number) {
  const rows = rowsOf(eventId);
  return {
    added: rows
      .filter((row) => row.action_id === actionId && row.withdrawn_by == null)
      .map((row) => JSON.parse(row.body) as Decision),
    withdrawn: rows
      .filter((row) => row.withdrawn_by === actionId)
      .map((row) => JSON.parse(row.body) as Decision),
  };
}

/** Decisions in force made by actions after `actionId`, with their action. */
export function laterDecisions(eventId: number, actionId: number) {
  return rowsOf(eventId)
    .filter(
      (row) =>
        row.withdrawn_by == null &&
        row.action_id != null &&
        row.action_id > actionId,
    )
    .map((row) => ({
      decision: JSON.parse(row.body) as Decision,
      actionId: Number(row.action_id),
    }));
}

/**
 * The log in force once an action is undone: its decisions out, the
 * decisions it withdrew back (at the end, as the undo's own).
 */
export function logWithoutAction(
  eventId: number,
  actionId: number,
): Decision[] {
  const rows = rowsOf(eventId);
  return [
    ...rows
      .filter((row) => row.withdrawn_by == null && row.action_id !== actionId)
      .map((row) => JSON.parse(row.body) as Decision),
    ...rows
      .filter((row) => row.withdrawn_by === actionId)
      .map((row) => JSON.parse(row.body) as Decision),
  ];
}

/** The log as it was in force right after `actionId`. */
export function logAfterAction(eventId: number, actionId: number): Decision[] {
  return rowsOf(eventId)
    .filter(
      (row) =>
        (row.action_id == null || row.action_id <= actionId) &&
        (row.withdrawn_by == null || row.withdrawn_by > actionId),
    )
    .map((row) => JSON.parse(row.body) as Decision);
}

/** Actions after `actionId` that changed the event without decisions. */
export function laterActionsWithoutDecisions(
  eventId: number,
  actionId: number,
): number[] {
  if (!hasLogStore()) return [];
  const withDecisions = new Set<number>();
  rowsOf(eventId).forEach((row) => {
    if (row.action_id != null) withDecisions.add(Number(row.action_id));
    if (row.withdrawn_by != null) withDecisions.add(Number(row.withdrawn_by));
  });
  return (
    db
      .prepare(
        `SELECT DISTINCT action_id FROM ChangeLog
         WHERE event_id = ? AND action_id > ?`,
      )
      .all(eventId, actionId) as { action_id: number }[]
  )
    .map((row) => Number(row.action_id))
    .filter((id) => !withDecisions.has(id));
}

// ── Startup and the conversion report (migration 11) ───────────────────

/** Events that have no log yet (made before this version, or imported). */
export function eventsWithoutLog(): number[] {
  if (!hasLogStore()) return [];
  return (
    db
      .prepare(
        `SELECT event_id FROM Events
         WHERE event_id NOT IN (SELECT event_id FROM EventLogs)
         ORDER BY event_id`,
      )
      .all() as { event_id: number }[]
  ).map((row) => Number(row.event_id));
}

export interface ConversionRecord {
  convertedAt: string;
  anomalies: string[];
  changes: {
    refused: string | null;
    heats: { heat: string; stored: string[]; log: string[] | null }[];
    points: {
      raceId: number;
      heat: string;
      race: number;
      boat: number;
      status: string;
      before: number;
      after: number;
    }[];
  } | null;
  seenAt: string | null;
}

/** What converting the event recorded, or null (no log store, or none). */
export function conversionRecord(eventId: number): ConversionRecord | null {
  if (!hasLogStore() || !hasColumn('EventLogs', 'changes')) return null;
  const row = db
    .prepare(
      'SELECT converted_at, anomalies, changes, report_seen_at FROM EventLogs WHERE event_id = ?',
    )
    .get(eventId) as
    | {
        converted_at: string;
        anomalies: string | null;
        changes: string | null;
        report_seen_at: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    convertedAt: row.converted_at,
    anomalies: row.anomalies ? JSON.parse(row.anomalies) : [],
    changes: row.changes ? JSON.parse(row.changes) : null,
    seenAt: row.report_seen_at,
  };
}

/** The race officer has read what the conversion changed. */
export function markConversionSeen(eventId: number) {
  if (!hasLogStore() || !hasColumn('EventLogs', 'report_seen_at')) return;
  db.prepare(
    'UPDATE EventLogs SET report_seen_at = CURRENT_TIMESTAMP WHERE event_id = ? AND report_seen_at IS NULL',
  ).run(eventId);
}
