import { useEffect, useRef } from 'react';

// Something outside a page changed an event's results (an undo from the
// history dialog, which lives in the navbar). Pages showing that event's data
// listen and reload it.

const EVENT_NAME = 'scoring-app:event-data-changed';

export function notifyEventDataChanged(eventId: number): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { eventId } }));
}

/** Call `reload` whenever another part of the app changes `eventId`'s data. */
export function useEventDataChanged(
  eventId: number | null | undefined,
  reload: () => void,
): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (eventId == null) return undefined;
    const onChange = (event: Event) => {
      const { detail } = event as CustomEvent<{ eventId: number }>;
      if (Number(detail?.eventId) === Number(eventId)) reloadRef.current();
    };
    window.addEventListener(EVENT_NAME, onChange);
    return () => window.removeEventListener(EVENT_NAME, onChange);
  }, [eventId]);
}
