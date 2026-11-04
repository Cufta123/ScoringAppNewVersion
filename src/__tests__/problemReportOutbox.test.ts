/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import {
  flushOutbox,
  outboxFile,
  pendingReportIds,
  saveToOutbox,
  sendFromOutbox,
  type Fetcher,
} from '../main/functions/problemReportOutbox';
import { reportEndpoint } from '../main/functions/problemReportConfig';
import type { ProblemReportPayload } from '../main/functions/problemReport';

const endpoint = { url: 'https://reports.example/report', appKey: 'k' };

const payload = (reportId: string): ProblemReportPayload =>
  ({
    version: 1,
    reportId,
    createdAt: '2026-11-04T13:30:00.000Z',
    form: { problem: 'Something is wrong here.' },
    attachments: [],
  }) as unknown as ProblemReportPayload;

const answering =
  (status: number, body = '{}'): Fetcher =>
  async () => ({ ok: status < 300, status, text: async () => body });

describe('problem report outbox', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-outbox-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the report as gzipped JSON before sending', () => {
    saveToOutbox(dir, payload('R-AAAAA001'));
    const body = fs.readFileSync(outboxFile(dir, 'R-AAAAA001'));
    expect(JSON.parse(zlib.gunzipSync(body).toString()).reportId).toBe(
      'R-AAAAA001',
    );
  });

  it('sends the saved body with the key and removes it once accepted', async () => {
    saveToOutbox(dir, payload('R-AAAAA001'));
    const fetcher = jest.fn(answering(200));
    const outcome = await sendFromOutbox(dir, 'R-AAAAA001', endpoint, fetcher);
    expect(outcome).toEqual({ status: 'sent' });
    expect(fetcher).toHaveBeenCalledWith(
      endpoint.url,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-App-Key': 'k',
          'X-Report-Id': 'R-AAAAA001',
          'X-Report-Encoding': 'gzip',
        }),
      }),
    );
    expect(pendingReportIds(dir)).toEqual([]);
  });

  it('keeps the report when there is no connection', async () => {
    saveToOutbox(dir, payload('R-AAAAA001'));
    const offline: Fetcher = async () => {
      throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
    };
    const outcome = await sendFromOutbox(dir, 'R-AAAAA001', endpoint, offline);
    expect(outcome.status).toBe('retry');
    expect(outcome.status === 'retry' && outcome.reason).toMatch(
      /could not reach the internet/,
    );
    expect(pendingReportIds(dir)).toEqual(['R-AAAAA001']);
  });

  it('keeps it when the service is busy or down', async () => {
    saveToOutbox(dir, payload('R-AAAAA001'));
    expect(
      (await sendFromOutbox(dir, 'R-AAAAA001', endpoint, answering(503)))
        .status,
    ).toBe('retry');
    expect(
      (await sendFromOutbox(dir, 'R-AAAAA001', endpoint, answering(429)))
        .status,
    ).toBe('retry');
    expect(pendingReportIds(dir)).toEqual(['R-AAAAA001']);
  });

  it('moves a report the service refuses for good to failed/', async () => {
    saveToOutbox(dir, payload('R-AAAAA001'));
    const outcome = await sendFromOutbox(
      dir,
      'R-AAAAA001',
      endpoint,
      answering(413, '{"error":"The report is too large."}'),
    );
    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'The report is too large.',
    });
    expect(pendingReportIds(dir)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'failed', 'R-AAAAA001.json.gz'))).toBe(
      true,
    );
  });

  it('keeps everything when sending is not set up', async () => {
    saveToOutbox(dir, payload('R-AAAAA001'));
    const outcome = await sendFromOutbox(dir, 'R-AAAAA001', null, jest.fn());
    expect(outcome.status).toBe('retry');
    expect(pendingReportIds(dir)).toEqual(['R-AAAAA001']);
  });

  it('flushes waiting reports and stops at the first that must wait', async () => {
    ['R-AAAAA001', 'R-AAAAA002', 'R-AAAAA003'].forEach((id, index) => {
      saveToOutbox(dir, payload(id));
      const at = new Date(Date.now() - (10 - index) * 1000);
      fs.utimesSync(outboxFile(dir, id), at, at);
    });
    let calls = 0;
    const flaky: Fetcher = async () => {
      calls += 1;
      if (calls === 2) throw new Error('offline');
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const sent = await flushOutbox(dir, endpoint, flaky);
    expect(sent).toBe(1);
    expect(calls).toBe(2);
    expect(pendingReportIds(dir)).toEqual(['R-AAAAA002', 'R-AAAAA003']);
  });

  it('ignores files that are not reports', () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'evil.json.gz'), 'x');
    expect(pendingReportIds(dir)).toEqual([]);
  });
});

describe('reportEndpoint', () => {
  it('uses the override URL when given', () => {
    expect(
      reportEndpoint({
        SCORING_APP_REPORT_URL: 'http://localhost:8787/report',
        SCORING_APP_REPORT_KEY: 'test',
      }),
    ).toEqual({ url: 'http://localhost:8787/report', appKey: 'test' });
  });

  it('never sends from the automated tests without an explicit URL', () => {
    expect(reportEndpoint({ SCORING_APP_HIDDEN: '1' })).toBeNull();
  });
});
