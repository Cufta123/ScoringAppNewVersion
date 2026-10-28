import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { eventDB } from '../api/db';
import useModalFocus from '../hooks/useModalFocus';
import { HistoryAction, summarizeAction } from '../../shared/history/describe';
import { whyNotRevertable } from '../../shared/history/revert';
import {
  countByLabel,
  restorePreview,
  undoneActions,
} from '../../shared/history/restore';
import { notifyEventDataChanged } from '../utils/eventDataChanged';
import { plainReason, describeError } from '../utils/userFeedback';

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
  onGoBack = undefined,
  undoLabel = 'Undo',
  isTarget = false,
  busy,
}: {
  label: string;
  at: string;
  lines: string[];
  undone: boolean;
  /** Present when this action can be undone from here. */
  onUndo?: () => void;
  /** Present when the event can be taken back to right after this entry. */
  onGoBack?: () => void;
  undoLabel?: string;
  /** The entry a pending "go back" would return to. */
  isTarget?: boolean;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? lines : lines.slice(0, PREVIEW_LINES);
  return (
    <li
      className={`history-entry${undone ? ' history-undone' : ''}${
        isTarget ? ' history-target' : ''
      }`}
    >
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
              aria-label={`${undoLabel}: ${label}, ${formatTime(at)}`}
            >
              <i className="fa fa-rotate-left" aria-hidden="true" /> {undoLabel}
            </button>
          )}
          {onGoBack && (
            <button
              type="button"
              className="btn-ghost history-go-back"
              onClick={onGoBack}
              disabled={busy}
              title="Take the event back to how it was right after this"
              aria-label={`Go back to here: ${label}, ${formatTime(at)}`}
            >
              <i className="fa fa-clock-rotate-left" aria-hidden="true" /> Go
              back to here
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
  /** The entry "Go back to here" was pressed on, awaiting confirmation. */
  const [goBackTarget, setGoBackTarget] = useState<{
    actionId: number;
    label: string;
    at: string;
  } | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);

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
            setError(describeError(err, 'loading the history'));
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
    setGoBackTarget(null);
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
      setUndoError(plainReason(err) ?? 'The change could not be undone.');
    } finally {
      setBusy(false);
    }
  };

  const goBack = async (target: {
    actionId: number;
    label: string;
    at: string;
  }) => {
    setBusy(true);
    setNotice(null);
    setUndoError(null);
    try {
      const result = await eventDB.restoreEventToHistoryPoint(
        eventId,
        target.actionId,
      );
      setGoBackTarget(null);
      setNotice(
        `The event is back to how it was after “${target.label}” (${formatTime(target.at)}). ` +
          `${result.undoneActions} later ${result.undoneActions === 1 ? 'action was' : 'actions were'} taken back and the standings were recalculated. ` +
          'A backup was saved first. To return, use “Undo going back” on the newest entry.',
      );
      notifyEventDataChanged(eventId);
      await load();
    } catch (err) {
      setUndoError(
        plainReason(err) ??
          'Could not go back. Nothing was changed; the details are in the log.',
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!goBackTarget) return;
    confirmCancelRef.current?.focus();
    // Show the entry it would go back to, highlighted, below the question.
    const target = document.querySelector('.history-target');
    target?.scrollIntoView?.({ block: 'start' });
  }, [goBackTarget]);

  useModalFocus(open, closeRef, () => {
    // A pending "go back" question is closed first, not the history.
    setGoBackTarget((pending) => {
      if (!pending) onClose();
      return null;
    });
  });

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = actions ?? [];
    const undone = undoneActions(list);
    const ids = list
      .map((action) => action.action_id)
      .filter((id): id is number => id != null);
    const newest = ids.length ? Math.max(...ids) : null;
    const byId = new Map(list.map((action) => [action.action_id, action]));
    return list
      .map((action) => {
        const summary = summarizeAction(action);
        const restoresTo =
          action.restores_to_action_id != null
            ? byId.get(action.restores_to_action_id)
            : undefined;
        const label = restoresTo
          ? `Went back to after “${summarizeAction(restoresTo).label}” (${formatTime(restoresTo.at)})`
          : summary.label;
        // The entry just before this one, oldest-first: where "Undo going
        // back" returns to.
        const before = ids
          .filter((id) => action.action_id != null && id < action.action_id)
          .reduce<
            number | null
          >((best, id) => (best == null || id > best ? id : best), null);
        return {
          key: `${action.action_id ?? 'auto'}-${action.changes[0]?.change_id}`,
          at: action.at,
          actionId: action.action_id,
          label,
          lines: summary.lines,
          undoable: action.action_id != null && !whyNotRevertable(action),
          undone: action.action_id != null && undone.has(action.action_id),
          isNewest: action.action_id != null && action.action_id === newest,
          isRestore: restoresTo != null || action.restores_to_action_id != null,
          before,
          beforeAction: before != null ? byId.get(before) : undefined,
        };
      })
      .map((entry) => ({
        ...entry,
        lines: needle
          ? entry.lines.filter((line) => line.toLowerCase().includes(needle))
          : entry.lines,
      }))
      .filter(
        (entry) => entry.lines.length > 0 || (!needle && entry.isRestore),
      );
  }, [actions, filter]);

  const preview = useMemo(() => {
    if (!goBackTarget || !actions) return null;
    const { undo: undoList, redo } = restorePreview(
      actions,
      goBackTarget.actionId,
    );
    const label = (action: HistoryAction) => summarizeAction(action).label;
    return {
      undo: countByLabel(undoList, label),
      redo: countByLabel(redo, label),
    };
  }, [goBackTarget, actions]);

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
              busy={busy || goBackTarget != null}
              undoLabel={entry.isRestore ? 'Undo going back' : 'Undo'}
              isTarget={goBackTarget?.actionId === entry.actionId}
              onUndo={(() => {
                if (entry.actionId == null) return undefined;
                // Going back is undone by going back to just before it.
                if (entry.isRestore) {
                  return entry.isNewest && entry.before != null
                    ? () =>
                        setGoBackTarget({
                          actionId: entry.before as number,
                          label: entry.beforeAction
                            ? summarizeAction(entry.beforeAction).label
                            : 'the entry before',
                          at: entry.beforeAction?.at ?? entry.at,
                        })
                    : undefined;
                }
                return entry.undoable
                  ? () => undo(entry.actionId as number, entry.label)
                  : undefined;
              })()}
              onGoBack={
                entry.actionId != null && !entry.isNewest
                  ? () =>
                      setGoBackTarget({
                        actionId: entry.actionId as number,
                        label: entry.label,
                        at: entry.at,
                      })
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
        {goBackTarget && preview && (
          <section
            className="history-confirm"
            role="alertdialog"
            aria-labelledby="history-confirm-title"
          >
            <h4 id="history-confirm-title">
              Go back to how the event was after “{goBackTarget.label}” (
              {formatTime(goBackTarget.at)})?
            </h4>
            {preview.undo.length === 0 && preview.redo.length === 0 ? (
              <p>Nothing would change: the event is already like that.</p>
            ) : (
              <>
                {preview.undo.length > 0 && (
                  <>
                    <p>This takes back everything done after it:</p>
                    <ul>
                      {preview.undo.map(({ label, count }) => (
                        <li key={label}>
                          {count} × {label}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {preview.redo.length > 0 && (
                  <>
                    <p>And brings back what had been undone since:</p>
                    <ul>
                      {preview.redo.map(({ label, count }) => (
                        <li key={label}>
                          {count} × {label}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="history-confirm-note">
                  A backup of the database is saved first, and this step is
                  added to the history, so it can be undone too. Sailor and boat
                  details are not changed.
                </p>
              </>
            )}
            <div className="history-confirm-actions">
              <button
                ref={confirmCancelRef}
                type="button"
                className="btn-outline"
                onClick={() => setGoBackTarget(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => goBack(goBackTarget)}
                disabled={
                  busy ||
                  (preview.undo.length === 0 && preview.redo.length === 0)
                }
              >
                <i
                  className={`fa ${busy ? 'fa-spinner fa-spin' : 'fa-clock-rotate-left'}`}
                  aria-hidden="true"
                />{' '}
                {busy ? 'Going back…' : 'Go back'}
              </button>
            </div>
          </section>
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
