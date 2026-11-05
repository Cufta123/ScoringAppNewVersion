/**
 * What moving an event to regatta-core changed, as the leaderboard shows it
 * (IPC `readConversionReport`). Boats, heats and races are named as on
 * screen. Null from the channel when there is nothing to tell.
 */
export interface ConversionReport {
  /** When the event was moved (SQLite CURRENT_TIMESTAMP, UTC). */
  convertedAt: string;
  /** The race officer has confirmed it. */
  seen: boolean;
  /** Results scored differently from what the old app stored. */
  points: {
    race: string;
    boat: string;
    status: string;
    before: number;
    after: number;
  }[];
  /** Heats whose boats differ from what the old app stored. */
  heats: { heat: string; added: string[]; removed: string[] }[];
  /** What the old records held that the rules cannot express exactly. */
  notes: string[];
  /** The old records could not be replayed at all (the reason). */
  refused: string | null;
}
