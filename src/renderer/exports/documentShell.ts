/**
 * The parts every exported HTML document shares: the header with logo, event
 * and status badge, the signature block, the print CSS and the document
 * wrapper. The document builders (results, starting list, heats) only write
 * their own tables.
 *
 * Everything here is a pure function from plain data to a string. User text
 * (event name, venue, labels, sailor names) always goes through escapeHtml,
 * and the page is self-contained: no external fonts, scripts or images, so it
 * looks the same offline, on any laptop, and in the PDF.
 */
import escapeHtml from '../utils/escapeHtml';
import { formatEventDate, formatDateTimeShort } from '../utils/formatDate';
import { defaultSignatureLabels, stringsFor } from './i18n';
import type {
  CommonDocumentOptions,
  DocumentContext,
  DocumentStatus,
  Orientation,
} from './types';

/** A4 in millimetres, and the margins every document is printed with. */
export const PAGE_MM = { width: 210, height: 297 };
export const MARGIN_MM = { top: 12, right: 10, bottom: 17, left: 10 };

/** Width of the printable area of an A4 page, in millimetres. */
export const contentWidthMm = (orientation: Orientation): number =>
  (orientation === 'landscape' ? PAGE_MM.height : PAGE_MM.width) -
  MARGIN_MM.left -
  MARGIN_MM.right;

/** The text colour and fill of each status badge. */
const STATUS_BADGE: Record<
  DocumentStatus,
  { background: string; color: string; border: string }
> = {
  provisional: { background: '#fff1d6', color: '#7a4300', border: '#d98a14' },
  official: { background: '#0b6b57', color: '#ffffff', border: '#0b6b57' },
  final: { background: '#111a2b', color: '#ffffff', border: '#111a2b' },
};

/**
 * A string safe inside a CSS "..." literal (page footer text) that sits in a
 * <style> element: quotes and backslashes are escaped, and "<" / ">" become CSS
 * escapes, so an event called "</style><script>" can never close the element.
 */
export const cssString = (value: string): string =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')
    .replace(/>/g, '\\3e ')
    .replace(/[\r\n]+/g, ' ')}"`;

/** A file name part without anything a file system dislikes. */
export const safeFileName = (value: string, fallback = 'event'): string => {
  const cleaned = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
};

/**
 * One CSS class per flag shown, each carrying its image once: a flag used by
 * 12 boats is in the document once, not 12 times.
 */
export const flagStyles = (
  flags: Record<string, string>,
  usedCodes: Iterable<string>,
): string => {
  const rules: string[] = [];
  new Set(usedCodes).forEach((code) => {
    const image = flags[code];
    if (!image || !/^[A-Z0-9]{2,3}$/.test(code)) return;
    rules.push(
      `.flag-${code}{background-image:url("${image.replace(/"/g, '%22')}")}`,
    );
  });
  return rules.join('\n');
};

/** A flag followed by the country code, or the code alone without a flag. */
export const countryCell = (
  code: string,
  flags: Record<string, string>,
): string => {
  const text = escapeHtml(code);
  if (!code) return '<span class="missing">–</span>';
  if (!flags[code] || !/^[A-Z0-9]{2,3}$/.test(code)) return text;
  return `<span class="flag flag-${code}" aria-hidden="true"></span>${text}`;
};

