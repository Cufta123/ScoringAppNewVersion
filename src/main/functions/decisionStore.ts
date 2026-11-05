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
import { db } from '../../../public/Database/DBManager';
import { eventToLog } from './eventLog';
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
  db.transaction(() => {
    const converted = convertTables(eventId);
    append(eventId, converted.decisions, null);
    db.prepare(
      'INSERT INTO EventLogs (event_id, notes, anomalies) VALUES (?, ?, ?)',
    ).run(
      eventId,
      JSON.stringify(converted.notes),
      JSON.stringify(converted.anomalies),
    );
  })();
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
  const kept = new Set<number>();
  const added: Decision[] = [];
  let at = 0;
  next.forEach((decision) => {
    const body = JSON.stringify(decision);
    // The next unused row with this decision, in order.
    let i = at;
    while (i < current.length && current[i].body !== body) i += 1;
    if (i < current.length) {
      kept.add(current[i].decision_id);
      at = i + 1;
    } else {
      added.push(decision);
    }
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
    const converted = convertTables(eventId);
    append(eventId, converted.decisions, null);
    db.prepare(
      'INSERT INTO EventLogs (event_id, notes, anomalies) VALUES (?, ?, ?)',
    ).run(
      eventId,
      JSON.stringify(converted.notes),
      JSON.stringify(converted.anomalies),
    );
  })();
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
}

/** Whether a call wrote or withdrew decisions not yet tagged. */
export function hasPendingDecisions(): boolean {
  if (!hasLogStore()) return false;
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM Decisions WHERE action_id = ? OR withdrawn_by = ? LIMIT 1',
      )
      .get(PENDING, PENDING),
  );
}
