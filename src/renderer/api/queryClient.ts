import { QueryClient } from '@tanstack/react-query';

/**
 * The renderer's one cache of what the main process answered (TanStack
 * Query), made once at the app root (App.tsx) and once per render in the
 * tests (`__tests__/helpers/renderWithQuery`).
 *
 * The data is local (SQLite behind IPC) and only this window writes it, so:
 *  - an answer stays fresh until a write says otherwise (`staleTime:
 *    Infinity`): every write invalidates what it touched (api/writes.ts), and
 *    nothing is read again just because a page mounted or the window got focus
 *    (that would fight an edit in progress);
 *  - nothing is retried: a failure is told to the user in words (reportError
 *    or the page's own error state), never tried again silently;
 *  - `networkMode: 'always'`: the reads and writes never touch the network,
 *    so they must run on a laptop with no internet (by default TanStack Query
 *    pauses while the browser says it is offline).
 */
export function createQueryClient(
  overrides: { gcTime?: number } = {},
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
        ...(overrides.gcTime !== undefined ? { gcTime: overrides.gcTime } : {}),
      },
      mutations: {
        retry: false,
        networkMode: 'always',
      },
    },
  });
}

export default createQueryClient;
