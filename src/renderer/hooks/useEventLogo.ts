import { useCallback, useEffect, useRef, useState } from 'react';
import { eventDB } from '../api/db';
import { LogoRefusal, prepareLogo } from '../exports/logo';
import { reportError, reportWarning } from '../utils/userFeedback';

/**
 * The event's logo for the exported documents: loaded when the export dialog
 * opens, chosen once per event (shrunk to 600 px and stored with the event),
 * replaced or removed from the dialog. A refused file leaves the stored logo
 * as it was and says why.
 */
export default function useEventLogo(eventId: number, open: boolean) {
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A slow read must not overwrite a logo that was just chosen.
  const changed = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    changed.current = false;
    (async () => {
      try {
        const stored = await eventDB.readEventExportLogo(eventId);
        if (!cancelled && !changed.current) setLogo(stored ?? null);
      } catch (error) {
        if (!cancelled) {
          reportError('Could not read the event logo.', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, open]);

  const save = useCallback(
    async (next: string | null) => {
      await eventDB.saveEventExportLogo(eventId, next);
      changed.current = true;
      setLogo(next);
    },
    [eventId],
  );

  /** Use this picture as the event's logo. */
  const choose = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        await save(await prepareLogo(file));
      } catch (error) {
        if (error instanceof LogoRefusal) {
          reportWarning(error.message, 'Logo not changed');
        } else {
          reportError('Could not save the logo.', error);
        }
      } finally {
        setBusy(false);
      }
    },
    [save],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await save(null);
    } catch (error) {
      reportError('Could not remove the logo.', error);
    } finally {
      setBusy(false);
    }
  }, [save]);

  return { logo, busy, choose, remove };
}
