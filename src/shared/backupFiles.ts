/** A backup file saved for an event (IPC `readBackupFiles`). */
export interface BackupFileEntry {
  fileName: string;
  /** Where it was written. */
  filePath: string;
  /** When (SQLite CURRENT_TIMESTAMP, UTC). */
  savedAt: string;
  /** The file is still there (it may have been moved or deleted since). */
  exists: boolean;
}
