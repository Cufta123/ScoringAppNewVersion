import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

const btnBase = {
  padding: '6px 14px',
  borderRadius: 'var(--radius, 6px)',
  fontWeight: 600,
  fontSize: '0.9rem',
  cursor: 'pointer',
};

const EXPORT_FORMATS = [
  { key: 'excel', label: 'Excel (.xlsx)' },
  { key: 'csv', label: 'CSV (.csv)' },
  { key: 'txt', label: 'Plain Text (.txt)' },
  { key: 'md', label: 'Markdown (.md)' },
  { key: 'html', label: 'HTML (.html)' },
  { key: 'pdf', label: 'PDF (.pdf)' },
];

function ExportDropdown({ onExport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open export format menu"
        style={{
          ...btnBase,
          border: '1px solid var(--border, #dde3ea)',
          background: 'var(--surface, #f0f4f8)',
          color: 'var(--navy)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        Export
        <span style={{ fontSize: '0.85rem' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            background: '#fff',
            border: '1px solid var(--border, #dde3ea)',
            borderRadius: 'var(--radius, 6px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            zIndex: 200,
            minWidth: '160px',
            overflow: 'hidden',
          }}
        >
          {EXPORT_FORMATS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onExport(key);
                setOpen(false);
              }}
              aria-label={`Export leaderboard as ${label}`}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 14px',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                fontSize: '0.9rem',
                color: 'var(--navy)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surface, #f0f4f8)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

ExportDropdown.propTypes = {
  onExport: PropTypes.func.isRequired,
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
                fontSize: '0.9rem',
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
        <ExportDropdown onExport={onExport} />
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
