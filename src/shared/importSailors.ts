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
