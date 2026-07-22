import { toast } from 'react-toastify';
import { requestConfirm, type ConfirmChoice } from './confirmController';

export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
}

export interface ConfirmChoiceOptions extends ConfirmOptions {
  extraLabel?: string;
  extraClassName?: string;
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
  // Keep the raw technical detail (SQLite/IPC/JS messages) for diagnosis, but
  // never show it to the user — a race officer needs a plain-language message,
  // not an error code. The detail goes to the console/devtools instead.
  if (error !== undefined) {
    // eslint-disable-next-line no-console
    console.error(title ?? 'Application error', error, getErrorMessage(error));
  }
  const message =
    title && title.trim() ? title : 'Something went wrong. Please try again.';
  // Errors stay on screen until dismissed so slower readers never miss them.
  toast.error(message, { autoClose: false, closeOnClick: true });
};

export const reportInfo = (message?: string, title = 'Notice'): void => {
  const body = message || 'Done.';
  toast.info(`${title}: ${body}`);
};

// Blocking validation the user must act on (e.g. "these sail numbers are not in
// this heat", "some boats are not scored yet"). Unlike reportInfo these do NOT
// auto-dismiss, so a slower reader has time to read multi-step instructions
// before they vanish. `white-space: pre-line` on the toast body (see App.css)
// keeps the numbered "1) … 2) …" steps on separate lines.
export const reportWarning = (
  message?: string,
  title = 'Please check',
): void => {
  const body = message || 'Please review your input.';
  toast.warning(`${title}: ${body}`, { autoClose: false, closeOnClick: true });
};

const safeString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value : fallback;

export const confirmAction = async (
  message?: string,
  title = 'Please confirm',
  options: ConfirmOptions = {},
): Promise<boolean> => {
  const choice = await requestConfirm({
    title,
    body: message || 'Are you sure you want to continue?',
    confirmLabel: safeString(options?.confirmLabel, 'Confirm'),
    cancelLabel: safeString(options?.cancelLabel, 'Cancel'),
    // Default to the neutral "proceed" colour (matching AppModal). Red is
    // reserved for genuinely destructive confirms, which opt in via
    // confirmClassName: 'btn-danger'. This stops benign confirms (start final
    // series, create new heats, continue anyway…) from signalling danger.
    confirmClassName: safeString(options?.confirmClassName, 'btn-success'),
  });
  return choice === 'confirm';
};

/**
 * Like confirmAction but for a three-way dialog (e.g. a primary action, an
 * alternative middle action, and Cancel). Resolves to which button was pressed:
 * 'confirm', 'extra', or 'cancel' (also returned on Escape/backdrop dismiss).
 */
export const confirmChoice = (
  message?: string,
  title = 'Please confirm',
  options: ConfirmChoiceOptions = {},
): Promise<ConfirmChoice> =>
  requestConfirm({
    title,
    body: message || 'Are you sure you want to continue?',
    confirmLabel: safeString(options?.confirmLabel, 'Confirm'),
    cancelLabel: safeString(options?.cancelLabel, 'Cancel'),
    confirmClassName: safeString(options?.confirmClassName, 'btn-success'),
    extraLabel: options?.extraLabel,
    extraClassName: safeString(options?.extraClassName, 'btn-danger'),
  });
