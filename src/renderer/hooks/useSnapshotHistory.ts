import { useCallback, useState } from 'react';

/**
 * The "recovery backups you saved for this event" list shown under the heats.
 *
 * It is browser-local bookkeeping — the backup files themselves live wherever
 * the user saved them — so it is kept in localStorage, per event, and capped at
 * the five most recent. Every read is defensive: the value can be absent,
 * corrupt, or written by an older version, and a broken list must never stop
 * the heats from rendering.
 */

const MAX_ENTRIES = 5;

export interface SnapshotEntry {
  fileName: string;
  savedAt: string;
}

const storageKeyFor = (eventId: number | string) =>
  `eventSnapshotHistory:${eventId}`;

const isEntry = (value: unknown): value is SnapshotEntry =>
  value != null &&
  typeof (value as SnapshotEntry).fileName === 'string' &&
  typeof (value as SnapshotEntry).savedAt === 'string';

export default function useSnapshotHistory(eventId: number | string) {
  const [history, setHistory] = useState<SnapshotEntry[]>([]);
  const storageKey = storageKeyFor(eventId);

  const load = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      setHistory(Array.isArray(parsed) ? parsed.filter(isEntry) : []);
    } catch (_error) {
      // Unreadable or malformed storage: show no history rather than break.
      setHistory([]);
    }
  }, [storageKey]);

  const remember = useCallback(
    (filePath: string | null | undefined) => {
      const fileName =
        String(filePath || '')
          .split(/[\\/]/)
          .pop() || 'snapshot.json';
      const entry: SnapshotEntry = {
        fileName,
        savedAt: new Date().toISOString(),
      };
      setHistory((previous) => {
        const next = [entry, ...previous].slice(0, MAX_ENTRIES);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (_error) {
          // A full or unavailable store must not fail the backup itself —
          // the file is already written; only this convenience list is lost.
        }
        return next;
      });
    },
    [storageKey],
  );

  return { history, load, remember };
}
