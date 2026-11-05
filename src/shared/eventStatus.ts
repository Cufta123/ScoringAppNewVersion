/**
 * `readEventStatus`: where an event stands and what the race office may do
 * now, as regatta-core's `eventStatus` decides it, with the library's heat
 * ids turned into the app's heats (id and name). The Scoring page's round
 * bar and heat cards and the entries page's summary show this; they decide
 * nothing about rounds or series themselves.
 */
import type { FinalSeriesEligibility } from './finalSeriesEligibility';

/**
 * An action: `ok` when the rules allow it now (exactly what the library's
 * replay would accept), else the reason in words; `offered` when it belongs
 * to this point of the event, so the screen shows it (enabled or with the
 * reason).
 */
export type StatusAction =
  | { ok: true; offered: boolean }
  | { ok: false; offered: boolean; reason: string };

/** A heat of the round being sailed, or a final fleet. */
export interface StatusHeat {
  heat_id: number;
  /** As the screens name it: "Heat A3", "Final Gold". */
  heat_name: string;
  boat_ids: number[];
  /** Races sailed. */
  races: number;
  /** Score its next race (`races + 1`). */
  score: StatusAction;
  /** Undo its last race. */
  undoRace: StatusAction;
}

export type StatusNextStep =
  | { kind: 'enterBoats' }
  | { kind: 'createHeats' }
  | { kind: 'score'; heat_id: number; heat_name: string; race: number }
  /** The qualifying round is sailed: round `round`, or the Final Series. */
  | { kind: 'createRound'; round: number; finalSeries: boolean };

export interface EventStatusView {
  series: 'entries' | 'qualifying' | 'final';
  /** The qualifying round being sailed; null before the heats and in the Final. */
  round: number | null;
  /** That round's heats, or the final fleets, in order. */
  heats: StatusHeat[];
  next: StatusNextStep;
  createRound: StatusAction;
  undoRound: StatusAction;
  /** With the eligibility the Start Final Series questions are worded from. */
  startFinal: StatusAction & { eligibility: FinalSeriesEligibility };
}
