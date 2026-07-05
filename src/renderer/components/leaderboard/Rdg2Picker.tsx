import React from 'react';
import type { LeaderboardEntry, Rdg2PickerState } from '../../types';

interface Rdg2PickerProps {
  entry: LeaderboardEntry;
  raceIndex: number;
  rdg2Picker: Rdg2PickerState | null;
  setRdg2Picker: React.Dispatch<React.SetStateAction<Rdg2PickerState | null>>;
  confirmRdg2: () => void;
  qualifyingEntry?: LeaderboardEntry | null;
}

/**
 * Floating popover for selecting races to average for an RDG2 redress.
 * Supports qualifying races (qualifyingEntry) and/or final-series races (entry).
 */
// Estimated max popover height: header + capped race list (300px) + buttons.
// Used to flip the popover above the anchor when it would overflow the
// viewport bottom.
const PICKER_EST_HEIGHT = 420;
const PICKER_MIN_WIDTH = 240;

function Rdg2Picker({
  entry,
  raceIndex,
  rdg2Picker,
  setRdg2Picker,
  confirmRdg2,
  qualifyingEntry = null,
}: Rdg2PickerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // The popover is fixed-positioned at the rect captured when it opened, so it
  // cannot track its anchor cell. Close it on outside click, Escape, or any
  // scroll outside the popover instead of letting it drift detached.
  React.useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setRdg2Picker(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRdg2Picker(null);
    };
    const onScroll = (e: Event) => {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        containerRef.current.contains(e.target)
      ) {
        return; // scrolling the race list inside the popover is fine
      }
      setRdg2Picker(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [setRdg2Picker]);

  if (!rdg2Picker?.anchorRect) return null;

  const totalSelected =
    (rdg2Picker.selectedIndices?.size ?? 0) +
    (rdg2Picker.selectedQualIndices?.size ?? 0);

  const hasQual = (qualifyingEntry?.races?.length ?? 0) > 0;

  const { anchorRect } = rdg2Picker;
  // Open upward when there's no room below but there is above; clamp the left
  // edge so the popover never hangs off the right side of the window.
  const openUp =
    anchorRect.bottom + PICKER_EST_HEIGHT > window.innerHeight &&
    anchorRect.top > PICKER_EST_HEIGHT;
  const verticalPlacement: React.CSSProperties = openUp
    ? { bottom: window.innerHeight - anchorRect.top + 4 }
    : { top: anchorRect.bottom + 4 };
  const left = Math.max(
    8,
    Math.min(anchorRect.left, window.innerWidth - PICKER_MIN_WIDTH - 8),
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        ...verticalPlacement,
        left,
        zIndex: 9999,
        background: '#fff',
        border: '1px solid var(--teal,#2a9d8f)',
        borderRadius: '8px',
        padding: '10px 14px',
        minWidth: '240px',
        width: 'max-content',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.9rem',
          marginBottom: '8px',
          color: 'var(--teal,#2a9d8f)',
        }}
      >
        Select races for RDG2
      </div>

      <div
        style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '8px' }}
      >
        {/* Qualifying races (if final series context) */}
        {hasQual && qualifyingEntry && (
          <>
            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#888',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Qualifying
            </div>
            {qualifyingEntry.races.map((_, qIdx) => {
              const checked =
                rdg2Picker.selectedQualIndices?.has(qIdx) ?? false;
              return (
                // The checkbox control is nested directly inside this label,
                // which is a valid implicit association the rule misses here.
                // eslint-disable-next-line jsx-a11y/label-has-associated-control
                <label
                  // eslint-disable-next-line react/no-array-index-key
                  key={`q-${qIdx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    marginBottom: '5px',
                    padding: '3px 4px',
                    borderRadius: '4px',
                    background: checked
                      ? 'rgba(42,157,143,0.08)'
                      : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const newSet = new Set(
                        rdg2Picker.selectedQualIndices || [],
                      );
                      if (checked) newSet.delete(qIdx);
                      else newSet.add(qIdx);
                      setRdg2Picker({
                        ...rdg2Picker,
                        selectedQualIndices: newSet,
                      });
                    }}
                  />
                  Q{qIdx + 1}
                </label>
              );
            })}
            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#888',
                margin: '6px 0 4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Final
            </div>
          </>
        )}

        {/* Final (or qualifying-only) races */}
        {entry.races.map((_, rIdx) => {
          if (rIdx === raceIndex) return null;
          const checked = rdg2Picker.selectedIndices?.has(rIdx) ?? false;
          const label = hasQual ? `F${rIdx + 1}` : `Q${rIdx + 1}`;
          return (
            // The checkbox control is nested directly inside this label,
            // which is a valid implicit association the rule misses here.
            // eslint-disable-next-line jsx-a11y/label-has-associated-control
            <label
              // eslint-disable-next-line react/no-array-index-key
              key={`f-${rIdx}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                cursor: 'pointer',
                marginBottom: '5px',
                padding: '3px 4px',
                borderRadius: '4px',
                background: checked ? 'rgba(42,157,143,0.08)' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const newSet = new Set(rdg2Picker.selectedIndices);
                  if (checked) newSet.delete(rIdx);
                  else newSet.add(rIdx);
                  setRdg2Picker({ ...rdg2Picker, selectedIndices: newSet });
                }}
              />
              {label}
            </label>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          type="button"
          onClick={confirmRdg2}
          disabled={totalSelected === 0}
          style={{
            flex: 1,
            fontSize: '0.9rem',
            padding: '8px 10px',
            borderRadius: '5px',
            background: 'var(--teal,#2a9d8f)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            opacity: totalSelected === 0 ? 0.4 : 1,
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => setRdg2Picker(null)}
          style={{
            flex: 1,
            fontSize: '0.9rem',
            padding: '8px 10px',
            borderRadius: '5px',
            background: 'var(--surface,#f5f7fa)',
            border: '1px solid var(--border,#dde3ea)',
            color: 'var(--navy,#1a2e44)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default Rdg2Picker;
