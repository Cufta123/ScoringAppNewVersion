/**
 * The pure parts of saving and printing an exported document: file names,
 * the end-to-end test hook's directory, and the PDF page footer.
 */
import path from 'path';
import type { PdfFooterText } from '../../shared/exportTypes';

/** Largest document the window may send (a 80-boat, 16-race sheet is ~200 KB). */
export const MAX_DOCUMENT_CHARS = 40 * 1024 * 1024;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] as string,
  );

/**
 * A safe file name: no folders, nothing a file system dislikes, and the
 * wanted extension (added when missing, never doubled).
 */
export const cleanFileName = (name: string, extension: string): string => {
  const base = path
    .basename(String(name ?? '').replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const stem = base.toLowerCase().endsWith(`.${extension}`)
    ? base.slice(0, -(extension.length + 1))
    : base;
  return `${(stem || 'document').slice(0, 120)}.${extension}`;
};

/**
 * End-to-end test hook. When SCORING_APP_EXPORT_DIR is set AND the app runs
 * hidden for the e2e tests (SCORING_APP_HIDDEN === '1', set only by
 * e2e/helpers.ts), exports are written straight into that directory under
 * their suggested file name, with no save dialog, and Print does nothing.
 * Without both variables this returns null and the real dialogs are used, so
 * an ordinary run can never be redirected by a stray variable.
 */
export const testExportDirectory = (
  env: Record<string, string | undefined> = process.env,
): string | null => {
  const dir = env.SCORING_APP_EXPORT_DIR;
  return env.SCORING_APP_HIDDEN === '1' && dir ? dir : null;
};

/**
 * The HTML of the PDF page footer: event name on the left, who made it in the
 * middle, "Page 2 of 5" on the right. Chromium fills the two <span>s.
 */
export const pdfFooterTemplate = (footer: PdfFooterText): string =>
  `<div style="box-sizing:border-box;width:100%;padding:0 10mm;display:flex;justify-content:space-between;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#566274;">` +
  `<span style="flex:1;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(footer.left)}</span>` +
  `<span style="flex:1;text-align:center;white-space:nowrap;">${escapeHtml(footer.center)}</span>` +
  `<span style="flex:1;text-align:right;white-space:nowrap;">${escapeHtml(footer.page)} <span class="pageNumber"></span> ${escapeHtml(footer.of)} <span class="totalPages"></span></span>` +
  `</div>`;
