import { useQuery } from '@tanstack/react-query';
import { queries, useReportQueryError } from '../api/queries';

/**
 * Where the event stands and what the race office may do now
 * (`readEventStatus`, regatta-core's `eventStatus`): the series, the round,
 * its heats, the one next step, and every round and heat action with the
 * reason it is refused. The screens show it and decide nothing about rounds
 * or series themselves. Read under the event's key, so every write to the
 * event reads it again (the one refresh rule).
 *
 * `title`: the error shown when the read fails (null: the caller says it).
 */
export default function useEventStatus(
  eventId: number | null | undefined,
  title: string | null = 'Could not read where the event stands.',
) {
  const query = useQuery({
    ...queries.eventStatus(eventId ?? -1),
    enabled: eventId != null,
  });
  useReportQueryError(query, title);
  return {
    status: query.isError ? null : (query.data ?? null),
    loadFailed: query.isError,
  };
}
