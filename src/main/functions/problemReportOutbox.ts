/**
 * Sending problem reports, with an outbox so none is lost.
 *
 * A report is written to `<outbox>/<reportId>.json.gz` BEFORE it is sent and
 * removed only when the service has accepted it. Without internet (a regatta
 * on a beach) it stays and is sent later: when the app starts, every few
 * minutes while it runs, and after any report gets through. A report the
 * service refuses for good (too large, unknown key) moves to `failed/`, where
 * it can still be sent by hand.
 *
 * The body is gzipped JSON; the service sends the e-mail and uses the report
 * id as its idempotency key, so a report sent twice (the answer lost on the
 * way back) arrives once.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { REPORT_ID_PATTERN } from '../../shared/problemReport';
import type { ReportEndpoint } from './problemReportConfig';
import type { ProblemReportPayload } from './problemReport';

export type Fetcher = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type SendOutcome =
  | { status: 'sent' }
  /** Try again later: no connection, a timeout, the service busy or down. */
  | { status: 'retry'; reason: string }
  /** The service refused it for good; retrying cannot help. */
  | { status: 'rejected'; reason: string };

const SEND_TIMEOUT_MS = 90_000;

export const outboxFile = (outboxDir: string, reportId: string): string =>
  path.join(outboxDir, `${reportId}.json.gz`);

/** Write the report to the outbox (atomically: temp file, then rename). */
export function saveToOutbox(
  outboxDir: string,
  payload: ProblemReportPayload,
): string {
  fs.mkdirSync(outboxDir, { recursive: true });
  const file = outboxFile(outboxDir, payload.reportId);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, zlib.gzipSync(JSON.stringify(payload)));
  fs.renameSync(temp, file);
  return file;
}

/** Why the service answered as it did, in words for the user. */
const reasonFor = (status: number, body: string): string => {
  let message = '';
  try {
    message = String(JSON.parse(body)?.error ?? '');
  } catch {
    message = '';
  }
  return message || 'The report service is not answering.';
};

/** Send one gzipped report body to the service. Never throws. */
export async function sendReportBody(
  body: Uint8Array,
  reportId: string,
  endpoint: ReportEndpoint,
  fetcher: Fetcher,
): Promise<SendOutcome> {
  try {
    const response = await fetcher(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Report-Encoding': 'gzip',
        'X-Report-Id': reportId,
        'X-App-Key': endpoint.appKey,
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (response.ok) return { status: 'sent' };
    const text = await response.text().catch(() => '');
    // 408 timeout, 429 too many, 5xx the service or the mail provider: later.
    if (response.status === 408 || response.status === 429) {
      return { status: 'retry', reason: reasonFor(response.status, text) };
    }
    if (response.status >= 500) {
      return { status: 'retry', reason: reasonFor(response.status, text) };
    }
    return { status: 'rejected', reason: reasonFor(response.status, text) };
  } catch (error) {
    return {
      status: 'retry',
      reason:
        (error as Error)?.name === 'TimeoutError'
          ? 'The internet connection is too slow to send it now.'
          : 'This computer could not reach the internet.',
    };
  }
}

/**
 * Send one report from the outbox: removed when sent, moved to failed/ when
 * refused for good, left in place to try again otherwise.
 */
export async function sendFromOutbox(
  outboxDir: string,
  reportId: string,
  endpoint: ReportEndpoint | null,
  fetcher: Fetcher,
): Promise<SendOutcome> {
  if (!endpoint) {
    return {
      status: 'retry',
      reason: 'Sending reports is not set up in this copy of the app.',
    };
  }
  const file = outboxFile(outboxDir, reportId);
  const body = fs.readFileSync(file);
  const outcome = await sendReportBody(body, reportId, endpoint, fetcher);
  if (outcome.status === 'sent') {
    fs.rmSync(file, { force: true });
  } else if (outcome.status === 'rejected') {
    const failedDir = path.join(outboxDir, 'failed');
    fs.mkdirSync(failedDir, { recursive: true });
    fs.renameSync(file, path.join(failedDir, path.basename(file)));
  }
  return outcome;
}

/** The reports waiting in the outbox, oldest first. */
export function pendingReportIds(outboxDir: string): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(outboxDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json.gz'))
    .map((name) => name.slice(0, -'.json.gz'.length))
    .filter((id) => REPORT_ID_PATTERN.test(id))
    .sort((a, b) => {
      const at = (id: string) => {
        try {
          return fs.statSync(outboxFile(outboxDir, id)).mtimeMs;
        } catch {
          return 0;
        }
      };
      return at(a) - at(b);
    });
}

/**
 * Try every waiting report once. Stops at the first one that must wait for
 * the connection (the next would only wait too). One run at a time.
 */
let flushing: Promise<number> | null = null;
export function flushOutbox(
  outboxDir: string,
  endpoint: ReportEndpoint | null,
  fetcher: Fetcher,
): Promise<number> {
  if (!endpoint) return Promise.resolve(0);
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    // eslint-disable-next-line no-restricted-syntax
    for (const reportId of pendingReportIds(outboxDir)) {
      // One at a time on purpose: a slow venue connection, a few MB each.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await sendFromOutbox(
        outboxDir,
        reportId,
        endpoint,
        fetcher,
      ).catch(
        (error): SendOutcome => ({
          status: 'retry',
          reason: String((error as Error)?.message),
        }),
      );
      if (outcome.status === 'sent') sent += 1;
      if (outcome.status === 'retry') break;
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
