import React from 'react';
import { formatDateTime } from '../../utils/formatDate';
import type { SnapshotEntry } from '../../hooks/useSnapshotHistory';

interface HeatBackupBarProps {
  busy: boolean;
  onSaveBackup: () => void;
  onRestoreBackup: () => void;
  history: SnapshotEntry[];
}

/**
 * Save/Restore Backup: protect any event that has heats, including
 * single-fleet events. (Start Final Series is in the round bar at the top.)
 */
export default function HeatBackupBar({
  busy,
  onSaveBackup,
  onRestoreBackup,
  history,
}: HeatBackupBarProps) {
  return (
    <>
      <div className="final-series-bar">
        <div className="final-series-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={onSaveBackup}
            disabled={busy}
          >
            Save Backup
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onRestoreBackup}
            disabled={busy}
          >
            Restore Backup
          </button>
        </div>
        <span className="final-series-hint">
          Backups let you restore the event if something goes wrong. Starting
          the Final Series offers to save one first.
        </span>
      </div>

      {history.length > 0 && (
        <div className="snapshot-history">
          <div className="snapshot-history-title">Recent backups</div>
          <ul>
            {history.map((item) => (
              <li key={`${item.fileName}-${item.savedAt}`}>
                {item.fileName} - {formatDateTime(item.savedAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
