import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function AppModal({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  confirmButtonClass = 'btn-success',
}) {
  const dialogRef = useRef(null);
  const lastFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    lastFocusedRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusables = dialog
      ? [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
      : [];

    if (focusables.length > 0) {
      focusables[0].focus();
    } else if (dialog) {
      dialog.focus();
    }

    const onKeyDown = (event) => {
      if (!dialog) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') return;

      const currentFocusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
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
    <div className="feedback-modal-overlay" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="feedback-modal-title">{title}</h3>
        <div className="feedback-modal-body">{children}</div>
        <div className="feedback-modal-actions">
          <button type="button" className="btn-outline" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmButtonClass}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

AppModal.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  confirmLabel: PropTypes.string,
  cancelLabel: PropTypes.string,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  confirmButtonClass: PropTypes.string,
};

export default AppModal;