const BASE_CSS = `
:root {
  --ink: #1b2433;
  --muted: #566274;
  --rule: #cdd5e0;
  --soft: #e6ebf2;
  --zebra: #f5f7fb;
  --navy: #14233f;
  --accent: #0b6b57;
  --danger: #b3261e;
  --discard: #6b7686;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  color: var(--ink);
  background: #fff;
  font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif;
  font-size: 9pt;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}
h1, h2, h3, p { margin: 0; }
.doc-head {
  display: flex;
  align-items: center;
  gap: 5mm;
  padding-bottom: 3.5mm;
  border-bottom: 0.9mm solid var(--navy);
}
.doc-logo {
  flex: 0 0 auto;
  height: 17mm;
  max-width: 40mm;
  object-fit: contain;
}
.doc-event { flex: 1 1 auto; min-width: 0; }
.doc-event h1 {
  font-size: 18pt;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: 0.1pt;
  color: var(--navy);
  overflow-wrap: anywhere;
}
.doc-meta { margin-top: 1mm; font-size: 9.5pt; color: var(--muted); }
.doc-meta .sep { margin: 0 1.6mm; color: var(--rule); }
.badge {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 1.6mm 4.5mm;
  border: 0.35mm solid;
  border-radius: 1mm;
  font-size: 10pt;
  font-weight: 700;
  letter-spacing: 1pt;
  text-transform: uppercase;
  white-space: nowrap;
}
.doc-titlebar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6mm;
  margin: 4.5mm 0 1mm;
}
.doc-titlebar h2 {
  font-size: 14pt;
  font-weight: 700;
  color: var(--navy);
  overflow-wrap: anywhere;
}
.asof { font-size: 8.5pt; color: var(--muted); white-space: nowrap; }
.doc-summary { margin: 0 0 3.5mm; font-size: 9pt; color: var(--muted); }
.missing { color: var(--discard); }
.empty-note {
  margin: 10mm 0;
  padding: 8mm;
  border: 0.3mm dashed var(--rule);
  text-align: center;
  color: var(--muted);
}
.flag {
  display: inline-block;
  width: 5.2mm;
  height: 3.5mm;
  margin-right: 1.6mm;
  vertical-align: -0.55mm;
  background: center / cover no-repeat #e9edf3;
  box-shadow: 0 0 0 0.15mm rgba(20, 35, 63, 0.35);
}
.legend {
  margin-top: 5mm;
  padding-top: 2.5mm;
  border-top: 0.25mm solid var(--rule);
  font-size: 8pt;
  color: var(--muted);
  break-inside: avoid;
}
.legend h3 {
  margin-bottom: 1.4mm;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.6pt;
  text-transform: uppercase;
  color: var(--ink);
}
.legend ul {
  margin: 0;
  padding: 0;
  list-style: none;
  columns: 2;
  column-gap: 8mm;
}
.legend li { break-inside: avoid; padding: 0.35mm 0; }
.legend .code { display: inline-block; min-width: 10mm; font-weight: 700; color: var(--ink); }
.legend .code.penalty { color: var(--danger); }
.legend .code.redress { color: var(--accent); }
.signatures {
  display: flex;
  gap: 24mm;
  margin-top: 16mm;
  break-inside: avoid;
}
.signatures .line {
  flex: 1 1 0;
  padding-top: 1.6mm;
  border-top: 0.3mm solid var(--ink);
  font-size: 8.5pt;
  color: var(--muted);
}
.doc-foot {
  margin-top: 8mm;
  padding-top: 2mm;
  border-top: 0.25mm solid var(--rule);
  font-size: 7.5pt;
  color: var(--muted);
}
@media screen {
  body { padding: ${MARGIN_MM.top}mm ${MARGIN_MM.right}mm 10mm; }
}
@media print {
  .doc-foot { display: none; }
}
`;

/** Table styles of the starting list and the heat lists. */
export const LIST_CSS = `
table.list {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 9.5pt;
}
table.list thead { display: table-header-group; }
table.list th {
  background: var(--navy);
  color: #fff;
  font-weight: 600;
  padding: 1.8mm 2mm;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
}
table.list td {
  padding: 1.5mm 2mm;
  border-bottom: 0.2mm solid var(--soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
table.list tbody tr { break-inside: avoid; page-break-inside: avoid; }
table.list tbody tr:nth-child(even) td { background: var(--zebra); }
table.list td.c-no { color: var(--muted); }
table.list td.c-sail { font-weight: 700; }
table.list td.c-sailor { font-weight: 600; }
table.list td.c-club,
table.list td.c-subgroup,
table.list td.c-model { color: var(--muted); }
table.list tbody.together { break-inside: avoid; page-break-inside: avoid; }
table.list tr.band td {
  padding: 1.6mm 3mm;
  border-left: 2.2mm solid #07463a;
  border-bottom: none;
  background: #0b6b57 !important;
  color: #fff;
  font-size: 10.5pt;
  font-weight: 700;
}
table.list tr.band { break-after: avoid; page-break-after: avoid; }
table.list tr.band td .group-meta { float: right; font-size: 8.5pt; font-weight: 400; }
table.list tr.band .flag { box-shadow: 0 0 0 0.2mm rgba(255, 255, 255, 0.7); }
`;

interface WrapOptions {
  language: CommonDocumentOptions['language'];
  title: string;
  orientation: Orientation;
  /** Text of the page footer: event name, and "generated by". */
  footerLeft: string;
  footerCenter: string;
  body: string;
  extraCss: string;
  context: DocumentContext;
  pageLabel: string;
  ofLabel: string;
}

/**
 * The whole HTML file. The page size and margins are in CSS (so the browser
 * print dialog and Electron's printToPDF agree); page numbers are printed by
 * CSS margin boxes unless the PDF path adds its own footer.
 */
