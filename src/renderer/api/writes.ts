import { useCallback } from 'react';
import {
  useMutation,
  useQueryClient,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

/**
 * THE refresh rule of the renderer: a write says what it changed, and once it
 * has succeeded everything read from that is invalidated (the queries on
 * screen are read again at once, the others when next shown). No screen
 * reloads itself by hand.
 *
 *  - `{ eventId }`: anything about that event (`['event', eventId, …]`) and
 *    the events list (its rows carry flags worked out from the races).
 *  - `{ eventId, onFile: true }`: also the sailors, boats and clubs on file
 *    (entering a sailor can add a club or a boat).
 *  - `'events'`: the events list only (a new event has nothing else yet).
 *  - `'everything'`: an import, a restore from a file, a sailor's details
 *    (shown in every event).
 *
 * After an undo or a go-back in the history, a restore or an import, the whole
 * event (or everything) is invalidated the same way; a screen that is editing
 * keeps its draft (see useLeaderboardEdit: a change underneath an edit makes
 * Save refuse, it never replaces the draft).
 */
export type Affected =
  | { eventId: number | null | undefined; onFile?: boolean }
  | 'events'
  | 'everything';

export async function invalidateAffected(
  queryClient: QueryClient,
  affected: Affected,
): Promise<void> {
  if (affected === 'everything') {
    await queryClient.invalidateQueries();
    return;
  }
  const keys: QueryKey[] = [queryKeys.events()];
  if (affected !== 'events') {
    if (affected.eventId != null) keys.push(queryKeys.event(affected.eventId));
    if (affected.onFile) keys.push(queryKeys.onFile());
  }
  await Promise.all(
    keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

/**
 * A write through TanStack Query's useMutation: `write(...args)` resolves
 * once it has succeeded AND what it affected has been read again (so the
 * caller's next line sees the new state); a failure rejects, as the IPC call
 * did, and invalidates nothing. `affected` may depend on the arguments or the
 * result.
 */
export function useWrite<TArgs extends unknown[], TResult>(
  write: (...args: TArgs) => Promise<TResult>,
  affected: Affected | ((result: TResult, args: TArgs) => Affected),
): (...args: TArgs) => Promise<TResult> {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: (args: TArgs) => write(...args),
    onSuccess: (result, args) =>
      invalidateAffected(
        queryClient,
        typeof affected === 'function' ? affected(result, args) : affected,
      ),
  });
  return useCallback((...args: TArgs) => mutateAsync(args), [mutateAsync]);
}

/** Read again now what an event's screens show (e.g. a list found out of date). */
export function useRefreshEvent(): (eventId: number) => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    (eventId: number) => invalidateAffected(queryClient, { eventId }),
    [queryClient],
  );
}

/**
 * The answer as it is now, for a check made just before a write (a name
 * already taken, a race already sailed): read again whatever the cache holds,
 * and keep it there for the screens.
 */
export function useReadNow() {
  const queryClient = useQueryClient();
  return useCallback(
    <TData, TKey extends QueryKey>(
      options: FetchQueryOptions<TData, Error, TData, TKey>,
    ): Promise<TData> => queryClient.fetchQuery({ ...options, staleTime: 0 }),
    [queryClient],
  );
}
