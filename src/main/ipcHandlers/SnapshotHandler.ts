import { dialog } from 'electron';
import fs from 'fs';
import handle from './handle';
import { listBackupFiles, recordBackupFile } from '../functions/backupFiles';
import {
  buildEventSnapshot,
  importEventSnapshot,
  restoreEventSnapshot,
} from '../functions/eventSnapshot';
import type { EventSnapshotInput } from '../../shared/eventSnapshot';

/** The backup file the user picks, parsed; null when they cancel. */
const pickBackupFile = async (
  title: string,
): Promise<{ filePath: string; snapshot: EventSnapshotInput } | null> => {
  const openResult = await dialog.showOpenDialog({
    title,
    properties: ['openFile'],
    filters: [{ name: 'JSON files', extensions: ['json'] }],
  });
  if (openResult.canceled || openResult.filePaths.length === 0) return null;
  const filePath = openResult.filePaths[0];
  try {
    return {
      filePath,
      snapshot: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
    };
  } catch {
    // A SyntaxError would reach the screen as an "unexpected problem".
    throw new Error(
      'This file is not an event backup made by this app (it could not be read), so nothing was changed.',
    );
  }
};

handle('exportEventSnapshotToFile', async (_event, event_id) => {
  const snapshot = buildEventSnapshot(Number(event_id));
  const eventNameSafe = String(
    snapshot.tables.Events?.[0]?.event_name || 'event',
  )
    .replace(/[^a-z0-9_-]/gi, '_')
    .slice(0, 60);

  const saveResult = await dialog.showSaveDialog({
    title: 'Save Event Snapshot',
    defaultPath: `${eventNameSafe}_snapshot.json`,
    filters: [{ name: 'JSON files', extensions: ['json'] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(
    saveResult.filePath,
    JSON.stringify(snapshot, null, 2),
    'utf-8',
  );
  recordBackupFile(Number(event_id), saveResult.filePath);

  return {
    success: true,
    filePath: saveResult.filePath,
  };
});

handle('restoreEventSnapshotFromFile', async (_event, event_id) => {
  const picked = await pickBackupFile('Load Event Snapshot');
  if (!picked) return { canceled: true };
  restoreEventSnapshot(Number(event_id), picked.snapshot);
  return { success: true, filePath: picked.filePath };
});

/**
 * A backup file as a new event: from another computer, a problem report's
 * event-snapshot.json, or an event deleted after "Back up, then delete".
 */
handle('importEventSnapshotFromFile', async () => {
  const picked = await pickBackupFile('Import an event from a backup file');
  if (!picked) return { canceled: true };
  const { eventId, eventName } = importEventSnapshot(picked.snapshot);
  return { success: true, filePath: picked.filePath, eventId, eventName };
});

/** The backup files saved for an event, newest first. */
handle('readBackupFiles', async (_event, event_id) =>
  listBackupFiles(Number(event_id)),
);
