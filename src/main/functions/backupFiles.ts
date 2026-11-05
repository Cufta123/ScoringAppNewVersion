/**
 * The backup files saved for an event (migration 13): recorded when the
 * main process writes one, read for the "History and backups" dialog.
 * A database without the table (a test that builds its own schema) keeps
 * no list.
 */
import fs from 'fs';
import path from 'path';
import { db } from '../database/DBManager';
import type { BackupFileEntry } from '../../shared/backupFiles';

/** The newest few are shown; older rows stay but are not listed. */
export const SHOWN_BACKUP_FILES = 5;

const hasTable = () =>
  Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'BackupFiles'",
      )
      .get(),
  );

export function recordBackupFile(eventId: number, filePath: string) {
  if (!hasTable()) return;
  db.prepare('INSERT INTO BackupFiles (event_id, file_path) VALUES (?, ?)').run(
    eventId,
    filePath,
  );
}

export function listBackupFiles(eventId: number): BackupFileEntry[] {
  if (!hasTable()) return [];
  const rows = db
    .prepare(
      `SELECT file_path, saved_at FROM BackupFiles
       WHERE event_id = ? ORDER BY backup_id DESC LIMIT ?`,
    )
    .all(eventId, SHOWN_BACKUP_FILES) as {
    file_path: string;
    saved_at: string;
  }[];
  return rows.map((row) => ({
    fileName: path.basename(row.file_path),
    filePath: row.file_path,
    savedAt: row.saved_at,
    exists: fs.existsSync(row.file_path),
  }));
}

/** An event's list goes with it (foreign keys, no cascade). */
export function deleteBackupFiles(eventId: number) {
  if (!hasTable()) return;
  db.prepare('DELETE FROM BackupFiles WHERE event_id = ?').run(eventId);
}
