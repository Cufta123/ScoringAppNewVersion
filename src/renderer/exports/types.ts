/**
 * The vocabulary shared by every exported document: the language, the status
 * badge, the page orientation, and the event details every header shows.
 */

import type { PdfFooterText } from '../../shared/exportTypes';

export type ExportLanguage = 'en' | 'hr';

/** Status badge of a results sheet (Provisional is amber, Final is dark). */
export type DocumentStatus = 'provisional' | 'official' | 'final';

export type OrientationChoice = 'auto' | 'portrait' | 'landscape';
export type Orientation = 'portrait' | 'landscape';

/** What the document header says about the event. */
export interface ExportEventInfo {
  name: string;
  venue: string;
  /** ISO dates as stored ("2026-06-01"); formatted with utils/formatDate. */
  startDate: string;
  endDate: string;
  /** Boat class printed in the header. */
  boatClass: string;
  /** PNG / JPEG data URL, or null when the event has no logo. */
  logo: string | null;
}

/** Labels of the signature lines, as the user typed them. */
export interface SignatureOptions {
  enabled: boolean;
  /** Left and right label; empty text falls back to the language default. */
  labels: [string, string];
}

/** What every document type takes besides its own options. */
export interface CommonDocumentOptions {
  language: ExportLanguage;
  /** Heading of the document; empty text falls back to the default title. */
  title: string;
  /** null for documents with no status (heat lists). */
  status: DocumentStatus | null;
  signatures: SignatureOptions;
}

/**
 * Where the HTML is going. `pdf` leaves the page numbers to Electron's own
 * footer; every other target prints them with CSS page margin boxes.
 */
export type HtmlTarget = 'screen' | 'pdf';

/** Everything a builder needs that is not an option. */
export interface DocumentContext {
  event: ExportEventInfo;
  /** The moment the document was made: "Results as of ...". */
  generatedAt: Date;
  /**
   * Flag images by country code (a data URL each), made by exports/flags.ts.
   * A country without one is shown as its code only.
   */
  flags: Record<string, string>;
  target: HtmlTarget;
}

/** One document ready to be saved, printed or shown in the preview. */
export interface BuiltDocument {
  html: string;
  orientation: Orientation;
  /** Name without extension: "Kup_Kvarnera_2026_results". */
  fileBase: string;
  /** The words of the PDF page footer. */
  footer: PdfFooterText;
}
