import { toast } from 'react-toastify';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export const getErrorMessage = (error) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unexpected error. Please try again.';
};

export const reportError = (title, error) => {
  const details = getErrorMessage(error);
  const message = title ? `${title}: ${details}` : details;
  // Errors stay on screen until dismissed so slower readers never miss them.
  toast.error(message, { autoClose: false, closeOnClick: true });
};

export const reportInfo = (message, title = 'Notice') => {
  const body = message || 'Done.';
  toast.info(`${title}: ${body}`);
};

const buildConfirmDialog = ({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmClassName = 'btn-danger',
}) => {
  const overlay = document.createElement('div');
  overlay.className = 'feedback-modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'feedback-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);

  const heading = document.createElement('h3');
  heading.className = 'feedback-modal-title';
  heading.textContent = title;

  const messageNode = document.createElement('p');
  messageNode.className = 'feedback-modal-body';
  messageNode.textContent = body;

  const actions = document.createElement('div');
  actions.className = 'feedback-modal-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn-outline';
  cancelButton.textContent = cancelLabel;

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = confirmClassName;
  confirmButton.textContent = confirmLabel;

  actions.append(cancelButton, confirmButton);
  dialog.append(heading, messageNode, actions);
  overlay.append(dialog);

  return { overlay, cancelButton, confirmButton };
};

export const confirmAction = (message, title = 'Please confirm', options = {}) => {
  const body = message || 'Are you sure you want to continue?';
  const confirmLabel =
    typeof options?.confirmLabel === 'string' && options.confirmLabel.trim()
      ? options.confirmLabel
      : 'Confirm';
  const cancelLabel =
    typeof options?.cancelLabel === 'string' && options.cancelLabel.trim()
      ? options.cancelLabel
      : 'Cancel';
  const confirmClassName =
    typeof options?.confirmClassName === 'string' &&
    options.confirmClassName.trim()
      ? options.confirmClassName
      : 'btn-danger';

  if (typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const { overlay, cancelButton, confirmButton } = buildConfirmDialog({
      title,
      body,
      confirmLabel,
      cancelLabel,
      confirmClassName,
    });
    const dialog = overlay.querySelector('.feedback-modal');
    const previousActive = document.activeElement;

    let cleanup = () => {};

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(false);
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;

      const focusables = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    cleanup = (value) => {
      document.removeEventListener('keydown', onKeyDown);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus();
      }
      resolve(value);
    };

    cancelButton.addEventListener('click', () => cleanup(false));
    confirmButton.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);
    const focusables = dialog
      ? [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
      : [];
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      confirmButton.focus();
    }
  });
};
