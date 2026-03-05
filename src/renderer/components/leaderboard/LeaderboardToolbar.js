import React from 'react';
import PropTypes from 'prop-types';

const btnBase = {
  padding: '6px 14px',
  borderRadius: 'var(--radius, 6px)',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

function LeaderboardToolbar({
  finalSeriesStarted,
  editMode,
  compareMode,
  shiftPositions,
  onToggleEdit,
  onSave,
  onShiftChange,
  onToggleCompare,
  onExport,
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--navy)' }}>
        {finalSeriesStarted ? 'Results' : 'Leaderboard'}
      </h2>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        {/* Edit toggle */}
        <button
          type="button"
          onClick={onToggleEdit}
          style={{
            ...btnBase,
            border: `1px solid ${editMode ? 'var(--danger, #e63946)' : 'var(--border, #dde3ea)'}`,
            background: editMode
              ? 'var(--danger, #e63946)'
              : 'var(--surface, #f0f4f8)',
            color: editMode ? '#fff' : 'var(--navy)',
          }}
        >
          {editMode ? 'Cancel Editing' : 'Edit Results'}
        </button>

        {/* Save + shift — only visible in edit mode */}
        {editMode && (
          <>
            <button
              type="button"
              onClick={onSave}
              style={{
                ...btnBase,
                border: 'none',
                background: 'var(--teal, #2a9d8f)',
                color: '#fff',
              }}
            >
              Save Changes
            </button>
            <label
              htmlFor="shiftPositionsCheckbox"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                color: 'var(--navy)',
                cursor: 'pointer',
              }}
            >
              <input
                id="shiftPositionsCheckbox"
                type="checkbox"
                checked={shiftPositions}
                onChange={onShiftChange}
              />
              Shift other boats
            </label>
          </>
        )}

        {/* Compare toggle */}
        <button
          type="button"
          onClick={onToggleCompare}
          style={{
            ...btnBase,
            border: `1px solid ${compareMode ? 'var(--teal, #2a9d8f)' : 'var(--border, #dde3ea)'}`,
            background: compareMode
              ? 'var(--teal, #2a9d8f)'
              : 'var(--surface, #f0f4f8)',
            color: compareMode ? '#fff' : 'var(--navy)',
          }}
        >
          {compareMode ? 'Exit Compare' : 'Compare'}
        </button>

        {/* Export */}
        <button
          type="button"
          onClick={onExport}
          style={{
            ...btnBase,
            border: '1px solid var(--border, #dde3ea)',
            background: 'var(--surface, #f0f4f8)',
            color: 'var(--navy)',
          }}
        >
          Export to Excel
        </button>
      </div>
    </div>
  );
}

LeaderboardToolbar.propTypes = {
  finalSeriesStarted: PropTypes.bool.isRequired,
  editMode: PropTypes.bool.isRequired,
  compareMode: PropTypes.bool.isRequired,
  shiftPositions: PropTypes.bool.isRequired,
  onToggleEdit: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onShiftChange: PropTypes.func.isRequired,
  onToggleCompare: PropTypes.func.isRequired,
  onExport: PropTypes.func.isRequired,
};

export default LeaderboardToolbar;
