import { toast } from 'react-toastify';
import { requestConfirm } from './confirmController';

export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
}

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return 'Unexpected error. Please try again.';
};

export const reportError = (
  title: string | undefined,
  error?: unknown,
): void => {
  const details = getErrorMessage(error);
  const message = title ? `${title}: ${details}` : details;
  // Errors stay on screen until dismissed so slower readers never miss them.
  toast.error(message, { autoClose: false, closeOnClick: true });
};

export const reportInfo = (message?: string, title = 'Notice'): void => {
  const body = message || 'Done.';
  toast.info(`${title}: ${body}`);
};

export const confirmAction = (
  message?: string,
  title = 'Please confirm',
  options: ConfirmOptions = {},
): Promise<boolean> => {
  const safeString = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value : fallback;

  return requestConfirm({
    title,
    body: message || 'Are you sure you want to continue?',
    confirmLabel: safeString(options?.confirmLabel, 'Confirm'),
    cancelLabel: safeString(options?.cancelLabel, 'Cancel'),
    confirmClassName: safeString(options?.confirmClassName, 'btn-danger'),
  });
};
