/**
 * The shape of "how was this score calculated?" (IPC `explainBoatScore`),
 * one definition for both processes. The explanation itself is regatta-core's
 * (`explainScore`), put into this shape by main/functions/libraryExplain.ts.
 */

/** One race of the boat's series, in race order. */
export interface ExplainRaceInput {
  race_id: number;
  race_number: number;
  /** Column label on the leaderboard, e.g. "Q3" or "F2". */
  label: string;
  status: string;
  position: number;
  points: number;
  /** RDG2: the races the protest committee chose to average. */
  rdg_race_ids?: number[] | null;
}

export interface Reason {
  /** e.g. "SHRS 5.2", "RRS A9(a)". Empty when no rule applies. */
  rule: string;
  text: string;
}

export interface ExplainedRace extends ExplainRaceInput {
  reason: Reason;
  excluded: boolean;
  /** Why this race was, or could not be, excluded, when that is not obvious. */
  exclusionNote?: Reason;
}

export interface SeriesExplanation {
  races: ExplainedRace[];
  discards: Reason & { count: number };
  gross: number;
  total: number;
}

export interface TieNote {
  boat_id: number;
  sail: string;
  /** null: still tied after every rule, so they share the place. */
  winnerBoatId: string | null;
  rule: string;
  note: string;
}

export interface SeriesBlock extends SeriesExplanation {
  largestHeat: number;
  seriesRaceCount: number;
  ties: TieNote[];
}

export interface BoatScoreExplanation {
  qualifying: SeriesBlock | null;
  final: (SeriesBlock & { fleet: string }) | null;
  /** SHRS 5.5, once the Final Series has started. */
  overall: { points: number; rule: string; text: string } | null;
}
