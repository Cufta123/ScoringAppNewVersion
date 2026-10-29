/** @jest-environment node */
export {};

/**
 * Saving and printing documents, with Electron mocked: the PDF is rendered in a
 * hidden, locked-down window; the window and the temp file are removed on
 * success, on cancel and on failure; cancelling a dialog is not an error; and
 * the end-to-end test hook only works together with SCORING_APP_HIDDEN=1.
 */
/* eslint-disable import/first */
import fs from 'fs';
import os from 'os';
import path from 'path';

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

const windows: any[] = [];
const mockWindowBehaviour = {
  loadFile: jest.fn(async (_file: string) => {}),
  printToPDF: jest.fn(async (_options: any) => Buffer.from('%PDF-fake')),
  print: jest.fn((_options: any, callback: any) => callback(true, '')),
};
let loadedHtml = '';

class MockBrowserWindow {
  static fromWebContents = jest.fn(() => ({ parent: true }));

  destroyed = false;

  options: any;

  webContents = {
    printToPDF: (options: any) => mockWindowBehaviour.printToPDF(options),
    print: (options: any, callback: any) =>
      mockWindowBehaviour.print(options, callback),
    setWindowOpenHandler: jest.fn(),
    on: jest.fn(),
  };

  constructor(options: any) {
    this.options = options;
    windows.push(this);
  }

  // eslint-disable-next-line class-methods-use-this
  async loadFile(file: string) {
    loadedHtml = fs.readFileSync(file, 'utf8');
    return mockWindowBehaviour.loadFile(file);
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

const mockShowSaveDialog = jest.fn();
let tempRoot = '';

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
  BrowserWindow: MockBrowserWindow,
  dialog: {
    showSaveDialog: (...args: any[]) => mockShowSaveDialog(...args),
  },
  app: {
    getPath: jest.fn((name: string) =>
      name === 'temp' ? tempRoot : path.join(tempRoot, 'documents'),
    ),
  },
}));

// eslint-disable-next-line import/first, import/order
import {
  cleanFileName,
  pdfFooterTemplate,
  testExportDirectory,
} from '../main/functions/exportDocument';

const call = (channel: string, request: any) =>
  handlerRegistry[channel]({ sender: {} }, request);

const exportTempDirs = () =>
  fs.readdirSync(tempRoot).filter((name) => name.startsWith('iom-export-'));

const PDF_REQUEST = {
  html: '<!DOCTYPE html><html><body>Hello</body></html>',
  landscape: true,
  defaultFileName: 'Kup_results',
  footer: { left: 'Kup & <Cup>', center: 'Generated', page: 'Page', of: 'of' },
};

