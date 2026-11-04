/**
 * Help > Report a problem: the screenshot taken before the form opens, and
 * sending the report (see functions/problemReport.ts and
 * functions/problemReportOutbox.ts).
 */
import { BrowserWindow, app, net, screen } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import handle from './handle';
import { db, dbPath } from '../../../public/Database/DBManager';
import { errorLogDir, logError } from '../errorLog';
import { buildProblemReport } from '../functions/problemReport';
import {
  flushOutbox,
  saveToOutbox,
  sendFromOutbox,
  type Fetcher,
} from '../functions/problemReportOutbox';
import { reportEndpoint } from '../functions/problemReportConfig';
import {
  newReportId,
  type ProblemReportRequest,
  type ProblemReportResult,
} from '../../shared/problemReport';

/** Next to the database, like the backups and the error log. */
export const problemReportOutboxDir = (): string =>
  path.join(path.dirname(dbPath), 'problem-reports');

/** Electron's own fetch: it goes through the computer's proxy settings. */
const electronFetch: Fetcher = (url, { body, ...init }) =>
  net.fetch(url, { ...init, body: new Blob([new Uint8Array(body)]) });

const RETRY_EVERY_MS = 10 * 60 * 1000;

/** Send whatever waits in the outbox; never fails the caller. */
const flushInBackground = () => {
  flushOutbox(problemReportOutboxDir(), reportEndpoint(), electronFetch).catch(
    (error) => logError('sending saved problem reports', error),
  );
};

/** Retry saved reports shortly after start-up, then every 10 minutes. */
export function startProblemReportOutbox(): void {
  setTimeout(flushInBackground, 30_000).unref?.();
  setInterval(flushInBackground, RETRY_EVERY_MS).unref?.();
}

handle('captureProblemScreenshot', async (event: IpcMainInvokeEvent) => {
  const image = await event.sender.capturePage();
  if (image.isEmpty()) return null;
  const { width } = image.getSize();
  // A 4K screen gives a 10 MB picture; 1600 px wide is plenty to read it.
  const fitted = width > 1600 ? image.resize({ width: 1600 }) : image;
  return `data:image/jpeg;base64,${fitted.toJPEG(80).toString('base64')}`;
});

/** The app and the computer, for the developer. Each part best effort. */
const systemInfo = (event: IpcMainInvokeEvent): Record<string, unknown> => {
  const info: Record<string, unknown> = {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${os.type()} ${os.release()}`,
    arch: process.arch,
    locale: app.getLocale(),
    memoryGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeMemoryGB: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    appRunningMinutes: Math.round(process.uptime() / 60),
  };
  const tryAdd = (key: string, read: () => unknown) => {
    try {
      info[key] = read();
    } catch {
      // Left out.
    }
  };
  tryAdd('osVersion', () => os.version());
  tryAdd('displays', () =>
    screen.getAllDisplays().map((display) => ({
      size: `${display.size.width}x${display.size.height}`,
      scale: display.scaleFactor,
    })),
  );
  tryAdd('window', () => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const { width, height } = window.getBounds();
    return { size: `${width}x${height}`, maximized: window.isMaximized() };
  });
  tryAdd(
    'databaseMB',
    () => Math.round((fs.statSync(dbPath).size / 1024 ** 2) * 10) / 10,
  );
  tryAdd('databaseVersion', () => db.pragma('user_version', { simple: true }));
  tryAdd('events', () => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM Events').get() as {
      count: number;
    };
    return row.count;
  });
  return info;
};

handle(
  'sendProblemReport',
  async (
    event,
    request: ProblemReportRequest,
  ): Promise<ProblemReportResult> => {
    const reportId = newReportId();
    const payload = buildProblemReport(request, {
      reportId,
      system: systemInfo(event),
      errorLogDir: errorLogDir(),
    });
    const outboxDir = problemReportOutboxDir();
    // Saved first: whatever happens to the connection, the report is kept.
    saveToOutbox(outboxDir, payload);
    const outcome = await sendFromOutbox(
      outboxDir,
      reportId,
      reportEndpoint(),
      electronFetch,
    );
    if (outcome.status === 'sent') {
      // The connection works: send anything left from earlier too.
      flushInBackground();
      return { status: 'sent', reportId };
    }
    if (outcome.status === 'rejected') {
      throw new Error(
        `The report service did not accept the report (${outcome.reason}). It is saved on this computer in the "problem-reports/failed" folder next to the data file; please send that file by e-mail.`,
      );
    }
    return { status: 'queued', reportId, reason: outcome.reason };
  },
);
