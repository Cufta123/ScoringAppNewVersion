import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { queries } from '../api/queries';
import { reportError, reportInfo } from '../utils/userFeedback';
import type { EventRow } from '../types';

/**
 * The event a page is about, as it is saved now: its row in the events list
 * (so a change of its name, dates or settings — an edit, going back in the
 * history — shows at once), found by the id handed over in the router state
 * or, refresh-safe when that state is gone (e.g. after a reload), by the name
 * in the URL. Until the list is read the router state's copy is shown. An
 * event that no longer exists, or a failed lookup by name, is reported and
 * sends the user back to the landing page.
 *
 * Three pages (event, heat race, leaderboard) each carried their own copy of
 * this; it is one hook now.
 */
export default function useRouteEvent(
  eventName: string | undefined,
): EventRow | null {
  const location = useLocation();
  const navigate = useNavigate();
  const handedOver =
    (location.state as { event?: EventRow } | null)?.event || null;
  const events = useQuery(queries.events());

  const listed = events.data?.find((e) =>
    handedOver
      ? e.event_id === handedOver.event_id
      : e.event_name === eventName,
  );
  // Only a lookup by name depends on the list; with the event handed over,
  // a list that cannot be read leaves its copy on screen.
  const lookupFailed = !handedOver && events.isError;
  const notFound = !handedOver && events.isSuccess && !listed;

  useEffect(() => {
    if (lookupFailed) {
      reportError('Could not load event details.', events.error);
      navigate('/');
    } else if (notFound) {
      reportInfo(
        'This event could not be found. It may have been deleted or renamed.',
        'Event not found',
      );
      navigate('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupFailed, notFound, navigate]);

  return listed ?? handedOver;
}
