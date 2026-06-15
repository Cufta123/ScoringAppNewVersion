import { toast } from 'react-toastify';
import { requestConfirm } from './confirmController';

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

export const confirmAction = (
  message,
  title = 'Please confirm',
  options = {},
) => {
  const safeString = (value, fallback) =>
    typeof value === 'string' && value.trim() ? value : fallback;

  return requestConfirm({
    title,
    body: message || 'Are you sure you want to continue?',
    confirmLabel: safeString(options?.confirmLabel, 'Confirm'),
    cancelLabel: safeString(options?.cancelLabel, 'Cancel'),
    confirmClassName: safeString(options?.confirmClassName, 'btn-danger'),
  });
};