describe('ExportHandler', () => {
  let target: string;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/ExportHandler');
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iom-handler-test-'));
    target = path.join(tempRoot, 'out.pdf');
    windows.length = 0;
    loadedHtml = '';
    delete process.env.SCORING_APP_EXPORT_DIR;
    delete process.env.SCORING_APP_HIDDEN;
    mockShowSaveDialog.mockReset();
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    mockWindowBehaviour.loadFile.mockClear();
    mockWindowBehaviour.printToPDF.mockReset();
    mockWindowBehaviour.printToPDF.mockResolvedValue(Buffer.from('%PDF-fake'));
    mockWindowBehaviour.print.mockReset();
    mockWindowBehaviour.print.mockImplementation((_o: any, cb: any) =>
      cb(true, ''),
    );
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  describe('PDF', () => {
    it('renders the HTML in a locked-down hidden window and saves the PDF', async () => {
      const result = await call('exportDocumentPdf', PDF_REQUEST);

      expect(result).toEqual({ status: 'saved', filePath: target });
      expect(fs.readFileSync(target, 'utf8')).toBe('%PDF-fake');
      expect(loadedHtml).toBe(PDF_REQUEST.html);

      const [window] = windows;
      expect(window.options.show).toBe(false);
      expect(window.options.webPreferences).toMatchObject({
        javascript: false,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      });
      expect(window.options.webPreferences.preload).toBeUndefined();
      expect(window.webContents.setWindowOpenHandler).toHaveBeenCalled();

      const options = mockWindowBehaviour.printToPDF.mock.calls[0][0];
      expect(options).toMatchObject({
        pageSize: 'A4',
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        preferCSSPageSize: true,
      });
      // The footer: page x of y, the event name and who made it, all escaped.
      expect(options.footerTemplate).toContain('class="pageNumber"');
      expect(options.footerTemplate).toContain('class="totalPages"');
      expect(options.footerTemplate).toContain('Kup &amp; &lt;Cup&gt;');
      expect(options.footerTemplate).toContain('Generated');
      expect(mockShowSaveDialog.mock.calls[0][1].defaultPath).toMatch(
        /Kup_results\.pdf$/,
      );
    });

    it('cleans up the window and the temp file after success', async () => {
      await call('exportDocumentPdf', PDF_REQUEST);
      expect(windows.every((w) => w.destroyed)).toBe(true);
      expect(exportTempDirs()).toEqual([]);
    });

    it('cancelling the save dialog is not an error, and still cleans up', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true });
      await expect(call('exportDocumentPdf', PDF_REQUEST)).resolves.toEqual({
        status: 'canceled',
      });
      expect(fs.existsSync(target)).toBe(false);
      expect(windows.every((w) => w.destroyed)).toBe(true);
      expect(exportTempDirs()).toEqual([]);
    });

    it('cleans up when the page fails to load', async () => {
      mockWindowBehaviour.loadFile.mockRejectedValueOnce(
        new Error('ERR_FAILED'),
      );
      await expect(call('exportDocumentPdf', PDF_REQUEST)).rejects.toThrow();
      expect(windows.every((w) => w.destroyed)).toBe(true);
      expect(exportTempDirs()).toEqual([]);
      expect(mockShowSaveDialog).not.toHaveBeenCalled();
    });

    it('cleans up when printing to PDF fails', async () => {
      mockWindowBehaviour.printToPDF.mockRejectedValueOnce(
        new Error('print failed'),
      );
      await expect(call('exportDocumentPdf', PDF_REQUEST)).rejects.toThrow();
      expect(windows.every((w) => w.destroyed)).toBe(true);
      expect(exportTempDirs()).toEqual([]);
    });

    it('a file that cannot be written is an error, after cleaning up', async () => {
      mockShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: path.join(tempRoot, 'no-such-folder', 'x.pdf'),
      });
      await expect(call('exportDocumentPdf', PDF_REQUEST)).rejects.toThrow();
      expect(windows.every((w) => w.destroyed)).toBe(true);
      expect(exportTempDirs()).toEqual([]);
    });

    it('refuses a request with no document, in plain words', async () => {
      await expect(
        call('exportDocumentPdf', { ...PDF_REQUEST, html: '' }),
      ).rejects.toThrow(/no document/);
      expect(windows).toHaveLength(0);
    });
  });

  describe('other formats', () => {
    it('saves text and workbooks through the save dialog', async () => {
      const csv = path.join(tempRoot, 'r.csv');
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: csv });
      await expect(
        call('exportDocumentFile', {
          data: 'a,b\n1,2\n',
          defaultFileName: 'r',
          extension: 'csv',
        }),
      ).resolves.toEqual({ status: 'saved', filePath: csv });
      expect(fs.readFileSync(csv, 'utf8')).toBe('a,b\n1,2\n');

      const xlsx = path.join(tempRoot, 'r.xlsx');
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: xlsx });
      await call('exportDocumentFile', {
        data: new Uint8Array([80, 75, 3, 4]),
        defaultFileName: 'r.xlsx',
        extension: 'xlsx',
      });
      expect([...fs.readFileSync(xlsx)]).toEqual([80, 75, 3, 4]);
      expect(mockShowSaveDialog.mock.calls[1][1].filters[0].extensions).toEqual(
        ['xlsx'],
      );
    });

    it('cancel is not an error; unknown extensions are refused', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true });
      await expect(
        call('exportDocumentFile', {
          data: 'x',
          defaultFileName: 'r',
          extension: 'txt',
        }),
      ).resolves.toEqual({ status: 'canceled' });
      await expect(
        call('exportDocumentFile', {
          data: 'x',
          defaultFileName: 'r',
          extension: 'exe',
        }),
      ).rejects.toThrow(/cannot be saved/);
      await expect(
        call('exportDocumentFile', {
          data: 42,
          defaultFileName: 'r',
          extension: 'txt',
        }),
      ).rejects.toThrow(/nothing to save/);
    });
  });

  describe('print', () => {
    it('opens the print dialog for the same document and cleans up', async () => {
      await expect(
        call('printDocument', { html: PDF_REQUEST.html, landscape: false }),
      ).resolves.toEqual({ status: 'printed' });
      expect(mockWindowBehaviour.print.mock.calls[0][0]).toMatchObject({
        silent: false,
        printBackground: true,
        landscape: false,
      });
      expect(windows.every((w) => w.destroyed)).toBe(true);
      expect(exportTempDirs()).toEqual([]);
    });

    it('cancelling the print dialog is not an error', async () => {
      mockWindowBehaviour.print.mockImplementation((_o: any, cb: any) =>
        cb(false, 'cancelled'),
      );
      await expect(
        call('printDocument', { html: PDF_REQUEST.html, landscape: false }),
      ).resolves.toEqual({ status: 'canceled' });
      expect(windows.every((w) => w.destroyed)).toBe(true);
    });

    it('a printer failure is an error in plain words, after cleaning up', async () => {
      mockWindowBehaviour.print.mockImplementation((_o: any, cb: any) =>
        cb(false, 'Invalid printer settings'),
      );
      await expect(
        call('printDocument', { html: PDF_REQUEST.html, landscape: false }),
      ).rejects.toThrow(/could not be printed/);
      expect(windows.every((w) => w.destroyed)).toBe(true);
      expect(exportTempDirs()).toEqual([]);
    });
  });

  describe('end-to-end test hook (SCORING_APP_EXPORT_DIR)', () => {
    it('writes straight into the directory, with no dialog, only when the app runs hidden', async () => {
      const dir = path.join(tempRoot, 'exports');
      process.env.SCORING_APP_EXPORT_DIR = dir;
      process.env.SCORING_APP_HIDDEN = '1';

      const result = await call('exportDocumentPdf', PDF_REQUEST);
      expect(result).toEqual({
        status: 'saved',
        filePath: path.join(dir, 'Kup_results.pdf'),
      });
      expect(fs.existsSync(path.join(dir, 'Kup_results.pdf'))).toBe(true);
      expect(mockShowSaveDialog).not.toHaveBeenCalled();

      await call('exportDocumentFile', {
        data: 'x',
        defaultFileName: '../../evil name.txt',
        extension: 'txt',
      });
      expect(fs.existsSync(path.join(dir, 'evil name.txt'))).toBe(true);

      // Print is skipped: no printer, nobody to press Print.
      await expect(
        call('printDocument', { html: PDF_REQUEST.html, landscape: false }),
      ).resolves.toEqual({ status: 'skipped' });
      expect(mockWindowBehaviour.print).not.toHaveBeenCalled();
    });

    it('is ignored without SCORING_APP_HIDDEN=1 (a stray variable never redirects an export)', async () => {
      process.env.SCORING_APP_EXPORT_DIR = path.join(tempRoot, 'exports');
      await call('exportDocumentPdf', PDF_REQUEST);
      expect(mockShowSaveDialog).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(tempRoot, 'exports'))).toBe(false);
      expect(
        testExportDirectory({
          SCORING_APP_EXPORT_DIR: 'x',
          SCORING_APP_HIDDEN: '',
        }),
      ).toBeNull();
      expect(testExportDirectory({ SCORING_APP_HIDDEN: '1' })).toBeNull();
      expect(
        testExportDirectory({
          SCORING_APP_EXPORT_DIR: 'x',
          SCORING_APP_HIDDEN: '1',
        }),
      ).toBe('x');
    });
  });
});

describe('cleanFileName / pdfFooterTemplate', () => {
  it('keeps names inside one folder and gives them their extension once', () => {
    expect(cleanFileName('../../etc/passwd', 'txt')).toBe('passwd.txt');
    expect(cleanFileName('C:\\x\\y.pdf', 'pdf')).toBe('y.pdf');
    expect(cleanFileName('a<b>:c.PDF', 'pdf')).toBe('a_b_c.pdf');
    expect(cleanFileName('', 'csv')).toBe('document.csv');
    expect(cleanFileName('Kup Kvarnera.xlsx', 'xlsx')).toBe(
      'Kup Kvarnera.xlsx',
    );
  });

  it('escapes the footer text', () => {
    const html = pdfFooterTemplate({
      left: '<b>',
      center: '"',
      page: 'P',
      of: 'o',
    });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&quot;');
  });
});
