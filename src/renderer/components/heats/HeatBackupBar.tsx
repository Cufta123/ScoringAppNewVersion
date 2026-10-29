import React from 'react';
import type { SnapshotEntry } from '../../hooks/useSnapshotHistory';

interface HeatBackupBarProps {
  /** SHRS 1.1: a Final Series can start (2+ qualifying groups, not started). */
  canStartFinalSeries: boolean;
  busy: boolean;
  onStartFinalSeries: () => void;
  onSaveBackup: () => void;
  onRestoreBackup: () => void;
  history: SnapshotEntry[];
}

/**
 * Phase transition: Start Final Series + its safety net. Start Final Series
 * only applies with 2+ qualifying heat groups, but Save/Restore Backup protect
 * any event that has heats — including single-fleet events — so the bar shows
 * once heats exist and only the Start button is gated.
 */
export default function HeatBackupBar({
  canStartFinalSeries,
  busy,
  onStartFinalSeries,
  onSaveBackup,
  onRestoreBackup,
  history,
}: HeatBackupBarProps) {
  return (
    <>
      <div className="final-series-bar">
        <div className="final-series-actions">
          {canStartFinalSeries && (
            <button
              type="button"
              className="btn-success"
              onClick={onStartFinalSeries}
              disabled={busy}
            >
              <i className="fa fa-flag-checkered" aria-hidden="true" /> Start
              Final Series
            </button>
          )}
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
          {canStartFinalSeries
            ? 'Splits the boats into final fleets (Gold/Silver/…) based on current standings. Save a backup first so you can restore the event if something goes wrong.'
            : 'Backups let you restore the event if something goes wrong.'}
        </span>
      </div>

      {history.length > 0 && (
        <div className="snapshot-history">
          <div className="snapshot-history-title">Recent backups</div>
          <ul>
            {history.map((item) => (
              <li key={`${item.fileName}-${item.savedAt}`}>
                {item.fileName} - {new Date(item.savedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
