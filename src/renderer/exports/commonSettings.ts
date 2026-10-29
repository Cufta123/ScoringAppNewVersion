/**
 * The options every export dialog has (language, title, status, orientation,
 * signature lines) as the dialog keeps them, and how they become the options
 * the document builders take.
 */
import { defaultSignatureLabels } from './i18n';
import type {
  CommonDocumentOptions,
  DocumentStatus,
  ExportEventInfo,
  ExportLanguage,
  OrientationChoice,
} from './types';
import type { EventRow } from '../types';

export interface CommonSettings {
  language: ExportLanguage;
  /** What the user typed; '' follows the default title of the language. */
  title: string;
  status: DocumentStatus;
  orientation: OrientationChoice;
  signatures: {
    enabled: boolean;
    /** '' follows the default label of the language. */
    left: string;
    right: string;
  };
}

export const DEFAULT_COMMON_SETTINGS: CommonSettings = {
  language: 'en',
  title: '',
  status: 'provisional',
  orientation: 'auto',
  signatures: { enabled: false, left: '', right: '' },
};

/** The builders' options; `withStatus` false for documents with no status. */
export const toCommonOptions = (
  settings: CommonSettings,
  withStatus: boolean,
): CommonDocumentOptions => ({
  language: settings.language,
  title: settings.title,
  status: withStatus ? settings.status : null,
  signatures: {
    enabled: settings.signatures.enabled,
    labels: [settings.signatures.left, settings.signatures.right],
  },
});

/** What a signature field shows: the typed label, or the language's default. */
export const signatureLabelShown = (
  settings: CommonSettings,
  side: 'left' | 'right',
): string =>
  settings.signatures[side] ||
  defaultSignatureLabels(settings.language)[side === 'left' ? 0 : 1];

/** The header's event details, from the event row and its logo. */
export const eventInfoOf = (
  event: Pick<
    EventRow,
    'event_name' | 'event_location' | 'start_date' | 'end_date'
  >,
  logo: string | null,
): ExportEventInfo => ({
  name: event.event_name,
  venue: event.event_location,
  startDate: event.start_date,
  endDate: event.end_date,
  boatClass: 'IOM',
  logo,
});
