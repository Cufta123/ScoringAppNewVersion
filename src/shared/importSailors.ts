/**
 * The summary `importSailors` returns for a bulk sailor import. Defined once;
 * the main process builds it and the import screen shows it.
 */
export interface ImportSailorsSummary {
  /** New boats added to the database. */
  created: number;
  /** Existing boats newly added to this event. */
  associated: number;
  /** Boats that were already in this event. */
  alreadyInEvent: number;
  /** Rows missing required fields, or that failed. */
  invalid: number;
  /** Rows left out: the boat is registered to someone else. */
  ownerConflicts: number;
  /** One plain-English line per failed row. */
  errors: string[];
  /** created + associated (kept for older callers). */
  imported: number;
  /** alreadyInEvent + invalid + ownerConflicts (kept for older callers). */
  skipped: number;
}

/** A CSV row whose boat (letters + sail number) belongs to another sailor. */
export interface ImportOwnerConflict {
  /** Line in the file, the header being line 1. */
  line: number;
  /** "CRO 12". */
  sail: string;
  /** The name in the file. */
  fileName: string;
  /** The sailor the boat is registered to. */
  ownerName: string;
}

/**
 * One row of the import file as the window sends it (CSV columns, lower case;
 * see SailorImport). Any column can be missing: the main process checks name,
 * surname, sail number and country and counts a row without them as invalid.
 */
export interface ImportSailorRow {
  name?: string;
  surname?: string;
  birthday?: string;
  sail_number?: string | number;
  country?: string;
  model?: string;
  club_name?: string;
  category_name?: string;
  /** The event to enter the boat in; none only stores the sailor. */
  eventId?: number | string;
}

/** What to do with a row whose boat is registered to someone else. */
export interface ImportSailorsOptions {
  /**
   * 'skip' (the default) leaves those rows out; 'use-registered' enters the
   * boat under her registered sailor, as the add form does once asked.
   */
  ownerConflicts?: 'skip' | 'use-registered';
}

/**
 * What the window gets when the import call itself fails: the preload
 * resolves this instead of throwing, so the import screen shows the reason in
 * its summary (src/main/preload.ts).
 */
export interface ImportSailorsFailure {
  imported: 0;
  skipped: 0;
  errors: string[];
}

export type ImportSailorsResult = ImportSailorsSummary | ImportSailorsFailure;
