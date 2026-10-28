import { useEffect, useRef, type RefObject } from 'react';

/**
 * Keyboard behaviour shared by the dialogs: while `active`, focus moves to
 * `focusRef`, Escape calls `onEscape`, and the element that had focus before
 * is given it back on close.
 */
export default function useModalFocus(
  active: boolean,
  focusRef: RefObject<HTMLElement>,
  onEscape: () => void,
): void {
  // The latest handler without re-running the effect (and re-taking focus)
  // every time the caller passes a new function.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const lastFocused = document.activeElement as HTMLElement | null;
    focusRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (typeof lastFocused?.focus === 'function') lastFocused.focus();
    };
  }, [active, focusRef]);
}
