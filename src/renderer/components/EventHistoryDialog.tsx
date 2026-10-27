import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { eventDB } from '../api/db';
import { HistoryAction, summarizeAction } from '../../shared/history/describe';
import { undoneActionIds, whyNotRevertable } from '../../shared/history/revert';
import { notifyEventDataChanged } from '../utils/eventDataChanged';

interface EventHistoryDialogProps {
  eventId: number;
  open: boolean;
  onClose: () => void;
}

/** Changes listed per action before "Show all" is needed. */
const PREVIEW_LINES = 6;

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function HistoryEntry({
  label,
  at,
  lines,
  undone,
  onUndo = undefined,
  busy,
}: {
  label: string;
  at: string;
  lines: string[];
  undone: boolean;
  /** Present when this action can be undone from here. */
  onUndo?: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? lines : lines.slice(0, PREVIEW_LINES);
  return (
    <li className={`history-entry${undone ? ' history-undone' : ''}`}>
      <div className="history-entry-head">
        <strong>
          {label}
          {undone && <span className="history-undone-tag">Undone</span>}
        </strong>
        <span className="history-entry-side">
          <time dateTime={at}>{formatTime(at)}</time>
          {onUndo && !undone && (
            <button
              type="button"
              className="btn-ghost history-undo"
              onClick={onUndo}
              disabled={busy}
              aria-label={`Undo: ${label}, ${formatTime(at)}`}
            >
              <i className="fa fa-rotate-left" aria-hidden="true" /> Undo
            </button>
          )}
        </span>
      </div>
      <ul className="history-lines">
        {shown.map((line, index) => (
          // Lines can repeat word for word; their position is their identity.
          // eslint-disable-next-line react/no-array-index-key
          <li key={index}>{line}</li>
        ))}
      </ul>
      {lines.length > PREVIEW_LINES && (
        <button
          type="button"
          className="btn-ghost history-more"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show fewer' : `Show all ${lines.length} changes`}
        </button>
      )}
    </li>
  );
}

/**
 * Everything that changed in an event, newest first, as the app recorded it
 * (scores, protest decisions, heats, undo, settings). A result change can be
 * undone from here; the main process refuses it if a later change touched the
 * same results (src/shared/history/revert.ts).
 */
function EventHistoryDialog({
  eventId,
  open,
  onClose,
}: EventHistoryDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [actions, setActions] = useState<HistoryAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const load = useCallback(
    (isActive: () => boolean = () => true) =>
      Promise.resolve()
        .then(() => eventDB.readEventHistory(eventId))
        .then((result) => {
          if (isActive()) setActions(result);
          return null;
        })
        .catch((err: unknown) => {
          if (isActive()) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }),
    [eventId],
  );

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setActions(null);
    setError(null);
    setNotice(null);
    setUndoError(null);
    setFilter('');
    load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [open, load]);

  const undo = async (actionId: number, label: string) => {
    setBusy(true);
    setNotice(null);
    setUndoError(null);
    try {
      await eventDB.revertHistoryAction(eventId, actionId);
      setNotice(
        `Undone: ${label}. The standings were recalculated. The undo is in the history and can be undone too.`,
      );
      notifyEventDataChanged(eventId);
      await load();
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const lastFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (typeof lastFocused?.focus === 'function') lastFocused.focus();
    };
  }, [open, onClose]);

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const undone = undoneActionIds(actions ?? []);
    return (actions ?? [])
      .map((action) => ({
        key: `${action.action_id ?? 'auto'}-${action.changes[0]?.change_id}`,
        at: action.at,
        actionId: action.action_id,
        undoable: action.action_id != null && !whyNotRevertable(action),
        undone: action.action_id != null && undone.has(action.action_id),
        ...summarizeAction(action),
      }))
      .map((entry) => ({
        ...entry,
        lines: needle
          ? entry.lines.filter((line) => line.toLowerCase().includes(needle))
          : entry.lines,
      }))
      .filter((entry) => entry.lines.length > 0);
  }, [actions, filter]);

  if (!open) return null;

  let body: React.ReactNode = <p>Loading…</p>;
  if (error) {
    body = <p role="alert">Could not load the history: {error}</p>;
  } else if (actions && actions.length === 0) {
    body = (
      <p>
        No changes recorded yet. The history starts from the version of the app
        that introduced it; earlier changes were not kept.
      </p>
    );
  } else if (actions) {
    body =
      entries.length === 0 ? (
        <p>No change matches “{filter.trim()}”.</p>
      ) : (
        <ol className="history-list">
          {entries.map((entry) => (
            <HistoryEntry
              key={entry.key}
              label={entry.label}
              at={entry.at}
              lines={entry.lines}
              undone={entry.undone}
              busy={busy}
              onUndo={
                entry.undoable && entry.actionId != null
                  ? () => undo(entry.actionId as number, entry.label)
                  : undefined
              }
            />
          ))}
        </ol>
      );
  }

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="feedback-modal help-modal explain-modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Event history"
        tabIndex={-1}
      >
        <h3 className="feedback-modal-title">Event history</h3>
        <label className="history-filter" htmlFor="event-history-filter">
          Filter by sail, heat or result
          <input
            id="event-history-filter"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="e.g. CRO 12 or Heat B2"
          />
        </label>
        {notice && (
          <p className="history-notice" role="status">
            {notice}
          </p>
        )}
        {undoError && (
          <p className="history-error" role="alert">
            {undoError}
          </p>
        )}
        <div className="help-modal-body">{body}</div>
        <div className="feedback-modal-actions">
          <button
            ref={closeRef}
            type="button"
            className="btn-outline"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default EventHistoryDialog;
