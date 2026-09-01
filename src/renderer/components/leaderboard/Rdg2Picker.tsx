import React from 'react';
import type { LeaderboardEntry, Rdg2PickerState } from '../../types';

interface Rdg2PickerProps {
  entry: LeaderboardEntry;
  raceIndex: number;
  rdg2Picker: Rdg2PickerState | null;
  setRdg2Picker: React.Dispatch<React.SetStateAction<Rdg2PickerState | null>>;
  confirmRdg2: () => void;
  /** Label prefix for the listed races: 'F' in the Final Series, 'Q' while the
   * event is still qualifying-only. Cosmetic — the races themselves are always
   * `entry.races`, i.e. the cell's own series (SHRS 5.6). */
  seriesPrefix?: 'Q' | 'F';
  /** The cell control the popover is anchored to. When provided, the popover
   * re-tracks it on scroll/resize instead of closing (which would discard the
   * user's in-progress selection). */
  anchorEl?: HTMLElement | null;
}

/**
 * Floating popover for selecting races to average for an RDG2 redress.
 *
 * SHRS 5.6: "averages shall be calculated separately for each of the Qualifying
 * and Final Series." The selectable races are therefore only the races of the
 * series the edited cell belongs to (`entry.races`) — a final-series redress is
 * never averaged over qualifying races, or vice versa.
 */
// Estimated max popover height: header + capped race list (300px) + buttons.
// Used to flip the popover above the anchor when it would overflow the
// viewport bottom.
const PICKER_EST_HEIGHT = 420;
const PICKER_MIN_WIDTH = 240;

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function Rdg2Picker({
  entry,
  raceIndex,
  rdg2Picker,
  setRdg2Picker,
  confirmRdg2,
  seriesPrefix = 'Q',
  anchorEl = null,
}: Rdg2PickerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const lastFocusedRef = React.useRef<HTMLElement | null>(null);
  // Live anchor position. Seeded from the rect captured when the popover opened,
  // then refreshed from the anchor element on scroll/resize so the popover stays
  // glued to its cell instead of drifting or closing.
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(
    rdg2Picker?.anchorRect ?? null,
  );

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
      if (e.key === 'Escape') {
        e.stopPropagation();
        setRdg2Picker(null);
      }
    };
    const reposition = () => {
      if (anchorEl) setAnchorRect(anchorEl.getBoundingClientRect());
    };
    const onScroll = (e: Event) => {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        containerRef.current.contains(e.target)
      ) {
        return; // scrolling the race list inside the popover is fine
      }
      // Re-track the anchor on scroll so a stray page scroll no longer discards
      // the selection. Only close when we have no anchor element to measure.
      if (anchorEl) reposition();
      else setRdg2Picker(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', reposition);
    };
  }, [setRdg2Picker, anchorEl]);

  // Focus trap + focus restore (mirrors the shared <AppModal />). The picker is
  // only mounted while open, so mount/unmount maps to open/close: focus the first
  // focusable control on open, keep Tab cycling inside the dialog, and hand focus
  // back to the triggering cell control on close.
  React.useEffect(() => {
    const dialog = containerRef.current;
    if (!dialog) return undefined;

    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusables = [
      ...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ];
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      dialog.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const currentFocusable = [
        ...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ];
      if (currentFocusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (
        lastFocusedRef.current &&
        typeof lastFocusedRef.current.focus === 'function'
      ) {
        lastFocusedRef.current.focus();
      }
    };
  }, []);

  if (!rdg2Picker || !anchorRect) return null;

  const totalSelected = rdg2Picker.selectedIndices?.size ?? 0;

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
      role="dialog"
      aria-modal="true"
      aria-label="Select races for RDG2"
      tabIndex={-1}
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
        {/* SHRS 5.6: only this cell's own series is offered — see the file
            header. `entry.races` is the active series' race list. */}
        {entry.races.map((_, rIdx) => {
          if (rIdx === raceIndex) return null;
          const checked = rdg2Picker.selectedIndices?.has(rIdx) ?? false;
          const label = `${seriesPrefix}${rIdx + 1}`;
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
