/**
 * Saving, printing and reporting an exported document: the window's side of
 * the export IPC. The documents themselves are built by the builders in this
 * folder; here they are only handed to the main process and the outcome is
 * told to the user.
 */
import { exportDB } from '../api/db';
import { reportError, reportInfo } from '../utils/userFeedback';
import type { ExportResult } from '../../shared/exportTypes';
import type { BuiltDocument, HtmlTarget } from './types';

export type ExportFormat = 'pdf' | 'xlsx' | 'html' | 'csv' | 'txt' | 'md';

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF',
  xlsx: 'Excel',
  html: 'HTML',
  csv: 'CSV',
  txt: 'Text',
  md: 'Markdown',
};

/** What a document type can produce, ready to be saved or printed. */
export interface ExportJob {
  /** The HTML document (the PDF and print targets differ in page numbers). */
  buildDocument: (target: HtmlTarget) => BuiltDocument;
  buildWorkbook: () => Promise<Uint8Array>;
  /** The text formats; only the results sheet has them. */
  buildText?: (format: 'csv' | 'txt' | 'md') => string;
}

/**
 * UTF-8 byte order mark: Excel and older Windows programs only decode
 * diacritics (č, ć, š, ž, đ) correctly in a CSV or HTML file that has it.
 */
const BOM = '﻿';

const saveFile = (
  data: string | Uint8Array,
  fileBase: string,
  extension: 'xlsx' | 'html' | 'csv' | 'txt' | 'md',
): Promise<ExportResult> =>
  exportDB.exportDocumentFile({
    data,
    defaultFileName: `${fileBase}.${extension}`,
    extension,
  });

/** Produce one format and hand it to the main process to be saved. */
export const exportDocumentAs = async (
  format: ExportFormat,
  job: ExportJob,
): Promise<ExportResult> => {
  switch (format) {
    case 'pdf': {
      const document = job.buildDocument('pdf');
      return exportDB.exportDocumentPdf({
        html: document.html,
        landscape: document.orientation === 'landscape',
        defaultFileName: `${document.fileBase}.pdf`,
        footer: document.footer,
      });
    }
    case 'xlsx': {
      const document = job.buildDocument('screen');
      return saveFile(await job.buildWorkbook(), document.fileBase, 'xlsx');
    }
    case 'html': {
      const document = job.buildDocument('screen');
      return saveFile(`${BOM}${document.html}`, document.fileBase, 'html');
    }
    default: {
      if (!job.buildText) {
        throw new Error('This document cannot be saved in that format.');
      }
      const document = job.buildDocument('screen');
      const text = job.buildText(format);
      return saveFile(
        format === 'csv' ? `${BOM}${text}` : text,
        document.fileBase,
        format,
      );
    }
  }
};

/** Open the operating system's print dialog for the document. */
export const printDocument = (job: ExportJob): Promise<ExportResult> => {
  const document = job.buildDocument('screen');
  return exportDB.printDocument({
    html: document.html,
    landscape: document.orientation === 'landscape',
  });
};

/**
 * Export in one format and tell the user how it ended: "saved to ..." on
 * success, a plain error otherwise, nothing when they cancel the save dialog.
 * `what` names the document in those messages ("results", "starting list").
 */
export const runExport = async (
  what: string,
  format: ExportFormat,
  createJob: () => ExportJob,
): Promise<void> => {
  try {
    const result = await exportDocumentAs(format, createJob());
    if (result.status === 'saved') {
      reportInfo(
        `The ${what} were saved as ${FORMAT_LABELS[format]}: ${result.filePath}`,
        'Export complete',
      );
    }
  } catch (error) {
    reportError(
      `Could not export the ${what} as ${FORMAT_LABELS[format]}.`,
      error,
    );
  }
};

/** Print the document; only a failure is worth a message. */
export const runPrint = async (
  what: string,
  createJob: () => ExportJob,
): Promise<void> => {
  try {
    await printDocument(createJob());
  } catch (error) {
    reportError(`Could not print the ${what}.`, error);
  }
};
