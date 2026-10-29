/**
 * Saving and printing the exported documents.
 *
 * The window builds one complete HTML document per export (src/renderer/exports)
 * and hands it over here. The PDF is rendered by Electron from that same HTML:
 * it is written to a temp file, loaded in a hidden window with no scripts, no
 * preload and no Node, printed with `printToPDF`, and the window and the temp
 * file are removed in every outcome. The other formats arrive ready-made and
 * only need the save dialog.
 *
 * Cancelling a dialog is a normal answer ({ status: 'canceled' }), never an
 * error. See `testExportDirectory` for the end-to-end test hook.
 */
import { BrowserWindow, app, dialog } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import path from 'path';
import handle from './handle';
import {
  MAX_DOCUMENT_CHARS,
  cleanFileName,
  pdfFooterTemplate,
  testExportDirectory,
} from '../functions/exportDocument';
import type {
  ExportFileRequest,
  ExportPdfRequest,
  ExportResult,
  PrintDocumentRequest,
} from '../../shared/exportTypes';

const FILTER_NAMES: Record<string, string> = {
  pdf: 'PDF document',
  xlsx: 'Excel workbook',
  html: 'HTML page',
  csv: 'CSV file',
  txt: 'Text file',
  md: 'Markdown file',
};

const EXTENSIONS = new Set(Object.keys(FILTER_NAMES));

const refuse = (what: string): never => {
  throw new Error(
    `${what} Close the export window and open it again; if it keeps happening, restart the app.`,
  );
};

const requireHtml = (html: unknown): string => {
  if (typeof html !== 'string' || html.trim() === '') {
    return refuse('There was no document to save.');
  }
  if (html.length > MAX_DOCUMENT_CHARS) {
    return refuse('The document is too large to export.');
  }
  return html;
};

/**
 * The file to write: the test directory's file under its suggested name, or
 * the one the user picks. null when the user cancels.
 */
const chooseTarget = async (
  event: IpcMainInvokeEvent,
  defaultFileName: string,
  extension: string,
): Promise<string | null> => {
  const fileName = cleanFileName(defaultFileName, extension);
  const testDir = testExportDirectory();
  if (testDir) {
    await fs.promises.mkdir(testDir, { recursive: true });
    return path.join(testDir, fileName);
  }
  const options = {
    title: 'Save document',
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: [{ name: FILTER_NAMES[extension], extensions: [extension] }],
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
};

/**
 * Load `html` in a hidden, locked-down window and run `use` on it. The window
 * and the temp file are always cleaned up, whatever `use` does.
 */
const withDocumentWindow = async <T>(
  html: string,
  use: (window: BrowserWindow) => Promise<T>,
): Promise<T> => {
  let directory: string | null = null;
  let window: BrowserWindow | null = null;
  try {
    directory = await fs.promises.mkdtemp(
      path.join(app.getPath('temp'), 'iom-export-'),
    );
    const file = path.join(directory, 'document.html');
    await fs.promises.writeFile(file, html, 'utf8');
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        javascript: false,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        // Its own throw-away session: none of the app window's request hooks
        // (or its content policy) apply to a printed page.
        partition: 'export-document',
      },
    });
    // The page is static: it may not open windows or go anywhere else.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (navigation) =>
      navigation.preventDefault(),
    );
    await window.loadFile(file);
    return await use(window);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    if (directory) {
      await fs.promises
        .rm(directory, { recursive: true, force: true })
        .catch(() => {});
    }
  }
};

handle(
  'exportDocumentPdf',
  async (event, request: ExportPdfRequest): Promise<ExportResult> => {
    const html = requireHtml(request?.html);
    const pdf = await withDocumentWindow(html, (window) =>
      window.webContents.printToPDF({
        pageSize: 'A4',
        landscape: Boolean(request.landscape),
        printBackground: true,
        // Page size and margins are in the document's own CSS (@page), so the
        // PDF, the printout and the HTML file agree.
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: pdfFooterTemplate(request.footer),
      }),
    );
    const target = await chooseTarget(event, request.defaultFileName, 'pdf');
    if (!target) return { status: 'canceled' };
    await fs.promises.writeFile(target, pdf);
    return { status: 'saved', filePath: target };
  },
);

handle(
  'exportDocumentFile',
  async (event, request: ExportFileRequest): Promise<ExportResult> => {
    const extension = String(request?.extension);
    if (!EXTENSIONS.has(extension) || extension === 'pdf') {
      return refuse('This kind of file cannot be saved.');
    }
    const { data } = request;
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
      return refuse('There was nothing to save.');
    }
    const target = await chooseTarget(
      event,
      request.defaultFileName,
      extension,
    );
    if (!target) return { status: 'canceled' };
    await fs.promises.writeFile(
      target,
      typeof data === 'string' ? data : Buffer.from(data),
    );
    return { status: 'saved', filePath: target };
  },
);

handle(
  'printDocument',
  async (_event, request: PrintDocumentRequest): Promise<ExportResult> => {
    const html = requireHtml(request?.html);
    // The end-to-end tests have no printer and nobody to press Print.
    if (testExportDirectory()) return { status: 'skipped' };
    return withDocumentWindow(
      html,
      (window) =>
        new Promise<ExportResult>((resolve, reject) => {
          window.webContents.print(
            {
              silent: false,
              printBackground: true,
              landscape: Boolean(request.landscape),
            },
            (success, reason) => {
              if (success) resolve({ status: 'printed' });
              else if (/cancel/i.test(reason ?? '')) {
                resolve({ status: 'canceled' });
              } else {
                reject(
                  new Error(
                    'The document could not be printed. Check that a printer is installed and switched on, or save the PDF and print that.',
                  ),
                );
              }
            },
          );
        }),
    );
  },
);
