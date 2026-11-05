import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { heatRaceDB } from '../api/db';
import { useWrite } from '../api/writes';
import { queries } from '../api/queries';
import { queryKeys } from '../api/queryKeys';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';

/**
 * The recovery-backup actions of an event: save it to a file, restore it from
 * one, and the "Saved recently" list (kept by the main process, which records
 * every file it writes: IPC readBackupFiles). A restore
 * replaces the event's data (its entries can bring sailors and boats), so
 * every screen reads everything again (api/writes.ts).
 */
export default function useHeatSnapshots(eventId: number) {
  const queryClient = useQueryClient();
  const history = useQuery(queries.backupFiles(eventId)).data ?? [];
  const restoreFromFile = useWrite(
    (id: number) => heatRaceDB.restoreEventSnapshotFromFile(id),
    'everything',
  );

  /**
   * Ask for a file and write the backup there. Resolves true when it was
   * saved, false when the user cancelled the file dialog; a failure throws.
   * Tells the user it worked, so callers only handle the cancel.
   */
  const saveBackupFile = useCallback(async (): Promise<boolean> => {
    const result = await heatRaceDB.exportEventSnapshotToFile(eventId);
    if (result?.canceled) return false;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.backupFiles(eventId),
    });
    reportInfo('Recovery backup saved successfully.', 'Backup saved');
    return true;
  }, [eventId, queryClient]);

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