export const wrapDocument = ({
  language,
  title,
  orientation,
  footerLeft,
  footerCenter,
  body,
  extraCss,
  context,
  pageLabel,
  ofLabel,
}: WrapOptions): string => {
  const pageRule = `@page { size: A4 ${orientation}; margin: ${MARGIN_MM.top}mm ${MARGIN_MM.right}mm ${MARGIN_MM.bottom}mm ${MARGIN_MM.left}mm; }`;
  // Margin boxes (Chromium 131+, so Electron 42): a separate block, so an
  // engine that does not know them still keeps the size and margins above.
  const marginBoxes =
    context.target === 'pdf'
      ? ''
      : `@page {
  @bottom-left { content: ${cssString(footerLeft)}; font: 7.5pt "Segoe UI", Arial, sans-serif; color: #566274; }
  @bottom-center { content: ${cssString(footerCenter)}; font: 7.5pt "Segoe UI", Arial, sans-serif; color: #566274; }
  @bottom-right { content: ${cssString(`${pageLabel} `)} counter(page) ${cssString(` ${ofLabel} `)} counter(pages); font: 7.5pt "Segoe UI", Arial, sans-serif; color: #566274; }
}`;
  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${BASE_CSS}
${pageRule}
${marginBoxes}
${extraCss}
</style>
</head>
<body class="orientation-${orientation}">
${body}
</body>
</html>
`;
};

/** The badge for a status; nothing when the document has none. */
const statusBadge = (
  status: DocumentStatus | null,
  label: string | undefined,
): string => {
  if (!status || !label) return '';
  const style = STATUS_BADGE[status];
  return `<div class="badge badge-${status}" style="background:${style.background};color:${style.color};border-color:${style.border}">${escapeHtml(label)}</div>`;
};

interface HeaderOptions {
  common: CommonDocumentOptions;
  context: DocumentContext;
  title: string;
  /** Show the "as of" line on the right of the title bar. */
  asOf: boolean;
  /** Its wording; "Results as of" unless given. */
  asOfLabel?: string;
  /** Label of the status badge, already in the document's language. */
  statusLabel?: string;
  /** Extra line under the title bar (race counts and so on), plain text. */
  summary?: string;
}

/** Logo, event name and details, status badge, title and the as-of line. */
export const renderHeader = ({
  common,
  context,
  title,
  asOf,
  asOfLabel = undefined,
  statusLabel = undefined,
  summary = undefined,
}: HeaderOptions): string => {
  const strings = stringsFor(common.language);
  const { event } = context;
  const dates = [
    formatEventDate(event.startDate),
    formatEventDate(event.endDate),
  ]
    .filter(Boolean)
    .filter((date, index, all) => index === 0 || date !== all[0])
    .join(' – ');
  const meta = [
    event.venue,
    dates,
    event.boatClass ? `${strings.boatClass} ${event.boatClass}` : '',
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => escapeHtml(part))
    .join('<span class="sep">|</span>');
  const logo =
    event.logo &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(event.logo)
      ? `<img class="doc-logo" src="${event.logo}" alt="">`
      : '';
  const asOfText = asOf
    ? `<p class="asof">${escapeHtml(asOfLabel ?? strings.resultsAsOf)} ${escapeHtml(formatDateTimeShort(context.generatedAt))}</p>`
    : '';
  return `<header class="doc-head">
${logo}
<div class="doc-event">
<h1>${escapeHtml(event.name)}</h1>
<p class="doc-meta">${meta}</p>
</div>
${statusBadge(common.status, statusLabel)}
</header>
<div class="doc-titlebar">
<h2>${escapeHtml(title)}</h2>
${asOfText}
</div>
${summary ? `<p class="doc-summary">${escapeHtml(summary)}</p>` : ''}`;
};

/** The signature lines, or nothing when they are switched off. */
export const renderSignatures = (common: CommonDocumentOptions): string => {
  if (!common.signatures.enabled) return '';
  const defaults = defaultSignatureLabels(common.language);
  const lines = common.signatures.labels
    .map((label, index) => label.trim() || defaults[index])
    .map((label) => `<div class="line">${escapeHtml(label)}</div>`)
    .join('\n');
  return `<div class="signatures">\n${lines}\n</div>`;
};

/** The small end-of-document line shown on screen (print has page footers). */
export const renderScreenFooter = (
  common: CommonDocumentOptions,
  context: DocumentContext,
): string => {
  const strings = stringsFor(common.language);
  return `<p class="doc-foot">${escapeHtml(context.event.name)} · ${escapeHtml(strings.generatedBy)} · ${escapeHtml(formatDateTimeShort(context.generatedAt))}</p>`;
};

/** Words for the PDF page footer, in the document's language. */
export const pageFooterTexts = (
  common: CommonDocumentOptions,
  context: DocumentContext,
): { left: string; center: string; page: string; of: string } => {
  const strings = stringsFor(common.language);
  return {
    left: context.event.name,
    center: strings.generatedBy,
    page: strings.page,
    of: strings.of,
  };
};
