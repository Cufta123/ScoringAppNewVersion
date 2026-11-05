import React from 'react';

interface LeaderboardToolbarProps {
  finalSeriesStarted: boolean;
  editMode: boolean;
  /** True while a save is in flight — disables the Save button and shows progress. */
  saving?: boolean;
  compareMode: boolean;
  /** Disables the edit toggle, e.g. while the final series has no scored
   * races yet (there would be nothing editable on screen). */
  editDisabled?: boolean;
  onToggleEdit: () => void;
  onSave: () => void;
  onToggleCompare: () => void;
  /** Opens the export dialog. */
  onExport: () => void;
}

/**
 * The leaderboard's section title and actions. Viewing: Edit Results,
 * Compare and Export…, all secondary. Editing: only Cancel Editing and the
 * green Save Changes (Compare and Export read the saved results, so they
 * are hidden until the edit is saved or cancelled, not shown greyed out).
 */
function LeaderboardToolbar({
  finalSeriesStarted,
  editMode,
  saving = false,
  compareMode,
  editDisabled = false,
  onToggleEdit,
  onSave,
  onToggleCompare,
  onExport,
}: LeaderboardToolbarProps) {
  return (
    <div className="leaderboard-toolbar">
      <h2>{finalSeriesStarted ? 'Results' : 'Leaderboard'}</h2>

      <div className="leaderboard-toolbar-actions">
        {editMode ? (
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={onToggleEdit}
              disabled={saving}
            >
              <i className="fa fa-xmark" aria-hidden="true" />
              Cancel Editing
            </button>
            <button
              type="button"
              className="btn-success"
              onClick={onSave}
              disabled={saving}
              aria-busy={saving}
            >
              <i
                className={`fa ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`}
                aria-hidden="true"
              />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={onToggleEdit}
              disabled={editDisabled}
              title={
                editDisabled
                  ? 'Results become editable after the first final race is scored.'
                  : undefined
              }
            >
              <i className="fa fa-pen-to-square" aria-hidden="true" />
              Edit Results
            </button>
            <button
              type="button"
              className={compareMode ? 'btn-success' : 'btn-outline'}
              onClick={onToggleCompare}
              aria-pressed={compareMode}
            >
              <i
                className={`fa ${compareMode ? 'fa-xmark' : 'fa-right-left'}`}
                aria-hidden="true"
              />
              {compareMode ? 'Exit Compare' : 'Compare'}
            </button>
            <button type="button" className="btn-outline" onClick={onExport}>
              <i className="fa fa-file-export" aria-hidden="true" />
              Export…
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default LeaderboardToolbar;
