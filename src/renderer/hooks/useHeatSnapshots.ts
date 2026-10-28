import { useCallback, useEffect } from 'react';
import { heatRaceDB } from '../api/db';
import useSnapshotHistory from './useSnapshotHistory';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';

/**
 * The recovery-backup actions of the heats view: save the event to a file,
 * restore it from one, and the "Recent backups" list that remembers what was
 * saved. `onRestored` runs once a restore has replaced the event's data, so
 * the caller can reload what it shows.
 */
export default function useHeatSnapshots(
  eventId: number,
  onRestored: () => Promise<void>,
) {
  const { history, load: loadHistory, remember } = useSnapshotHistory(eventId);

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
      const result = await heatRaceDB.restoreEventSnapshotFromFile(eventId);
      if (result?.canceled) return;

      await onRestored();

      reportInfo('Event restored from backup.', 'Backup restored');
    } catch (error) {
      reportError('Could not restore backup.', error);
    }
  }, [eventId, onRestored]);

  return { history, saveBackupFile, saveBackup, restoreBackup };
}
