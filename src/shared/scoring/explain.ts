/**
 * "How was this score calculated?" — a boat's series score, race by race,
 * with the rule behind every number. Pure, and built on the same functions
 * the ranking uses (discard choice, status points, redress average), so the
 * explanation is the calculation, not a description written next to it.
 *
 * Rules cited are SHRS 2026-1 and the RRS 2025–2028 it amends.
 */
import { DiscardConfig, getExcludeCountForConfig } from '../discardProfile';
import { roundPoints, sumPoints } from '../points';
import {
  AVERAGE_REDRESS_STATUSES,
  averageRedressPoints,
  roundToTenthHalfUp,
} from '../redress';
import { scoringPenaltyStatuses } from '../scoringPenalty';
import {
  capExcludeCountForBoat,
  getExcludedIndexes,
  nonExcludableStatuses,
} from './discards';
import { deriveNonFinisherPoints, isNonScoringPenalty } from './statusPoints';

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

const STATUS_NAMES: Record<string, string> = {
  DNC: 'did not come to the starting area',
  DNS: 'did not start',
  OCS: 'on the course side at the start',
  UFD: 'disqualified under the U flag rule',
  BFD: 'disqualified under the black flag rule',
  NSC: 'did not sail the course',
  DNF: 'did not finish',
  RET: 'retired',
  DSQ: 'disqualified',
  DNE: 'disqualified, not excludable',
  DGM: 'disqualified for gross misconduct',
  WTH: 'withdrawn from the series',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmt = (n: number) => String(roundPoints(n));

const redressBasis = (race: ExplainRaceInput, series: ExplainRaceInput[]) => {
  let pool = series.filter((other) => other.race_id !== race.race_id);
  if (race.status === 'RDG2') {
    const chosen = new Set(race.rdg_race_ids ?? []);
    pool = pool.filter((other) => chosen.has(other.race_id));
  }
  return pool.filter(
    (other) => !AVERAGE_REDRESS_STATUSES.has(other.status.toUpperCase()),
  );
};

/** Why a race scored the points it did. */
export function explainRacePoints(
  race: ExplainRaceInput,
  series: ExplainRaceInput[],
  largestHeat: number,
): Reason {
  const { status, position, points } = race;
  const dnfScore = largestHeat + 1;
  const recorded =
    deriveNonFinisherPoints(status, position, largestHeat) ?? points;
  const mismatch =
    recorded !== points ? ` (recorded as ${fmt(points)} points)` : '';

  if (status === 'FINISHED') {
    if (points === position) {
      return {
        rule: 'RRS A4',
        text: `Finished ${position}: ${plural(points, 'point')}.`,
      };
    }
    return {
      rule: 'RRS A7',
      text: `Tied for ${position} at the finish: the points for the tied places are shared, ${fmt(points)} each.`,
    };
  }

  if (scoringPenaltyStatuses.has(status)) {
    const rate = status === 'T1' ? 30 : 20;
    const rule = {
      ZFP: 'RRS 30.2, 44.3(c)',
      SCP: 'RRS 44.3(c)',
      T1: 'RRS T1(b), 44.3(c)',
    }[status] as string;
    const name = {
      ZFP: 'a Z flag penalty',
      SCP: 'a scoring penalty',
      T1: 'a post-race penalty',
    }[status];
    const penalty = roundToTenthHalfUp((dnfScore * rate) / 100);
    const capped = position + penalty > dnfScore;
    return {
      rule,
      text: capped
        ? `Finished ${position} with ${name} of ${rate}% of the DNF score (${dnfScore}); the score cannot be worse than DNF, so ${dnfScore}${mismatch}.`
        : `Finished ${position} plus ${name}: ${rate}% of the DNF score (${dnfScore}) is ${fmt(penalty)}, so ${position} + ${fmt(penalty)} = ${fmt(position + penalty)}${mismatch}.`,
    };
  }

  if (isNonScoringPenalty(status)) {
    const name = STATUS_NAMES[status] ? ` (${STATUS_NAMES[status]})` : '';
    return {
      rule: 'SHRS 5.2',
      text: `${status}${name}: one more than the ${plural(largestHeat, 'boat')} in the largest heat = ${dnfScore}${mismatch}.`,
    };
  }

  if (status === 'RDG1' || status === 'RDG2') {
    const basis = redressBasis(race, series);
    const average = averageRedressPoints(
      basis.map((other) => ({ points: other.points, status: other.status })),
    );
    const which =
      status === 'RDG1'
        ? 'all her other races in this series'
        : 'the races the protest committee chose';
    const listed = basis
      .map((other) => `${other.label} ${fmt(other.points)}`)
      .join(', ');
    const rule = status === 'RDG1' ? 'RRS A9(a), SHRS 5.6' : 'RRS A9, SHRS 5.6';
    const otherRedress = series.some(
      (other) =>
        other.race_id !== race.race_id &&
        AVERAGE_REDRESS_STATUSES.has(other.status.toUpperCase()),
    )
      ? ' Her other average-redress races are left out, so the two averages do not depend on each other.'
      : '';
    if (average === null) {
      return {
        rule,
        text: `Redress: the average of ${which}. There is nothing to average yet, so it stays ${fmt(points)}.`,
      };
    }
    return {
      rule,
      text: `Redress: the average of ${which} (${listed}), to the nearest tenth = ${fmt(average)}${average !== points ? ` (recorded as ${fmt(points)})` : ''}.${otherRedress}`,
    };
  }

  if (status === 'RDG3') {
    return {
      rule: 'RRS A9',
      text: `Redress: ${fmt(points)} points set by the protest committee.`,
    };
  }

  if (status === 'DPI') {
    return {
      rule: 'RRS A10',
      text: `Discretionary penalty: ${fmt(points)} points set by the protest committee.`,
    };
  }

  return { rule: '', text: `${status}: ${fmt(points)} points.` };
}

const STANDARD_STEPS = [4, 8, 8] as const;

function describeDiscardRule(config: DiscardConfig): string {
  if (config.neverDiscard) {
    return 'The race committee set this event to never exclude a score.';
  }
  if (config.thresholds && config.thresholds.length > 0) {
    return `The race committee changed the rule for this event: one more score is excluded at each of ${config.thresholds.join(', ')} races.`;
  }
  const { firstDiscardAt, secondDiscardAt, additionalEvery } = config;
  const rule = `after ${firstDiscardAt} races 1 score is excluded, after ${secondDiscardAt} races 2, then 1 more every ${additionalEvery} races`;
  return [firstDiscardAt, secondDiscardAt, additionalEvery].join() ===
    STANDARD_STEPS.join()
    ? `Standard rule: ${rule}.`
    : `The race committee changed the rule for this event: ${rule}.`;
}

/**
 * A boat's series score explained. `seriesRaceCount` is the number of races
 * completed in the series (or the fleet, in the Final Series), as SHRS 5.4
 * counts them — the same number the ranking uses.
 */
export function explainBoatSeries({
  races,
  seriesRaceCount,
  discardConfig,
  largestHeat,
}: {
  races: ExplainRaceInput[];
  seriesRaceCount: number;
  discardConfig: DiscardConfig;
  largestHeat: number;
}): SeriesExplanation {
  const seriesExcludeCount = getExcludeCountForConfig(
    seriesRaceCount,
    discardConfig,
  );
  const count = capExcludeCountForBoat(seriesExcludeCount, races.length);
  const excluded = getExcludedIndexes(races, count);
  const keptPoints = races
    .filter((_race, i) => !excluded.has(i))
    .map((race) => race.points);
  const worstExcluded = Math.min(
    ...races.filter((_r, i) => excluded.has(i)).map((r) => r.points),
  );

  const explained = races.map((race, i): ExplainedRace => {
    const isExcluded = excluded.has(i);
    let exclusionNote: Reason | undefined;
    if (nonExcludableStatuses.has(race.status.toUpperCase()) && count > 0) {
      exclusionNote = {
        rule: race.status === 'DNE' ? 'RRS A10' : '',
        text: `${race.status} can never be excluded.`,
      };
    } else if (!isExcluded && count > 0 && race.points === worstExcluded) {
      exclusionNote = {
        rule: 'RRS A2.1',
        text: 'Equal to an excluded score: the score from the race sailed earliest is the one excluded.',
      };
    }
    return {
      ...race,
      reason: explainRacePoints(race, races, largestHeat),
      excluded: isExcluded,
      ...(exclusionNote ? { exclusionNote } : {}),
    };
  });

  let text: string;
  if (seriesExcludeCount === 0) {
    text = `${plural(seriesRaceCount, 'race')} completed in this series, so no score is excluded yet. ${describeDiscardRule(discardConfig)}`;
  } else {
    text = `${plural(seriesRaceCount, 'race')} completed in this series, so ${plural(seriesExcludeCount, 'worst score')} ${seriesExcludeCount === 1 ? 'is' : 'are'} excluded. ${describeDiscardRule(discardConfig)}`;
    if (count < seriesExcludeCount) {
      text += ` She has only ${plural(races.length, 'score')}, so she keeps at least one and ${count === 1 ? '1 is' : `${count} are`} excluded.`;
    }
  }

  return {
    races: explained,
    discards: { rule: 'SHRS 5.4', text, count },
    gross: sumPoints(races.map((race) => race.points)),
    total: sumPoints(keptPoints),
  };
}

// --- The full answer for one boat, as the main process returns it ---------

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
