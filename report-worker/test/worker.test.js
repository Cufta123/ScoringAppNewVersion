import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import worker from '../src/index.js';
import { buildEmail, escapeHtml, mailAttachments, payloadProblem } from '../src/email.js';

const env = {
  APP_KEY: 'app-key',
  RESEND_API_KEY: 're_test',
  TO_ADDRESS: 'dev@example.com',
  FROM_ADDRESS: 'IOM Regatta Manager <onboarding@resend.dev>',
};

const b64 = (text) => Buffer.from(text).toString('base64');

const payload = (overrides = {}) => ({
  version: 1,
  reportId: 'R-AAAAA001',
  createdAt: '2026-11-04T13:31:00.000Z',
  form: {
    kind: 'wrong-results',
    kindLabel: 'Wrong results, points or places',
    area: 'leaderboard',
    areaLabel: 'Leaderboard and corrections',
    happenedAt: '2026-11-04T14:30',
    problem: 'CRO 12 has <b>wrong</b> points.\nSecond line.',
    doing: 'Saved a DSQ',
    expected: '',
    reporterName: 'Race office',
    reporterContact: 'office@club.example',
  },
  context: { route: '#/event/Kup', eventId: 1, eventName: 'Kup', windowSize: '1366x705' },
  system: { appVersion: '1.2.3', displays: [{ size: '1920x1080', scale: 1 }] },
  included: { snapshot: true, history: false, errorLog: true, screenshot: false },
  notes: [],
  attachments: [
    { filename: 'event-snapshot.json', contentType: 'application/json', content: b64('{"a":1}') },
    { filename: 'errors.log', contentType: 'text/plain', content: b64('boom') },
  ],
  ...overrides,
});

const post = (body, headers = {}) =>
  new Request('https://iom-report.example.workers.dev/report', {
    method: 'POST',
    headers: { 'X-App-Key': 'app-key', 'X-Report-Encoding': 'gzip', ...headers },
    body: gzipSync(JSON.stringify(body)),
  });

let sent;
const realFetch = globalThis.fetch;
beforeEach(() => {
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return new Response('{"id":"x"}', { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('mails a report with its attachments and answers 200', async () => {
  const response = await worker.fetch(post(payload()), env);
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  const { url, init, body } = sent[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers['Idempotency-Key'], 'R-AAAAA001');
  assert.deepEqual(body.to, ['dev@example.com']);
  assert.equal(body.reply_to, 'office@club.example');
  assert.match(body.subject, /Wrong results.*Kup.*R-AAAAA001/);
  assert.deepEqual(
    body.attachments.map((a) => a.filename),
    ['report.json', 'event-snapshot.json', 'errors.log'],
  );
  assert.match(body.text, /What went wrong:\n {2}CRO 12/);
  assert.ok(body.html.includes('&lt;b&gt;wrong&lt;/b&gt;'));
  assert.ok(!body.html.includes('<b>wrong</b>'));
});

test('refuses a wrong app key', async () => {
  const response = await worker.fetch(post(payload(), { 'X-App-Key': 'nope' }), env);
  assert.equal(response.status, 401);
  assert.equal(sent.length, 0);
});

test('refuses a report that does not say what went wrong (400, for good)', async () => {
  const bad = payload({ form: { ...payload().form, problem: 'x' } });
  const response = await worker.fetch(post(bad), env);
  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
});

test('refuses a body that is not gzipped JSON', async () => {
  const request = new Request('https://x.example/report', {
    method: 'POST',
    headers: { 'X-App-Key': 'app-key', 'X-Report-Encoding': 'gzip' },
    body: 'not gzip',
  });
  assert.equal((await worker.fetch(request, env)).status, 400);
});

test('refuses a small body that unzips to too much', async () => {
  const huge = Buffer.alloc(61 * 1024 * 1024, 32);
  const request = new Request('https://x.example/report', {
    method: 'POST',
    headers: { 'X-App-Key': 'app-key', 'X-Report-Encoding': 'gzip' },
    body: gzipSync(huge),
  });
  assert.equal((await worker.fetch(request, env)).status, 413);
});

test('tells the app to try later when the mail service fails or is not set up', async () => {
  globalThis.fetch = async () => new Response('down', { status: 500 });
  assert.equal((await worker.fetch(post(payload()), env)).status, 503);
  assert.equal(
    (await worker.fetch(post(payload()), { ...env, RESEND_API_KEY: '' })).status,
    503,
  );
});

test('a mail Resend refuses as such is refused for good', async () => {
  globalThis.fetch = async () => new Response('{"message":"bad"}', { status: 422 });
  assert.equal((await worker.fetch(post(payload()), env)).status, 422);
});

test('rate limited reports are kept by the app (429)', async () => {
  const limited = { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await worker.fetch(post(payload()), limited)).status, 429);
});

test('only POST /report does anything', async () => {
  const get = await worker.fetch(new Request('https://x.example/'), env);
  assert.equal(get.status, 200);
  const other = await worker.fetch(new Request('https://x.example/other'), env);
  assert.equal(other.status, 404);
  const wrongMethod = await worker.fetch(new Request('https://x.example/report'), env);
  assert.equal(wrongMethod.status, 405);
});

test('payloadProblem refuses odd attachment names and contents', () => {
  assert.match(
    payloadProblem(payload({ attachments: [{ filename: '../x.exe', content: 'AA==' }] })),
    /attachment/,
  );
  assert.match(
    payloadProblem(payload({ attachments: [{ filename: 'x.json', content: '<html>' }] })),
    /attachment/,
  );
  assert.equal(payloadProblem(payload()), null);
});

test('large text attachments are gzipped until the mail fits', async () => {
  const big = b64('x'.repeat(4000));
  const list = await mailAttachments(
    [
      { filename: 'history.json', content: big },
      { filename: 'screenshot.jpg', content: b64('jpeg') },
    ],
    1000,
  );
  assert.deepEqual(list.map((a) => a.filename), ['history.json.gz', 'screenshot.jpg']);
  assert.equal(gunzipSync(Buffer.from(list[0].content, 'base64')).toString(), 'x'.repeat(4000));
});

test('no reply-to when the contact is a phone number; subject on one line', async () => {
  const email = await buildEmail(
    payload({
      form: { ...payload().form, reporterContact: '+385 91 000 0000', kindLabel: 'A\nB' },
    }),
    env,
  );
  assert.equal(email.reply_to, undefined);
  assert.ok(!email.subject.includes('\n'));
});

test('escapeHtml escapes markup', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});
