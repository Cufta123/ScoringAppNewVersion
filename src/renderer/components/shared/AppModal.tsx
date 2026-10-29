import React, { useRef } from 'react';
import useDialogFocus from '../../hooks/useDialogFocus';

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
  // Focus in, Tab trapped, Escape cancels, focus handed back on close.
  useDialogFocus(dialogRef, open, onCancel);

  if (!open) return null;

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onClick={(event) => {
        // Dismiss only when the backdrop itself is clicked, not when a click
        // bubbles up from inside the dialog. Keyboard dismissal (Escape) and
        // focus trapping are handled by useDialogFocus.
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
