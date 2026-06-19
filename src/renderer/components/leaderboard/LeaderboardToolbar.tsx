import React, { useState, useRef, useEffect } from 'react';

const btnBase: React.CSSProperties = {
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

interface ExportDropdownProps {
  onExport: (key: string) => void;
}

function ExportDropdown({ onExport }: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
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

interface LeaderboardToolbarProps {
  finalSeriesStarted: boolean;
  editMode: boolean;
  compareMode: boolean;
  shiftPositions: boolean;
  onToggleEdit: () => void;
  onSave: () => void;
  onShiftChange: React.ChangeEventHandler<HTMLInputElement>;
  onToggleCompare: () => void;
  onExport: (key: string) => void;
}

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
}: LeaderboardToolbarProps) {
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
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            border: `1px solid ${editMode ? 'var(--danger, #e63946)' : 'var(--border, #dde3ea)'}`,
            background: editMode
              ? 'var(--danger, #e63946)'
              : 'var(--surface, #f0f4f8)',
            color: editMode ? '#fff' : 'var(--navy)',
          }}
        >
          <i
            className={`fa ${editMode ? 'fa-xmark' : 'fa-pen-to-square'}`}
            aria-hidden="true"
          />
          {editMode ? 'Cancel Editing' : 'Edit Results'}
        </button>

        {/* Save + shift — grouped into one "editing" panel so the edit state
            reads as a distinct mode rather than loose buttons. */}
        {editMode && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '6px 8px 6px 14px',
              borderRadius: 'var(--radius, 6px)',
              border: '1px solid var(--border, #dde3ea)',
              borderLeft: '3px solid var(--teal, #2a9d8f)',
              background: 'var(--surface-2, #f8fbff)',
            }}
          >
            <label
              className="toggle"
              htmlFor="shiftPositionsCheckbox"
              title="On: when a boat's place changes, the other boats in that race shift to keep places contiguous. Off: only the edited boat changes — other boats are left exactly as they are (which may leave a tie or a gap to fix manually)."
            >
              <input
                id="shiftPositionsCheckbox"
                type="checkbox"
                checked={shiftPositions}
                onChange={onShiftChange}
              />
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
              Shift other boats
            </label>
            <button
              type="button"
              onClick={onSave}
              style={{
                ...btnBase,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: 'none',
                background: 'var(--teal, #2a9d8f)',
                color: '#fff',
              }}
            >
              <i className="fa fa-save" aria-hidden="true" />
              Save Changes
            </button>
          </div>
        )}

        {/* Compare toggle */}
        <button
          type="button"
          onClick={onToggleCompare}
          style={{
            ...btnBase,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            border: `1px solid ${compareMode ? 'var(--teal, #2a9d8f)' : 'var(--border, #dde3ea)'}`,
            background: compareMode
              ? 'var(--teal, #2a9d8f)'
              : 'var(--surface, #f0f4f8)',
            color: compareMode ? '#fff' : 'var(--navy)',
          }}
        >
          <i
            className={`fa ${compareMode ? 'fa-xmark' : 'fa-right-left'}`}
            aria-hidden="true"
          />
          {compareMode ? 'Exit Compare' : 'Compare'}
        </button>

        {/* Export */}
        <ExportDropdown onExport={onExport} />
      </div>
    </div>
  );
}

export default LeaderboardToolbar;
