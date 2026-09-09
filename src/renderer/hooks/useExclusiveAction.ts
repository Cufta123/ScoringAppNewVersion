import { useCallback, useRef, useState } from 'react';

/**
 * Runs one async action at a time and reports whether one is in flight.
 *
 * Race-office actions are slow enough to look like nothing happened —
 * redistributing a round, undoing a race, rebuilding heats — and the usual
 * response to a button that appears not to have worked is to press it again.
 * Every one of these is destructive or creates a round, so a second run is not
 * a harmless repeat.
 *
 * The ref is what actually enforces exclusivity: two clicks in the same tick
 * would both read `busy === false` from state, because a `setState` during an
 * event handler has not been applied yet. `busy` exists only to drive the
 * `disabled` attribute, so the user can see why the second click did nothing.
 *
 * Extracted from HeatComponent, where it guarded that component's own actions
 * while the round-level buttons on HeatRacePage had no guard at all.
 */
export default function useExclusiveAction() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const runExclusive = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      try {
        return await fn();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  return { busy, runExclusive };
}
