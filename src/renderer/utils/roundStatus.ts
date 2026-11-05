import { nextInRound } from 'regatta-core';
import { getLastHeats, type HeatWithBoats } from './heatView';
import { getHeatRoundFromName } from '../../shared/heatNames';

/** What the race officer does next on the Scoring page. */
export type NextStep<H> =
  /** Score this heat's next race. */
  | { kind: 'score'; heat: H; race: number }
  /** Every heat of the round is scored: build the next round (SHRS 3). */
  | { kind: 'createRound'; round: number };

export interface RoundStatus<H> {
  phase: 'qualifying' | 'final';
  /** One line: "Round 4 · 1 of 3 heats scored". */
  summary: string;
  next: NextStep<H> | null;
  /** The current qualifying round was built from results and can be undone. */
  canUndoRedistribution: boolean;
}

type ShownHeat = Pick<
  HeatWithBoats,
  'heat_name' | 'heat_type' | 'raceNumber' | 'boats'
>;

/**
 * Where the heats stand and the one next step, for the Scoring page's round
 * bar. Which heat sails next is regatta-core's (`nextInRound`); this only
 * words it.
 */
export function roundStatus<H extends ShownHeat>(
  heats: H[],
  { finalSeriesStarted }: { finalSeriesStarted: boolean },
): RoundStatus<H> | null {
  const current = getLastHeats(heats);
  const phase = finalSeriesStarted ? 'final' : 'qualifying';
  const step = nextInRound(
    current.map((heat) => ({
      heat,
      boats: heat.boats.length,
      races: heat.raceNumber,
    })),
    phase,
  );
  if (!step) return null;

  if (!finalSeriesStarted && current.length > 1) {
    const round = getHeatRoundFromName(current[0].heat_name) ?? 1;
    const scored = current.filter((heat) => heat.raceNumber > 0).length;
    return {
      phase,
      summary: `Round ${round} · ${scored} of ${current.length} heats scored`,
      next:
        step.kind === 'score'
          ? step
          : { kind: 'createRound', round: round + 1 },
      canUndoRedistribution: round > 1,
    };
  }

  const race = step.kind === 'score' ? step.race : 1;
  const done = current.filter((heat) => heat.raceNumber >= race).length;
  const unit = finalSeriesStarted ? 'fleets' : 'heats';
  return {
    phase,
    summary:
      current.length === 1
        ? `Race ${race} next`
        : `Race ${race} · ${done} of ${current.length} ${unit} scored`,
    next: step.kind === 'score' ? step : null,
    canUndoRedistribution: false,
  };
}
