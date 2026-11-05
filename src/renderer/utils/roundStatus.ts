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

/**
 * Where the heats stand and the one next step, for the Scoring page's round
 * bar. Rounds of several groups (progressive or pre-assigned qualifying):
 * every heat of the latest round sails once, then the next round is built.
 * One fleet, or the Final Series: every fleet sails the same race, the one
 * behind goes next.
 */
export function roundStatus<
  H extends Pick<HeatWithBoats, 'heat_name' | 'heat_type' | 'raceNumber'>,
>(
  heats: H[],
  {
    finalSeriesStarted,
    numQualifyingGroups,
  }: { finalSeriesStarted: boolean; numQualifyingGroups: number },
): RoundStatus<H> | null {
  const current = getLastHeats(heats);
  if (current.length === 0) return null;
  const phase = finalSeriesStarted ? 'final' : 'qualifying';

  if (!finalSeriesStarted && numQualifyingGroups >= 2) {
    const round = getHeatRoundFromName(current[0].heat_name) ?? 1;
    const scored = current.filter((heat) => heat.raceNumber > 0).length;
    const firstUnscored = current.find((heat) => heat.raceNumber === 0);
    return {
      phase,
      summary: `Round ${round} · ${scored} of ${current.length} heats scored`,
      next: firstUnscored
        ? { kind: 'score', heat: firstUnscored, race: 1 }
        : { kind: 'createRound', round: round + 1 },
      canUndoRedistribution: round > 1,
    };
  }

  const fewest = Math.min(...current.map((heat) => heat.raceNumber));
  const race = fewest + 1;
  const done = current.filter((heat) => heat.raceNumber >= race).length;
  const behind = current.find((heat) => heat.raceNumber === fewest) as H;
  const unit = finalSeriesStarted ? 'fleets' : 'heats';
  return {
    phase,
    summary:
      current.length === 1
        ? `Race ${race} next`
        : `Race ${race} · ${done} of ${current.length} ${unit} scored`,
    next: { kind: 'score', heat: behind, race },
    canUndoRedistribution: false,
  };
}
