import React, { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface AppModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmClassName?: string;
  // Optional third action, rendered between Cancel and Confirm.
  extraLabel?: string;
  extraClassName?: string;
  onExtra?: () => void;
}

function AppModal({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  confirmClassName = 'btn-success',
  extraLabel = undefined,
  extraClassName = 'btn-danger',
  onExtra = undefined,
}: AppModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusables = dialog
      ? [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      : [];

    if (focusables.length > 0) {
      focusables[0].focus();
    } else if (dialog) {
      dialog.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!dialog) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

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
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onClick={(event) => {
        // Dismiss only when the backdrop itself is clicked, not when a click
        // bubbles up from inside the dialog. Keyboard dismissal (Escape) and
        // focus trapping are handled at the document level above.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h3 className="feedback-modal-title">{title}</h3>
        <div className="feedback-modal-body">{children}</div>
        <div className="feedback-modal-actions">
          <button type="button" className="btn-outline" onClick={onCancel}>
            {cancelLabel}
          </button>
          {extraLabel && onExtra && (
            <button type="button" className={extraClassName} onClick={onExtra}>
              {extraLabel}
            </button>
          )}
          <button
            type="button"
            className={confirmClassName}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppModal;
