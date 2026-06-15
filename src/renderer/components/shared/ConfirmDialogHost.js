import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { registerConfirmHandler } from '../../utils/confirmController';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Renders confirmation dialogs requested via `confirmAction(...)`. Only one
// dialog is shown at a time; concurrent requests resolve to `false`.
export default function ConfirmDialogHost() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);
  const dialogRef = useRef(null);
  const previousActiveRef = useRef(null);

  const close = useCallback((value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (resolve) {
      resolve(value);
    }
  }, []);

  useEffect(() => {
    const handler = (incoming) =>
      new Promise((resolve) => {
        // A second request while one is open is rejected rather than queued.
        if (resolverRef.current) {
          resolve(false);
          return;
        }
        previousActiveRef.current = document.activeElement;
        resolverRef.current = resolve;
        setRequest(incoming);
      });

    return registerConfirmHandler(handler);
  }, []);

  // Move focus into the dialog when it opens and restore it on close.
  useEffect(() => {
    if (!request) {
      const previous = previousActiveRef.current;
      previousActiveRef.current = null;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
      return undefined;
    }

    const dialog = dialogRef.current;
    const focusables = dialog
      ? [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
      : [];
    (focusables[0] || dialog)?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog || focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [request, close]);

  if (!request) {
    return null;
  }

  const {
    title = 'Please confirm',
    body = 'Are you sure you want to continue?',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmClassName = 'btn-danger',
  } = request;

  return createPortal(
    // Backdrop click is a mouse convenience; the dialog is fully keyboard
    // operable (Escape closes, Tab is trapped) via the handler above.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close(false);
        }
      }}
    >
      <div
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        tabIndex={-1}
      >
        <h3 className="feedback-modal-title">{title}</h3>
        <p className="feedback-modal-body">{body}</p>
        <div className="feedback-modal-actions">
          <button
            type="button"
            className="btn-outline"
            onClick={() => close(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmClassName}
            onClick={() => close(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
