/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import useExclusiveAction from '../renderer/hooks/useExclusiveAction';

function Harness({ action }) {
  const { busy, runExclusive } = useExclusiveAction();
  return (
    <button
      type="button"
      disabled={busy}
      // runExclusive rethrows: swallowing a failure would hide it from the
      // caller's own error reporting. Real call sites catch inside `action`,
      // so this harness stands in for that.
      onClick={() => {
        runExclusive(action).catch(() => {});
      }}
    >
      {busy ? 'Working' : 'Go'}
    </button>
  );
}

describe('useExclusiveAction', () => {
  // A promise the test settles by hand, so assertions can run mid-flight.
  const deferred = () => {
    let settle;
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    return { promise, resolve: settle };
  };

  it('ignores a second click while the first is still running', async () => {
    const gate = deferred();
    const action = jest.fn(() => gate.promise);
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));

    expect(action).toHaveBeenCalledTimes(1);
    gate.resolve();
    await waitFor(() => {
      expect(screen.getByRole('button')).toBeEnabled();
    });
  });

  it('blocks a same-tick double click, which state alone would not', async () => {
    // Two clicks dispatched before React applies setBusy(true) both read
    // busy === false. Only the ref catches this, and it is the shape a real
    // double-click takes.
    const gate = deferred();
    const action = jest.fn(() => gate.promise);
    render(<Harness action={action} />);

    const button = screen.getByRole('button');
    button.click();
    button.click();
    button.click();

    expect(action).toHaveBeenCalledTimes(1);
    gate.resolve();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('disables the trigger while running and re-enables it after', async () => {
    const gate = deferred();
    render(<Harness action={() => gate.promise} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeDisabled();
    });
    expect(screen.getByRole('button')).toHaveTextContent('Working');

    gate.resolve();
    await waitFor(() => {
      expect(screen.getByRole('button')).toBeEnabled();
    });
  });

  it('re-enables the trigger when the action rejects', async () => {
    // Otherwise one failure would leave the button dead for the rest of the
    // session, which is worse than the double-click it prevents.
    const action = jest.fn(() => Promise.reject(new Error('nope')));
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  });

  it('passes the action result through', async () => {
    let seen;
    function ResultHarness() {
      const { runExclusive } = useExclusiveAction();
      return (
        <button
          type="button"
          onClick={async () => {
            seen = await runExclusive(async () => 'done');
          }}
        >
          Go
        </button>
      );
    }
    render(<ResultHarness />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(seen).toBe('done'));
  });
});
