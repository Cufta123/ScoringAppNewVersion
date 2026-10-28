import { dialog } from 'electron';
import fs from 'fs';
import handle from './handle';
import {
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../functions/eventSnapshot';

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

  return {
    success: true,
    filePath: saveResult.filePath,
  };
});

handle('restoreEventSnapshotFromFile', async (_event, event_id) => {
  const openResult = await dialog.showOpenDialog({
    title: 'Load Event Snapshot',
    properties: ['openFile'],
    filters: [{ name: 'JSON files', extensions: ['json'] }],
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = openResult.filePaths[0];
  const snapshotRaw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(snapshotRaw);

  restoreEventSnapshot(Number(event_id), parsed);

  return {
    success: true,
    filePath,
  };
});
