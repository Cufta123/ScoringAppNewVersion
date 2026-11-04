import http from 'http';
import path from 'path';
import zlib from 'zlib';
import type { AddressInfo } from 'net';
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  launchApp,
  closeApp,
  createEvent,
  openEvent,
  addSailor,
  uniqueName,
  dismissToasts,
} from './helpers';

/**
 * Help > Report a problem, end to end: the real app, the real form, the
 * report sent over HTTP to a stand-in for the report service, which checks
 * what arrived. A second run has no service, so the report is kept.
 *
 * SHOT_DIR=… also saves pictures of the form for review.
 */

interface Received {
  headers: http.IncomingHttpHeaders;
  payload: any;
}

let server: http.Server;
let serviceUrl = '';
let received: Received[] = [];
let answerStatus = 200;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        headers: request.headers,
        payload: JSON.parse(zlib.gunzipSync(Buffer.concat(chunks)).toString()),
      });
      response.writeHead(answerStatus, { 'Content-Type': 'application/json' });
      response.end(answerStatus === 200 ? '{"ok":true}' : '{"error":"down"}');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/report`;
});

test.afterAll(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

const shot = async (window: Page, name: string) => {
  if (!process.env.SHOT_DIR) return;
  await window.screenshot({
    path: path.join(process.env.SHOT_DIR, `${name}.png`),
  });
};

async function fillAndSend(window: Page) {
  await window
    .getByLabel('What kind of problem?')
    .selectOption('wrong-results');
  await window
    .getByLabel('What went wrong?')
    .fill('CRO 501 shows the wrong points after a correction.');
  await window.getByLabel(/What were you doing/).fill('Entered sailors.');
  await window.getByLabel('Phone or e-mail').fill('office@club.example');
  await shot(window, 'problem-report-filled');
  await window.getByRole('button', { name: /Send report/ }).click();
}

test.describe('Report a problem', () => {
  let app: ElectronApplication;
  let window: Page;

  test.afterEach(async () => {
    if (app) await closeApp(app);
  });

  test('sends the form with the event data, history, log and screenshot', async () => {
    received = [];
    answerStatus = 200;
    ({ app, window } = await launchApp({
      SCORING_APP_REPORT_URL: serviceUrl,
      SCORING_APP_REPORT_KEY: 'e2e-key',
    }));
    const name = uniqueName('Report');
    await createEvent(window, name);
    await openEvent(window, name);
    await addSailor(window, { name: 'Ana', surname: 'Report', sail: '501' });
    await dismissToasts(window);

    await window.getByRole('button', { name: /Report a problem/ }).click();
    const dialog = window.getByRole('dialog', { name: /Report a problem/ });
    await expect(dialog).toBeVisible();
    await expect(window.getByLabel('Where in the app?')).toHaveValue('entries');
    await expect(window.getByLabel(/This event's data/)).toBeChecked();
    await expect(
      window.getByAltText('The screen that will be sent'),
    ).toBeVisible();
    await shot(window, 'problem-report-open');
    await window.getByLabel(/A picture of the screen/).scrollIntoViewIfNeeded();
    await shot(window, 'problem-report-attachments');

    await fillAndSend(window);
    await expect(window.getByText(/Report sent/)).toBeVisible();
    await shot(window, 'problem-report-sent');

    expect(received).toHaveLength(1);
    const [{ headers, payload }] = received;
    expect(headers['x-app-key']).toBe('e2e-key');
    expect(payload.reportId).toMatch(/^R-[0-9A-Z]{8}$/);
    expect(headers['x-report-id']).toBe(payload.reportId);
    expect(payload.form).toMatchObject({
      kind: 'wrong-results',
      area: 'entries',
      reporterContact: 'office@club.example',
    });
    expect(payload.context.eventName).toBe(name);
    expect(payload.system.electron).toBeTruthy();
    const files = payload.attachments.map((a: any) => a.filename);
    expect(files).toEqual(
      expect.arrayContaining([
        'event-snapshot.json',
        'history.txt',
        'history.json',
        'screenshot.jpg',
      ]),
    );
    const snapshot = JSON.parse(
      Buffer.from(
        payload.attachments.find(
          (a: any) => a.filename === 'event-snapshot.json',
        ).content,
        'base64',
      ).toString(),
    );
    expect(snapshot.people.Sailors.map((s: any) => s.name)).toContain('Ana');
    await expect(
      window.getByText(payload.reportId, { exact: true }),
    ).toBeVisible();
  });

  test('keeps the report when the service cannot be reached', async () => {
    received = [];
    answerStatus = 503;
    ({ app, window } = await launchApp({
      SCORING_APP_REPORT_URL: serviceUrl,
      SCORING_APP_REPORT_KEY: 'e2e-key',
    }));
    await window.getByRole('button', { name: /Report a problem/ }).click();
    await expect(window.getByLabel(/This event's data/)).toBeDisabled();
    await fillAndSend(window);
    await expect(window.getByText(/it will be sent later/)).toBeVisible();
    await shot(window, 'problem-report-queued');
    expect(received).toHaveLength(1);
  });
});
