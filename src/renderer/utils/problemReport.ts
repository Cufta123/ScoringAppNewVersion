/**
 * Opening the problem report form from anywhere (the Navbar button, the
 * crash screen); `ProblemReportHost` listens and shows it. The page that is
 * open tells which event the report is about, through the Navbar.
 */

const OPEN_EVENT = 'iom:open-problem-report';

let currentEventId: number | null = null;

/** Called by the Navbar: the event on screen, or null on the home page. */
export function setReportEventContext(eventId: number | null): void {
  currentEventId = eventId;
}

export function reportEventContext(): number | null {
  return currentEventId;
}

export function requestProblemReport(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onProblemReportRequest(listener: () => void): () => void {
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

/** "2026-11-04T14:30" in local time, as a datetime-local field wants it. */
export function localDateTimeValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
