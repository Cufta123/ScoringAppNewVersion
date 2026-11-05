import React, { useCallback } from 'react';
import useHeatSnapshots from '../../hooks/useHeatSnapshots';
import useExclusiveAction from '../../hooks/useExclusiveAction';
import { notifyEventDataChanged } from '../../utils/eventDataChanged';
import { formatDateTime } from '../../utils/formatDate';

interface BackupFileSectionProps {
  eventId: number;
  /** A going-back or undo in the dialog is running: wait for it. */
  disabled?: boolean;
}

/**
 * The event's backup file, in the history dialog: everything that takes the
 * event back is in one place (the change history above, a file here). It
 * used to sit under the heats, beside Start Final Series.
 */
export default function BackupFileSection({
  eventId,
  disabled = false,
}: BackupFileSectionProps) {
  const onRestored = useCallback(async () => {
    // The pages reload what they show (heats, entries, standings).
    notifyEventDataChanged(eventId);
  }, [eventId]);
  const { history, saveBackup, restoreBackup } = useHeatSnapshots(
    eventId,
    onRestored,
  );
  const { busy, runExclusive } = useExclusiveAction();
  const off = busy || disabled;

  return (
    <section className="backup-file" aria-labelledby="backup-file-title">
      <h4 id="backup-file-title">
        <i className="fa fa-floppy-disk" aria-hidden="true" /> Backup file
      </h4>
      <p>
        Save the whole event to a file you keep (on a USB stick, or e-mail it to
        yourself). Restoring one replaces this event&apos;s heats, races and
        scores with the file&apos;s.
      </p>
      <div className="backup-file-actions">
        <button
          type="button"
          className="btn-outline"
          onClick={() => runExclusive(saveBackup)}
          disabled={off}
        >
          <i className="fa fa-download" aria-hidden="true" /> Save backup file…
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => runExclusive(restoreBackup)}
          disabled={off}
        >
          <i className="fa fa-upload" aria-hidden="true" /> Restore from file…
        </button>
      </div>
      {history.length > 0 && (
        <p className="backup-file-recent">
          Saved recently:{' '}
          {history
            .map((item) => `${item.fileName} (${formatDateTime(item.savedAt)})`)
            .join(', ')}
        </p>
      )}
    </section>
  );
}
