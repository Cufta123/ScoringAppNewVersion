/**
 * IOM Regatta Manager report service.
 *
 * POST /report: a problem report from the app (gzipped JSON, see
 * src/main/functions/problemReport.ts in the app), e-mailed to TO_ADDRESS
 * through Resend. The answer tells the app what to do with its saved copy:
 *   2xx  sent, delete it
 *   429 / 5xx  keep it and try again later
 *   other 4xx  refused for good (moved to the app's failed/ folder)
 *
 * Secrets: APP_KEY (the key built into the app), RESEND_API_KEY,
 * TO_ADDRESS. Optional var FROM_ADDRESS; optional RATE_LIMITER binding.
 */
import { buildEmail, payloadProblem } from './email.js';

/** Largest request accepted (gzipped). */
const MAX_BODY_BYTES = 25 * 1024 * 1024;
/** Largest report after unzipping: stops a small file that unzips to GBs. */
const MAX_JSON_BYTES = 60 * 1024 * 1024;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Read a stream up to `limit` bytes; throws when it is longer. */
async function readLimited(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError('too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

async function readPayload(request) {
  if (!request.body) throw new SyntaxError('no body');
  const compressed = await readLimited(request.body, MAX_BODY_BYTES);
  const gzipped = request.headers.get('X-Report-Encoding') === 'gzip';
  const stream = new Blob([compressed]).stream();
  const bytes = gzipped
    ? await readLimited(
        stream.pipeThrough(new DecompressionStream('gzip')),
        MAX_JSON_BYTES,
      )
    : compressed;
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function handleReport(request, env) {
  if (!env.APP_KEY || request.headers.get('X-App-Key') !== env.APP_KEY) {
    return json(401, {
      error: 'This copy of the app may not send reports. Please send the report file by e-mail.',
    });
  }
  if (!env.RESEND_API_KEY || !env.TO_ADDRESS) {
    // Our set-up, not the user's report: keep it and try again later.
    console.error('report service: RESEND_API_KEY or TO_ADDRESS is not set');
    return json(503, { error: 'The report service is not ready yet.' });
  }
  if (env.RATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return json(429, { error: 'Too many reports in a short time.' });
    }
  }
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
    return json(413, { error: 'The report is too large.' });
  }

  let payload;
  try {
    payload = await readPayload(request);
  } catch (error) {
    return error instanceof RangeError
      ? json(413, { error: 'The report is too large.' })
      : json(400, { error: 'The report could not be read.' });
  }
  const problem = payloadProblem(payload);
  if (problem) return json(400, { error: problem });

  const email = await buildEmail(payload, env);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // The app may send a report twice (the answer lost on the way back):
      // Resend sends one mail per key.
      'Idempotency-Key': payload.reportId,
    },
    body: JSON.stringify(email),
  });
  if (response.ok) return json(200, { ok: true, reportId: payload.reportId });

  const detail = await response.text().catch(() => '');
  console.error('report service: Resend answered', response.status, detail);
  // A mail Resend refuses as such (400/422) will never go; anything else
  // (rate limit, outage, our key) may, so the app keeps the report.
  if (response.status === 400 || response.status === 422) {
    return json(422, { error: 'The report could not be turned into an e-mail.' });
  }
  return json(503, { error: 'The mail service is not answering.' });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/' && request.method === 'GET') {
      return new Response('IOM Regatta Manager report service\n');
    }
    if (pathname !== '/report') return json(404, { error: 'Not found.' });
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
    try {
      return await handleReport(request, env);
    } catch (error) {
      console.error('report service: unexpected', error);
      return json(503, { error: 'The report service had a problem.' });
    }
  },
};
