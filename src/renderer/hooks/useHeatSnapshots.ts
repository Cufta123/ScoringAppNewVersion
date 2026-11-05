import { useCallback, useEffect } from 'react';
import { heatRaceDB } from '../api/db';
import { useWrite } from '../api/writes';
import useSnapshotHistory from './useSnapshotHistory';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';

/**
 * The recovery-backup actions of an event: save it to a file, restore it from
 * one, and the "Recent backups" list that remembers what was saved. A restore
 * replaces the event's data (its entries can bring sailors and boats), so
 * every screen reads everything again (api/writes.ts).
 */
export default function useHeatSnapshots(eventId: number) {
  const { history, load: loadHistory, remember } = useSnapshotHistory(eventId);
  const restoreFromFile = useWrite(
    (id: number) => heatRaceDB.restoreEventSnapshotFromFile(id),
    'everything',
  );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /**
   * Ask for a file and write the backup there. Resolves true when it was
   * saved, false when the user cancelled the file dialog; a failure throws.
   * Tells the user it worked, so callers only handle the cancel.
   */
  const saveBackupFile = useCallback(async (): Promise<boolean> => {
    const result = await heatRaceDB.exportEventSnapshotToFile(eventId);
    if (result?.canceled) return false;
    remember(result?.filePath);
    reportInfo('Recovery backup saved successfully.', 'Backup saved');
    return true;
  }, [eventId, remember]);

  const saveBackup = useCallback(async () => {
    try {
      await saveBackupFile();
    } catch (error) {
      reportError('Could not save recovery backup.', error);
    }
  }, [saveBackupFile]);

  const restoreBackup = useCallback(async () => {
    const confirmed = await confirmAction(
      'Restore event state from a saved backup file?\n\nCurrent heats, races and scores for this event will be replaced.',
      'Restore backup',
      { confirmLabel: 'Restore backup', confirmClassName: 'btn-danger' },
    );

    if (!confirmed) return;

    try {
      const result = await restoreFromFile(eventId);
      if (result?.canceled) return;

      reportInfo('Event restored from backup.', 'Backup restored');
    } catch (error) {
      reportError('Could not restore backup.', error);
    }
  }, [eventId, restoreFromFile]);

  return { history, saveBackupFile, saveBackup, restoreBackup };
}
