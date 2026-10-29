import { useCallback, useEffect, useRef, useState } from 'react';

/** localStorage key of one event's options for one kind of document. */
export const exportOptionsKey = (eventId: number, kind: string): string =>
  `iom.export.${eventId}.${kind}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The remembered options laid over the defaults. Only a remembered value of
 * the same kind as the default is taken (a number where a switch belongs is
 * ignored), nested groups are merged, and anything the defaults do not know
 * is dropped, so an old or damaged entry can never break the dialog.
 */
export const mergeStoredOptions = <T>(defaults: T, stored: unknown): T => {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) return defaults;
  const merged: Record<string, unknown> = { ...defaults };
  Object.keys(defaults).forEach((key) => {
    const fallback = defaults[key];
    const value = stored[key];
    if (value === undefined) return;
    if (isPlainObject(fallback)) {
      merged[key] = mergeStoredOptions(fallback, value);
    } else if (Array.isArray(fallback)) {
      if (Array.isArray(value)) merged[key] = value;
    } else if (fallback === null || typeof value === typeof fallback) {
      merged[key] = value;
    }
  });
  return merged as T;
};

const readStored = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Storage is a convenience: blocked, full or damaged, the defaults apply.
    return null;
  }
};

const writeStored = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Never required.
  }
};

/**
 * The options of an export dialog, remembered per event and document type in
 * localStorage (never required: without it the defaults are used).
 */
export default function useExportOptions<T>(
  eventId: number,
  kind: string,
  defaults: T,
): [T, (update: T | ((current: T) => T)) => void] {
  const key = exportOptionsKey(eventId, kind);
  const defaultsRef = useRef(defaults);
  const [options, setOptions] = useState<T>(() =>
    mergeStoredOptions(defaults, readStored(key)),
  );

  // Another event or document type: read its options.
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setOptions(mergeStoredOptions(defaultsRef.current, readStored(key)));
  }, [key]);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setOptions((current) => {
        const value =
          typeof next === 'function' ? (next as (c: T) => T)(current) : next;
        writeStored(key, value);
        return value;
      });
    },
    [key],
  );

  return [options, update];
}
