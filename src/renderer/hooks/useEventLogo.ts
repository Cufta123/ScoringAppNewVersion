import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eventDB } from '../api/db';
import { queries, useReportQueryError } from '../api/queries';
import { useWrite } from '../api/writes';
import { LogoRefusal, prepareLogo } from '../exports/logo';
import { reportError, reportWarning } from '../utils/userFeedback';

/**
 * The event's logo for the exported documents: read when the export dialog
 * opens, chosen once per event (shrunk to 600 px and stored with the event),
 * replaced or removed from the dialog. A refused file leaves the stored logo
 * as it was and says why. A change is read back through the query cache
 * before the dialog shows it, so a slow read can never overwrite it.
 */
export default function useEventLogo(eventId: number, open: boolean) {
  const query = useQuery({ ...queries.exportLogo(eventId), enabled: open });
  useReportQueryError(query, 'Could not read the event logo.');
  const logo = query.data ?? null;
  const [busy, setBusy] = useState(false);
  const save = useWrite(
    (next: string | null) => eventDB.saveEventExportLogo(eventId, next),
    { eventId },
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
