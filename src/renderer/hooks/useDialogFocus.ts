import { useEffect, useRef, type RefObject } from 'react';

/** What Tab may land on inside a dialog. */
const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const focusablesIn = (dialog: HTMLElement): HTMLElement[] =>
  [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.closest('[hidden]'),
  );

/**
 * The dialogs open right now, oldest first. A confirmation can open over the
 * history or help dialog; only the newest one answers Escape and Tab, so one
 * Escape closes one dialog and Tab never walks into the dialog underneath.
 */
const openDialogs: symbol[] = [];

/**
 * Put focus back inside `dialog` if it was lost, for example because the
 * button that had it was removed after its action (the browser then leaves
 * focus on the page body). Focus goes to `fallback`, or to the dialog itself.
 * Does nothing while focus is on a working control inside the dialog.
 */
export function refocusIfLost(
  dialog: HTMLElement | null,
  fallback?: HTMLElement | null,
): void {
  if (!dialog) return;
  const active = document.activeElement as HTMLElement | null;
  const lost =
    !active ||
    active === document.body ||
    !dialog.contains(active) ||
    (active as HTMLButtonElement).disabled === true;
  if (lost) (fallback ?? dialog).focus();
}

/**
 * The one keyboard behaviour of every dialog (confirmations, help, history,
 * score explanation, the RDG2 picker): while `open`
 *  - focus moves into the dialog (to `initialFocusRef` if given, else the first
 *    control, else the dialog itself),
 *  - Tab and Shift+Tab cycle inside it and never reach the page behind, even
 *    when focus was lost to the page body,
 *  - Escape calls `onClose` (only for the newest of stacked dialogs),
 *  - when it closes, the element that had focus before is given it back.
 *
 * `dialogRef` must point at an element with tabIndex={-1}. `onClose` may change
 * on every render; it never re-runs the effect or takes focus again.
 */
export default function useDialogFocus(
  dialogRef: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const token = Symbol('dialog');
    openDialogs.push(token);
    const lastFocused = document.activeElement as HTMLElement | null;

    const initial = initialFocusRef?.current ?? focusablesIn(dialog)[0];
    (initial ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== token) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = focusablesIn(dialog);
      if (focusables.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!active || !dialog.contains(active) || active === dialog) {
        // Focus is on the page (or on the dialog box itself): enter at the
        // end Tab was heading for.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
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
      const at = openDialogs.indexOf(token);
      if (at >= 0) openDialogs.splice(at, 1);
      if (lastFocused?.isConnected && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
    };
    // dialogRef and initialFocusRef are refs: their identity does not change.
  }, [open, dialogRef, initialFocusRef]);
}
