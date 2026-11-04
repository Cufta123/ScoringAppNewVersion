/**
 * Turns a problem report from the app into one e-mail (Resend's request
 * body): a readable summary in the text and HTML parts, and the attachments
 * the app sent plus `report.json` with every field for machines.
 */

/** Resend takes 40 MB per message after base64; stay well under it. */
export const MAX_ATTACHMENT_CHARS = 30 * 1024 * 1024;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;

export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );

const oneLine = (value, max) =>
  String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);

/** What is wrong with a payload, or null when it can be mailed. */
export function payloadProblem(payload) {
  if (!payload || typeof payload !== 'object') return 'The report is empty.';
  if (payload.version !== 1) return 'This app version sends an unknown report format.';
  if (!/^R-[0-9A-Z]{8}$/.test(String(payload.reportId))) {
    return 'The report has no valid reference.';
  }
  const problem = payload.form?.problem;
  if (typeof problem !== 'string' || problem.trim().length < 10) {
    return 'The report does not say what went wrong.';
  }
  if (!Array.isArray(payload.attachments) || payload.attachments.length > 10) {
    return 'The report has unexpected attachments.';
  }
  const bad = payload.attachments.find(
    (a) =>
      !a ||
      !SAFE_FILENAME.test(String(a.filename)) ||
      typeof a.content !== 'string' ||
      !BASE64.test(a.content),
  );
  if (bad) return 'The report has an attachment that cannot be read.';
  return null;
}

const base64ToBytes = (base64) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const bytesToBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const gzip = async (bytes) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );

/**
 * The attachments for Resend. When together they are too large, the text
 * ones (JSON, logs) are gzipped, largest first, until they fit.
 */
export async function mailAttachments(attachments, maxChars = MAX_ATTACHMENT_CHARS) {
  const list = attachments.map((a) => ({
    filename: a.filename,
    content: a.content,
  }));
  const total = () => list.reduce((sum, a) => sum + a.content.length, 0);
  const squeezable = [...list]
    .filter((a) => /\.(json|txt|log)$/.test(a.filename))
    .sort((a, b) => b.content.length - a.content.length);
  for (const attachment of squeezable) {
    if (total() <= maxChars) break;
    // eslint-disable-next-line no-await-in-loop
    attachment.content = bytesToBase64(await gzip(base64ToBytes(attachment.content)));
    attachment.filename = `${attachment.filename}.gz`;
  }
  return list;
}

const section = (title, rows) => ({ title, rows: rows.filter(([, v]) => v) });

/** The report's fields as titled sections of [label, value]. */
export function reportSections(payload) {
  const { form = {}, context = {}, system = {}, included = {}, notes = [] } = payload;
  const yesNo = (value) => (value ? 'yes' : 'no');
  return [
    section('The problem', [
      ['Kind', form.kindLabel || form.kind],
      ['Where', form.areaLabel || form.area],
      ['When', form.happenedAt],
      ['What went wrong', form.problem],
      ['What they were doing', form.doing],
      ['What they expected', form.expected],
    ]),
    section('Who', [
      ['Name', form.reporterName],
      ['Contact', form.reporterContact],
    ]),
    section('Where in the app', [
      ['Event', context.eventName ? `${context.eventName} (id ${context.eventId})` : 'no event open'],
      ['Page', context.route],
      ['Window', context.windowSize],
    ]),
    section(
      'Computer',
      Object.entries(system).map(([key, value]) => [
        key,
        typeof value === 'object' ? JSON.stringify(value) : String(value),
      ]),
    ),
    section('Included', [
      [
        'Attachments chosen',
        `event data ${yesNo(included.snapshot)}, history ${yesNo(included.history)}, error log ${yesNo(included.errorLog)}, screenshot ${yesNo(included.screenshot)}`,
      ],
      ['Notes', notes.join(' ')],
    ]),
  ];
}

const textBody = (payload, sections) =>
  [
    `Problem report ${payload.reportId}, sent ${payload.createdAt}`,
    '',
    ...sections.flatMap(({ title, rows }) => [
      title.toUpperCase(),
      ...rows.map(([label, value]) =>
        String(value).includes('\n')
          ? `${label}:\n  ${String(value).replace(/\n/g, '\n  ')}`
          : `${label}: ${value}`,
      ),
      '',
    ]),
  ].join('\n');

const htmlBody = (payload, sections) => `<!doctype html>
<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#0d1f2d;max-width:760px">
<h2 style="margin:0 0 4px">Problem report ${escapeHtml(payload.reportId)}</h2>
<p style="margin:0 0 16px;color:#3d5670">Sent ${escapeHtml(payload.createdAt)}</p>
${sections
  .map(
    ({ title, rows }) => `<h3 style="margin:18px 0 6px;color:#0f2d4a">${escapeHtml(title)}</h3>
<table style="border-collapse:collapse;width:100%">${rows
      .map(
        ([label, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:4px 12px 4px 0;width:180px;color:#3d5670">${escapeHtml(label)}</th><td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`,
      )
      .join('')}</table>`,
  )
  .join('\n')}
</body></html>`;

/** The Resend request body for a checked payload. */
export async function buildEmail(payload, env) {
  const sections = reportSections(payload);
  const { attachments: files, ...fields } = payload;
  const summary = {
    ...fields,
    attachments: files.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      chars: a.content.length,
    })),
  };
  const attachments = await mailAttachments([
    {
      filename: 'report.json',
      content: bytesToBase64(new TextEncoder().encode(JSON.stringify(summary, null, 2))),
    },
    ...files,
  ]);
  const kind = oneLine(payload.form.kindLabel || payload.form.kind, 60);
  const event = oneLine(payload.context?.eventName || 'no event', 60);
  const contact = String(payload.form.reporterContact ?? '').trim();
  return {
    from: env.FROM_ADDRESS || 'IOM Regatta Manager <onboarding@resend.dev>',
    to: [env.TO_ADDRESS],
    subject: oneLine(`[IOM Regatta Manager] ${kind} – ${event} (${payload.reportId})`, 200),
    text: textBody(payload, sections),
    html: htmlBody(payload, sections),
    attachments,
    ...(EMAIL.test(contact) ? { reply_to: contact } : {}),
  };
}
