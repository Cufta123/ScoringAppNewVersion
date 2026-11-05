/**
 * Log builders for the scenarios ported from the app's old scoring tests
 * (src/__tests__, deleted with the old engine).
 */
import {
  replay,
  type Decision,
  type EventState,
  type NoPlaceCode,
  type PenaltyCode,
  type ProtestOutcome,
  type RaceLine,
} from '../../src';

/** A boat entered as `id`, national letters `nat`, sail number `sail`. */
export const enter = (id: string, nat = 'CRO', sail = id): Decision => ({
  type: 'boatEntered',
  boat: { id, nat, sail },
});

/** Boats b1 … bn: CRO 1 … CRO n. */
export const boats = (n: number): Decision[] =>
  Array.from({ length: n }, (_v, i) => enter(`b${i + 1}`, 'CRO', `${i + 1}`));

/**
 * One sheet line. `'b3'` finishes; `'b3:DNF'` has a code; `'b3:ZFP'` a
 * penalty; `'=b3'` is tied with the finisher above.
 */
export function line(spec: string): RaceLine {
  const tied = spec.startsWith('=');
  const [boat, mark] = (tied ? spec.slice(1) : spec).split(':');
  if (!mark) return tied ? { boat, tied } : { boat };
  if (['ZFP', 'SCP', 'T1'].includes(mark)) {
    return { boat, penalty: mark as PenaltyCode, ...(tied ? { tied } : {}) };
  }
  return { boat, code: mark as NoPlaceCode };
}

/** The heat's race as the race office recorded it, see `line`. */
export const sheet = (
  heat: string,
  race: number,
  ...specs: string[]
): Decision => ({
  type: 'raceScored',
  race: { heat, race },
  lines: specs.map(line),
});

export const correct = (
  heat: string,
  race: number,
  ...specs: string[]
): Decision => ({
  type: 'raceCorrected',
  race: { heat, race },
  lines: specs.map(line),
});

export const protest = (
  heat: string,
  race: number,
  boat: string,
  outcome: ProtestOutcome,
): Decision => ({
  type: 'protestDecided',
  race: { heat, race },
  boat,
  outcome,
});

/** The event after `log`; throws with the refusal if replay refuses. */
export function stateOf(log: readonly Decision[]): EventState {
  const result = replay(log);
  if (!result.ok) throw new Error(`#${result.at}: ${result.reason}`);
  return result.state;
}

/** The refusal's reason; throws if replay accepts the log. */
export function refusal(log: readonly Decision[]): string {
  const result = replay(log);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

/** Heat (or fleet) boats, sorted, for comparing assignments. */
export const heatBoats = (state: EventState, round: number) =>
  state.rounds[round - 1].map((heat) => [...heat.boats].sort());
