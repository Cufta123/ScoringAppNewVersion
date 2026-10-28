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
  /** One plain-English line per failed row. */
  errors: string[];
  /** created + associated (kept for older callers). */
  imported: number;
  /** alreadyInEvent + invalid (kept for older callers). */
  skipped: number;
}
