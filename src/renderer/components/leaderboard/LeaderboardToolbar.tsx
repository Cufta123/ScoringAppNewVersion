import React, { useState, useRef, useEffect } from 'react';

const btnBase: React.CSSProperties = {
  padding: '6px 14px',
  // Match the app-wide 44px minimum click target (App.css `button` rule). These
  // inline-styled toolbar buttons previously rendered ~29px tall, below both the
  // app standard and a comfortable target for slower/less-precise pointing.
  minHeight: 44,
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
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                minHeight: 44,
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
  /** True while a save is in flight — disables the Save button and shows progress. */
  saving?: boolean;
  compareMode: boolean;
  /** Disables the edit toggle, e.g. while the final series has no scored
   * races yet (there would be nothing editable on screen). */
  editDisabled?: boolean;
  onToggleEdit: () => void;
  onSave: () => void;
  onToggleCompare: () => void;
  onExport: (key: string) => void;
}

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
  // Compare is unavailable while editing: solid grey, not half transparent.
  let compareButtonBackground = 'var(--surface, #f0f4f8)';
  let compareButtonColor = 'var(--navy)';
  if (editMode) {
    compareButtonBackground = 'var(--bg-subtle)';
    compareButtonColor = 'var(--text-muted)';
  } else if (compareMode) {
    compareButtonBackground = 'var(--teal, #0f9478)';
    compareButtonColor = '#fff';
  }
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
          disabled={editDisabled}
          title={
            editDisabled
              ? 'Results become editable after the first final race is scored.'
              : undefined
          }
          style={{
            ...btnBase,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            // In edit mode this is Cancel: a plain white button, so it never
            // looks like Save (green) or a destructive action (red).
            border: `2px solid ${editMode ? 'var(--text-secondary)' : 'var(--border-strong)'}`,
            // A disabled button is solid grey with muted text (still >= 4.5:1),
            // never a half-transparent one that washes out in sunlight.
            background: editDisabled
              ? 'var(--bg-subtle)'
              : 'var(--surface, #fff)',
            color: editDisabled ? 'var(--text-muted)' : 'var(--navy)',
            cursor: editDisabled ? 'not-allowed' : 'pointer',
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
              borderLeft: '3px solid var(--teal, #0f9478)',
              background: 'var(--surface-2, #f8fbff)',
            }}
          >
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              style={{
                ...btnBase,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: 'none',
                background: 'var(--teal, #0f9478)',
                color: '#fff',
                cursor: saving ? 'progress' : 'pointer',
              }}
            >
              <i
                className={`fa ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`}
                aria-hidden="true"
              />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Compare toggle — comparing reads saved data, so it is unavailable
            while a draft is being edited (the two would contradict). */}
        <button
          type="button"
          onClick={onToggleCompare}
          disabled={editMode}
          title={
            editMode
              ? 'Finish or cancel editing to compare competitors.'
              : undefined
          }
          style={{
            ...btnBase,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            border: `1px solid ${compareMode ? 'var(--teal, #0f9478)' : 'var(--border-strong)'}`,
            background: compareButtonBackground,
            color: compareButtonColor,
            cursor: editMode ? 'not-allowed' : 'pointer',
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
