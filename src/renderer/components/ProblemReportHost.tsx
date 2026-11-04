import React, { useCallback, useEffect, useRef, useState } from 'react';
import ProblemReportDialog from './ProblemReportDialog';
import { problemReportDB } from '../api/db';
import {
  onProblemReportRequest,
  reportEventContext,
} from '../utils/problemReport';

interface OpenReport {
  eventId: number | null;
  screenshot: string | null;
  route: string;
}

/**
 * Shows the problem report form when asked: the Navbar button, the crash
 * screen (requestProblemReport) or Help > Report a Problem… in the app menu.
 * The screen is captured first, so the picture shows what the user saw, not
 * the form.
 */
export default function ProblemReportHost() {
  const [open, setOpen] = useState<OpenReport | null>(null);
  const opening = useRef(false);

  const openReport = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    let screenshot: string | null = null;
    try {
      screenshot = await problemReportDB.captureProblemScreenshot();
    } catch {
      // The report still goes, just without the picture.
    }
    setOpen(
      (current) =>
        current ?? {
          eventId: reportEventContext(),
          screenshot,
          route: window.location.hash || '#/',
        },
    );
    opening.current = false;
  }, []);

  useEffect(() => {
    const stopLocal = onProblemReportRequest(openReport);
    const stopMenu = window.electron?.appEvents?.onOpenProblemReport?.(() => {
      openReport();
    });
    return () => {
      stopLocal();
      stopMenu?.();
    };
  }, [openReport]);

  if (!open) return null;
  return (
    <ProblemReportDialog
      eventId={open.eventId}
      screenshot={open.screenshot}
      route={open.route}
      onClose={() => setOpen(null)}
    />
  );
}
