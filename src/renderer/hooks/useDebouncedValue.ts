import { useEffect, useState } from 'react';

/**
 * `value`, but only after it has stopped changing for `delayMs`. The export
 * dialog rebuilds its preview from this, so ticking several options in a row
 * builds the document once, not once per click.
 */
export default function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
