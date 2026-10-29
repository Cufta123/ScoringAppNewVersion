/**
 * What the window and the main process say to each other when a document is
 * saved or printed (IPC channels exportDocumentPdf, exportDocumentFile and
 * printDocument). One definition for both sides.
 */

/** Words printed in the PDF page footer, already in the document's language. */
export interface PdfFooterText {
  left: string;
  center: string;
  page: string;
  of: string;
}

export interface ExportPdfRequest {
  /** The complete, self-contained HTML document. */
  html: string;
  landscape: boolean;
  /** Suggested name in the save dialog, with or without ".pdf". */
  defaultFileName: string;
  footer: PdfFooterText;
}

export type ExportFileExtension = 'xlsx' | 'html' | 'csv' | 'txt' | 'md';

export interface ExportFileRequest {
  /** Text (HTML, CSV, text, Markdown) or the bytes of a workbook. */
  data: string | Uint8Array;
  defaultFileName: string;
  extension: ExportFileExtension;
}

export interface PrintDocumentRequest {
  html: string;
  landscape: boolean;
}

/**
 * How an export ended. Cancelling the save dialog or the print dialog is a
 * normal answer, not an error; `skipped` is only ever returned by the end-to-end
 * test hook (see ExportHandler.ts), which never opens a printer dialog.
 */
export type ExportResult =
  | { status: 'saved'; filePath: string }
  | { status: 'printed' }
  | { status: 'canceled' }
  | { status: 'skipped' };
