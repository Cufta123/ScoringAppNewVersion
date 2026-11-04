/**
 * Building a problem report: the user's form plus everything that helps to
 * solve the problem, as one JSON payload with its attachments. See
 * shared/problemReport.ts for the form, problemReportOutbox.ts for sending.
 */
import fs from 'fs';
import path from 'path';
import { db } from '../../../public/Database/DBManager';
import { buildEventSnapshot } from './eventSnapshot';
import { readEventHistory } from './changeJournal';
import { summarizeAction } from '../../shared/history/describe';
import type { HistoryAction } from '../../shared/history/describe';
import {
  APP_AREAS,
  PROBLEM_KINDS,
  cleanProblemReportForm,
  labelOf,
  validateProblemReportForm,
  type ProblemReportContext,
  type ProblemReportForm,
  type ProblemReportIncludes,
  type ProblemReportRequest,
} from '../../shared/problemReport';

export interface ReportAttachment {
  filename: string;
  contentType: string;
  /** base64 of the file's bytes. */
  content: string;
}

export interface ProblemReportPayload {
  version: 1;
  reportId: string;
  createdAt: string;
  form: ProblemReportForm & { kindLabel: string; areaLabel: string };
  context: ProblemReportContext & { eventName: string | null };
  system: Record<string, unknown>;
  /** What the user chose to include, and what could not be read. */
  included: ProblemReportIncludes;
  notes: string[];
  attachments: ReportAttachment[];
}

/** Largest error log part sent (the newest end of the log is kept). */
export const ERROR_LOG_TAIL_BYTES = 512 * 1024;
/** Largest history sent; older actions are left out past this. */
export const HISTORY_MAX_CHARS = 8 * 1024 * 1024;
/** Largest screenshot accepted from the window (characters of data URL). */
export const SCREENSHOT_MAX_CHARS = 6 * 1024 * 1024;

const SCREENSHOT_PATTERN =
  /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

const textAttachment = (
  filename: string,
  text: string,
  contentType = 'text/plain; charset=utf-8',
): ReportAttachment => ({
  filename,
  contentType,
  content: Buffer.from(text, 'utf8').toString('base64'),
});

const jsonAttachment = (filename: string, value: unknown): ReportAttachment =>
  textAttachment(
    filename,
    JSON.stringify(value, null, 2),
    'application/json; charset=utf-8',
  );

