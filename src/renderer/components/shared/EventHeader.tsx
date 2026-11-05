import React from 'react';
import { formatEventDateRange } from '../../utils/formatDate';
import type { EventRow } from '../../types';

interface EventHeaderProps {
  event: Pick<
    EventRow,
    'event_name' | 'event_location' | 'start_date' | 'end_date'
  >;
  /** The page's own next step, on the right (e.g. "Go to Scoring"). */
  actions?: React.ReactNode;
}

/**
 * The top of every event page (Entries, Scoring, Leaderboard): the event's
 * name, where and when, and the page's own action. Which page is open is
 * the Navbar's highlighted section, so there are no breadcrumbs; the three
 * pages used to have three different headers.
 */
export default function EventHeader({
  event,
  actions = null,
}: EventHeaderProps) {
  const where = String(event.event_location ?? '').trim();
  const when = formatEventDateRange(event.start_date, event.end_date);
  return (
    <header className="event-header">
      <div className="event-header-info">
        <h1>{event.event_name}</h1>
        <p>{[where, when].filter(Boolean).join(' · ')}</p>
      </div>
      {actions && <div className="event-header-actions">{actions}</div>}
    </header>
  );
}
