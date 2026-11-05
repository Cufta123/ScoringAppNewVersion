/**
 * @testing-library/react with the app's query cache around everything
 * rendered: `render` and `renderHook` put the component (or hook) in a
 * QueryClientProvider with a NEW client each time, made with the app's own
 * defaults (api/queryClient.ts: no retries, nothing refetched on focus), so
 * no answer is cached from one test to the next. The client is on the result
 * (`queryClient`) for a test that changes the data underneath, as a write
 * elsewhere in the app would: `queryClient.invalidateQueries(...)`.
 *
 * Import from here instead of '@testing-library/react'; everything else is
 * re-exported unchanged.
 */
import React from 'react';
import * as rtl from '@testing-library/react';
import {
  QueryClientProvider,
  notifyManager,
  type QueryClient,
} from '@tanstack/react-query';
import { createQueryClient } from '../../renderer/api/queryClient';

export * from '@testing-library/react';

// TanStack Query hands an answer to the components on a timer (setTimeout 0)
// in the app. Here it is handed over in the microtask after the read
// resolves, when the hand-written hooks the tests were written against set
// their state: a test that waits for the IPC call and then acts sees the data.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

/** A client as the app makes it; kept until the test ends (no gc timers). */
export const createTestQueryClient = (): QueryClient =>
  createQueryClient({ gcTime: Infinity });

type Wrapper = React.JSXElementConstructor<{ children: React.ReactNode }>;

function withClient(client: QueryClient, Inner?: Wrapper) {
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {Inner ? <Inner>{children}</Inner> : children}
      </QueryClientProvider>
    );
  };
}

export function render(
  ui: React.ReactElement,
  options: rtl.RenderOptions & { queryClient?: QueryClient } = {},
) {
  const { queryClient = createTestQueryClient(), wrapper, ...rest } = options;
  return {
    ...rtl.render(ui, {
      ...rest,
      wrapper: withClient(queryClient, wrapper as Wrapper | undefined),
    }),
    queryClient,
  };
}

/**
 * Wait until every read the client started has come back and been handed to
 * the components (TanStack Query tells them on a timer, not at once).
 */
export async function waitForQueries(client: QueryClient): Promise<void> {
  await rtl.waitFor(() => {
    if (client.isFetching() > 0) throw new Error('queries still loading');
  });
  await rtl.act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

export function renderHook<Result, Props>(
  callback: (props: Props) => Result,
  options: rtl.RenderHookOptions<Props> & { queryClient?: QueryClient } = {},
) {
  const { queryClient = createTestQueryClient(), wrapper, ...rest } = options;
  return {
    ...rtl.renderHook(callback, {
      ...rest,
      wrapper: withClient(queryClient, wrapper as Wrapper | undefined),
    }),
    queryClient,
  };
}