/** The newest `maxBytes` of a file ('' when it does not exist). */
export function readFileTail(file: string, maxBytes: number): string {
  let handle: number | null = null;
  try {
    const { size } = fs.statSync(file);
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    handle = fs.openSync(file, 'r');
    fs.readSync(handle, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    return size > maxBytes
      ? `[… the first ${size - length} bytes are left out …]\n${text}`
      : text;
  } catch {
    return '';
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}

/**
 * The error log, oldest first: errors.1.log (the previous file) then
 * errors.log, cut to the newest ERROR_LOG_TAIL_BYTES.
 */
export function readErrorLog(logDir: string | null): string {
  if (!logDir) return '';
  const previous = fs.existsSync(path.join(logDir, 'errors.1.log'))
    ? readFileTail(path.join(logDir, 'errors.1.log'), ERROR_LOG_TAIL_BYTES)
    : '';
  const current = readFileTail(
    path.join(logDir, 'errors.log'),
    ERROR_LOG_TAIL_BYTES,
  );
  const joined = [previous, current].filter(Boolean).join('\n');
  return joined.length > ERROR_LOG_TAIL_BYTES
    ? `[… older entries left out …]\n${joined.slice(-ERROR_LOG_TAIL_BYTES)}`
    : joined;
}

/**
 * The event's data, with the boats, sailors and clubs it uses, so it can be
 * looked at (or loaded into an empty database) without the user's other
 * events. The export logo is left out: it is a picture, not a clue.
 */
export function buildReportSnapshot(eventId: number) {
  const snapshot = buildEventSnapshot(eventId);
  const events = snapshot.tables.Events.map((row) => {
    const { export_logo: logo, ...rest } = row as Record<string, unknown>;
    return { ...rest, export_logo: logo ? '[logo left out]' : null };
  });
  return { ...snapshot, tables: { ...snapshot.tables, Events: events } };
}

/** The history as the History dialog words it, newest first. */
export function historyAsText(actions: HistoryAction[]): string {
  return actions
    .map((action) => {
      const { label, lines } = summarizeAction(action);
      return [
        `${action.at}  ${label}`,
        ...lines.map((line) => `    ${line}`),
      ].join('\n');
    })
    .join('\n\n');
}

/** The newest actions whose JSON fits in `maxChars`. */
export function newestHistoryWithin(
  actions: HistoryAction[],
  maxChars: number,
): { actions: HistoryAction[]; leftOut: number } {
  const kept: HistoryAction[] = [];
  let size = 0;
  for (let i = 0; i < actions.length; i += 1) {
    const { length } = JSON.stringify(actions[i]);
    if (size + length > maxChars) break;
    kept.push(actions[i]);
    size += length;
  }
  return { actions: kept, leftOut: actions.length - kept.length };
}

const eventNameOf = (eventId: number | null): string | null => {
  if (eventId == null) return null;
  const row = db
    .prepare('SELECT event_name FROM Events WHERE event_id = ?')
    .get(eventId) as { event_name: string } | undefined;
  return row?.event_name ?? null;
};

export interface BuildReportOptions {
  reportId: string;
  createdAt?: Date;
  /** The computer and the app; gathered by the handler (Electron APIs). */
  system: Record<string, unknown>;
  errorLogDir: string | null;
}

/**
 * The report, or a refusal in words when the form is not complete. Each
 * attachment is best effort: one that cannot be read is named in `notes`
 * and the report still goes, since the user's words matter most.
 */
export function buildProblemReport(
  request: ProblemReportRequest,
  { reportId, createdAt = new Date(), system, errorLogDir }: BuildReportOptions,
): ProblemReportPayload {
  const errors = validateProblemReportForm(request?.form ?? {});
  const firstError = Object.values(errors)[0];
  if (firstError) {
    throw new Error(`The report was not sent: ${firstError}`);
  }
  const form = cleanProblemReportForm(request.form);
  const rawEventId = request.context?.eventId;
  const eventId =
    rawEventId != null && Number.isInteger(Number(rawEventId))
      ? Number(rawEventId)
      : null;
  const includes: ProblemReportIncludes = {
    snapshot: Boolean(request.includes?.snapshot) && eventId != null,
    history: Boolean(request.includes?.history) && eventId != null,
    errorLog: Boolean(request.includes?.errorLog),
    screenshot: Boolean(request.includes?.screenshot),
  };
  const notes: string[] = [];
  const attachments: ReportAttachment[] = [];
  const attempt = (what: string, work: () => void) => {
    try {
      work();
    } catch (error) {
      notes.push(`${what} could not be added: ${(error as Error)?.message}`);
    }
  };

  let eventName: string | null = null;
  attempt('The event name', () => {
    eventName = eventNameOf(eventId);
  });

  if (includes.snapshot && eventId != null) {
    attempt('The event data', () => {
      attachments.push(
        jsonAttachment('event-snapshot.json', buildReportSnapshot(eventId)),
      );
    });
  }
  if (includes.history && eventId != null) {
    attempt('The change history', () => {
      const all = readEventHistory(eventId);
      const { actions, leftOut } = newestHistoryWithin(all, HISTORY_MAX_CHARS);
      if (leftOut > 0) {
        notes.push(`The ${leftOut} oldest history entries were left out.`);
      }
      attachments.push(textAttachment('history.txt', historyAsText(actions)));
      attachments.push(jsonAttachment('history.json', actions));
    });
  }
  if (includes.errorLog) {
    attempt('The error log', () => {
      const log = readErrorLog(errorLogDir);
      if (log) attachments.push(textAttachment('errors.log', log));
      else notes.push('The error log is empty.');
    });
  }
  if (includes.screenshot) {
    const match =
      typeof request.screenshot === 'string' &&
      request.screenshot.length <= SCREENSHOT_MAX_CHARS
        ? SCREENSHOT_PATTERN.exec(request.screenshot)
        : null;
    if (match) {
      attachments.push({
        filename: `screenshot.${match[1] === 'png' ? 'png' : 'jpg'}`,
        contentType: `image/${match[1]}`,
        content: match[2],
      });
    } else {
      notes.push('No screenshot could be taken.');
    }
  }

  return {
    version: 1,
    reportId,
    createdAt: createdAt.toISOString(),
    form: {
      ...form,
      kindLabel: labelOf(PROBLEM_KINDS, form.kind),
      areaLabel: labelOf(APP_AREAS, form.area),
    },
    context: {
      route: String(request.context?.route ?? '').slice(0, 300),
      eventId,
      eventName,
      windowSize: String(request.context?.windowSize ?? '').slice(0, 40),
    },
    // The computer's details travel with the screenshot, as the form says;
    // the app version always goes (it names no one and no computer).
    system: includes.screenshot ? system : { appVersion: system.appVersion },
    included: includes,
    notes,
    attachments,
  };
}
