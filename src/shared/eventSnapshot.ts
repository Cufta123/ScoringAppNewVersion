/**
 * The event backup file (Save backup file…, "Back up, then delete", a
 * problem report's event-snapshot.json): written and read by
 * main/functions/eventSnapshot.ts. Plain JSON.
 *
 * - `schemaVersion: 3` (now): `log` is the event (its decisions in force,
 *   in order, as `decisionStore.loadLog` returns them; boat ids are this
 *   database's `boat_id`s as text). A restore makes it the event's log; an
 *   import renames its boats (regatta-core `renameBoats`) to the boats of
 *   the database it is opened in. `tables` are still written, for a person
 *   reading the file and for an older app version, but are never read when
 *   `log` is there.
 * - `schemaVersion: 2`: no `log`; the event is read from `tables` and
 *   converted to a log, as the startup conversion converts older events.
 * - Version 1 (no `people`) can only be restored on its own computer.
 */
import type { Decision } from 'regatta-core';

export const SNAPSHOT_SCHEMA_VERSION = 3;

/** One database row, as exported (column name -> value). */
export type SnapshotRow = Record<string, unknown>;

/**
 * Who raced: the boats the event's log names (entered or not any more),
 * their sailors and clubs, and every category name. What another computer
 * needs to enter the same boats.
 */
export interface SnapshotPeople {
  Boats: SnapshotRow[];
  Sailors: SnapshotRow[];
  Clubs: SnapshotRow[];
  Categories: SnapshotRow[];
}

/**
 * The event's rows: its Events row (logo included) and its projection. A
 * type, not an interface, so a file as written is a file as read.
 */
export type SnapshotTables = {
  Events: SnapshotRow[];
  Boat_Event: SnapshotRow[];
  Heats: SnapshotRow[];
  Races: SnapshotRow[];
  Scores: SnapshotRow[];
  /** SHRS 3.1(5): a race's sheet before the committee's decisions. */
  RaceAssignmentSnapshots: SnapshotRow[];
  Heat_Boat: SnapshotRow[];
};

/**
 * A backup file without the log: as the previous version wrote it, and as
 * this one writes an event whose stored log cannot be read or replayed (so
 * the file still restores, from its tables).
 */
export interface EventSnapshotFileV2 {
  schemaVersion: 2;
  /** ISO time of the export. */
  exportedAt: string;
  /** The event's id in the database it came from (a restore checks it). */
  event_id: number;
  people: SnapshotPeople;
  tables: SnapshotTables;
}

/** A backup file as this version writes it. */
export interface EventSnapshotFile extends Omit<
  EventSnapshotFileV2,
  'schemaVersion' | 'tables'
> {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** The event: its decisions in force, oldest first. */
  log: Decision[];
  /** For people and older versions; not read when `log` is there. */
  tables: SnapshotTables;
}

/**
 * A backup file as read: any version, not trusted (a file from an older or
 * newer version, or edited by hand). The reader checks every part it uses.
 */
export interface EventSnapshotInput {
  schemaVersion?: unknown;
  event_id?: unknown;
  log?: unknown;
  people?: Partial<Record<keyof SnapshotPeople, SnapshotRow[]>>;
  tables?: Partial<Record<string, SnapshotRow[]>>;
}
