import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { eventDB } from '../api/db';
import { reportError, reportInfo } from '../utils/userFeedback';
import type { EventRow } from '../types';

/**
 * The event a page is about: the one handed over in the router state, or —
 * refresh-safe, when that state is gone (e.g. after a reload) — the one named
 * in the URL, looked up by name. An event that no longer exists, or a failed
 * lookup, is reported and sends the user back to the landing page.
 *
 * Three pages (event, heat race, leaderboard) each carried their own copy of
 * this; it is one hook now.
 */
export default function useRouteEvent(
  eventName: string | undefined,
): EventRow | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRow | null>(
    (location.state as { event?: EventRow } | null)?.event || null,
  );

  useEffect(() => {
    if (event) return undefined;
    let isActive = true;

    const findEventByName = async () => {
      try {
        const events = await eventDB.readAllEvents();
        if (!isActive) return;
        const match = (events || []).find((e) => e.event_name === eventName);
        if (match) {
          setEvent(match);
        } else {
          reportInfo(
            'This event could not be found. It may have been deleted or renamed.',
            'Event not found',
          );
          navigate('/');
        }
      } catch (error) {
        if (!isActive) return;
        reportError('Could not load event details.', error);
        navigate('/');
      }
    };

    findEventByName();
    return () => {
      isActive = false;
    };
  }, [event, eventName, navigate]);

  return event;
}
