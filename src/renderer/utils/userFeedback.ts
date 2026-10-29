import React from 'react';
import { toast } from 'react-toastify';
import type { ToastOptions } from 'react-toastify';
import ToastMessage from '../components/shared/ToastMessage';
import { requestConfirm, type ConfirmChoice } from './confirmController';
import {
  isTechnicalText,
  messageOf,
  newErrorRef,
  stripIpcWrapping,
  unexpectedMessage,
} from '../../shared/errors/explainError';

export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
}

export interface ConfirmChoiceOptions extends ConfirmOptions {
  extraLabel?: string;
  extraClassName?: string;
}

/** The error's own text, without Electron's "Error invoking remote method". */
export const getErrorMessage = (error: unknown): string =>
  stripIpcWrapping(messageOf(error)) || 'Unexpected error. Please try again.';

/**
 * The reason a refusal gives, worded for the person at the screen, or null
 * when the message is technical. The main process already turns its own
 * failures into plain words (shared/errors/explainError); this keeps a
 * technical message from the window itself off the screen.
 */
export const plainReason = (error: unknown): string | null => {
  // A TypeError, RangeError, … is a fault in the app whatever it says; the
  // app's own refusals (and everything from the main process) are plain Errors.
  if (
    error instanceof Error &&
    Object.getPrototypeOf(error) !== Error.prototype
  ) {
    return null;
  }
  const reason = stripIpcWrapping(messageOf(error));
  if (!reason || reason.length > 600) return null;
  if (isTechnicalText(reason)) return null;
  return reason;
};

/** Send an error of the window itself to the error log (best effort). */
export const logToErrorLog = (
  where: string,
  error: unknown,
  ref?: string,
): void => {
  try {
    window.electron?.appEvents?.logError({
      where,
      message: messageOf(error) || String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ref,
    });
  } catch {
    // The log is a convenience; never fail the screen over it.
  }
};

/**
 * Why something failed, in words the user can act on: the reason the app
 * gave, or — for a fault in the app — "unexpected problem" with a code that
 * is also written, with the details, to the error log.
 */
export const describeError = (error: unknown, where = 'window'): string => {
  const reason = plainReason(error);
  if (reason) return reason;
  const ref = newErrorRef();
  logToErrorLog(where, error, ref);
  return unexpectedMessage(ref);
};

type ToastKind = 'error' | 'warning' | 'info';

/**
 * A stable id for a toast: the same kind, title and body is the same toast.
 * Clicking Submit five times then shows one warning, not five.
 */
export const toastKey = (kind: ToastKind, title: string, body = ''): string =>
  `${kind}|${title}|${body}`;

/**
 * Show a toast with a bold title and the explanation under it. An identical
 * toast that is still on screen is refreshed instead of stacked.
 */
const showToast = (
  kind: ToastKind,
  title: string,
  body: string | undefined,
  options: ToastOptions,
  toastId = toastKey(kind, title, body),
): void => {
  const content = React.createElement(ToastMessage, { title, body });
  if (toast.isActive(toastId)) {
    toast.update(toastId, { render: content, ...options });
    return;
  }
  toast[kind](content, { ...options, toastId });
};

export const reportError = (
  title: string | undefined,
  error?: unknown,
): void => {
  // The raw detail stays in the console and the error log; the screen gets
  // what happened (the title) and why (the reason, in plain words).
  if (error !== undefined) {
    // eslint-disable-next-line no-console
    console.error(title ?? 'Application error', error);
  }
  const heading =
    title && title.trim() ? title : 'Something went wrong. Please try again.';
  const reason =
    error === undefined ? null : describeError(error, heading.slice(0, 200));
  // Errors stay on screen until dismissed so slower readers never miss them.
  showToast(
    'error',
    heading,
    reason && reason !== heading ? reason : undefined,
    { autoClose: false, closeOnClick: true },
  );
};

export const reportInfo = (message?: string, title = 'Notice'): void => {
  showToast('info', title, message || 'Done.', {});
};

// Blocking validation the user must act on (e.g. "these sail numbers are not in
// this heat", "some boats are not scored yet"). Unlike reportInfo these do NOT
// auto-dismiss, so a slower reader has time to read multi-step instructions
// before they vanish. `white-space: pre-line` on the toast body (see App.css)
// keeps the numbered "1) … 2) …" steps on separate lines.
export const reportWarning = (
  message?: string,
  title = 'Please check',
  { toastId }: { toastId?: string } = {},
): void => {
  showToast(
    'warning',
    title,
    message || 'Please review your input.',
    { autoClose: false, closeOnClick: true },
    toastId,
  );
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
