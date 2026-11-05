/**
 * "How was this calculated?": a boat's score race by race with the rule
 * behind every number, and why one of two boats on equal points is ahead.
 *
 * Built from the standings themselves (the same scores, discards and
 * tie-break verdicts), so the explanation is the calculation, not a
 * description written beside it. Rules cited are SHRS 2026-1 and the RRS
 * 2025-2028 it changes.
 */
import {
  PENALTY_CODES,
  type BoatId,
  type DiscardProfile,
  type HeatId,
  type ProtestOutcome,
  type RaceRef,
} from './types';
import { discardCount, NOT_EXCLUDABLE } from './rules/discards';
import { exact, noPlacePoints, sum, toTenth } from './rules/points';
import { bestFirst } from './rules/ranking';
import { findRace, largestHeat, raceKey, type EventState } from './event/state';
import {
  qualifyingStandings,
  qualifyingVerdict,
  singleHeatEvent,
} from './standings/qualifying';
import {
  finalStandings,
  overallEntries,
  overallStandings,
} from './standings/final';
import { kept, type Score, type Standing } from './standings/series';
import {
  fleetVerdict,
  multiHeatVerdict,
  type Reason,
  type Verdict,
} from './standings/ties';

export type { Reason } from './standings/ties';

export interface ExplainedRace {
  /** Column label: Q1, Q2, … in the Qualifying Series, F1, … in a fleet. */
  label: string;
  /** Where she sailed it; null for a race she had no heat in. */
  heat: HeatId | null;
  race: number | null;
  place?: number;
  code?: string;
  points: number;
  excluded: boolean;
  /** Why these points. */
  reason: Reason;
  /** Why this score is, or is not, excluded, when that is not obvious. */
  note?: Reason;
}

export interface TieExplanation {
  boats: [BoatId, BoatId];
  series: 'qualifying' | 'final' | 'overall';
  /** The boat ahead; null when no rule separates them (they share a place). */
  ahead: BoatId | null;
  steps: Reason[];
}

export interface SeriesExplanation {
  place: number;
  total: number;
  /** Before exclusions. */
  gross: number;
  largestHeat: number;
  completedRaces: number;
  discards: Reason & { count: number };
  races: ExplainedRace[];
  /** Every boat on the same total, and why the order between them. */
  ties: TieExplanation[];
}

export interface BoatExplanation {
  boat: BoatId;
  qualifying: SeriesExplanation | null;
  final: (SeriesExplanation & { fleet: string }) | null;
  overall: { place: number; total: number; reason: Reason } | null;
}

const NAMES: Record<string, string> = {
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
const AVERAGED = new Set(['RDG1', 'RDG2']);
const isPenalty = (code?: string) =>
  (PENALTY_CODES as readonly string[]).includes(code ?? '');

/** The protest committee's decision behind a score, if any. */
function decisionFor(
  state: EventState,
  boat: BoatId,
  score: Score,
): ProtestOutcome | undefined {
  if (score.ref) return findRace(state, score.ref)?.protests[boat];
  // A race she had no heat in: filed under one of the round's races.
  return state.rounds[score.round - 1]
    ?.map((heat) => heat.races[score.raceNumber - 1]?.protests[boat])
    .find((outcome) => outcome !== undefined);
}

function racePoints(
  state: EventState,
  boat: BoatId,
  score: Score,
  scores: Score[],
  labels: Map<Score, string>,
  largest: number,
): Reason {
  const dnf = noPlacePoints(largest);
  const { code, place, points } = score;

  if (code === undefined) {
    return points === place
      ? { rule: 'RRS A4', text: `Finished ${place}: ${points} points.` }
      : {
          rule: 'RRS A7',
          text: `Tied for ${place} at the finish: the points of the places the tied boats fill are shared, ${points} each.`,
        };
  }

  if (isPenalty(code)) {
    const rate = code === 'T1' ? 30 : 20;
    const penalty = toTenth((dnf * rate) / 100);
    const rule = {
      ZFP: 'RRS 30.2, 44.3(c)',
      SCP: 'RRS 44.3(c)',
      T1: 'RRS T1(b), 44.3(c)',
    }[code]!;
    const name = {
      ZFP: 'a Z flag penalty',
      SCP: 'a scoring penalty',
      T1: 'a post-race penalty',
    }[code]!;
    if (points === dnf) {
      return {
        rule,
        text: `Finished ${place} with ${name}: ${rate}% of the DNF score (${dnf}) is ${penalty}; a penalty cannot make her score worse than DNF, so ${dnf}.`,
      };
    }
    const base = exact(points - penalty);
    const tie = base !== place ? ` (tied, sharing ${base})` : '';
    return {
      rule,
      text: `Finished ${place}${tie} with ${name}: ${rate}% of the DNF score (${dnf}) is ${penalty}, so ${base} + ${penalty} = ${points}.`,
    };
  }

  if (code === 'RDG3') {
    return {
      rule: 'RRS A9',
      text: `Redress: ${points} points set by the protest committee.`,
    };
  }
  if (code === 'DPI') {
    return {
      rule: 'RRS A10',
      text: `Discretionary penalty: ${points} points set by the protest committee.`,
    };
  }

  if (AVERAGED.has(code)) {
    const outcome = decisionFor(state, boat, score);
    const chosen =
      outcome?.kind === 'RDG2'
        ? new Set(outcome.races.map((ref: RaceRef) => raceKey(ref)))
        : null;
    const basis = scores.filter(
      (other) =>
        other !== score &&
        !AVERAGED.has(other.code ?? '') &&
        (chosen === null ||
          (other.ref !== null && chosen.has(raceKey(other.ref)))),
    );
    const which =
      code === 'RDG1'
        ? 'all her other races in this series'
        : 'the races the protest committee chose';
    const rule = code === 'RDG1' ? 'RRS A9(a), SHRS 5.6' : 'RRS A9, SHRS 5.6';
    if (basis.length === 0) {
      return {
        rule,
        text: `Redress: the average of ${which}. There is nothing to average yet, so she scores as a boat with no place, ${points}, until there is.`,
      };
    }
    const listed = basis
      .map((other) => `${labels.get(other)} ${other.points}`)
      .join(', ');
    return {
      rule,
      text: `Redress: the average of ${which} (${listed}), other average-redress races left out, to the nearest tenth = ${points}.`,
    };
  }

  const name = NAMES[code] ? ` (${NAMES[code]})` : '';
  if (score.ref === null) {
    return {
      rule: 'RRS A5.1, SHRS 5.2',
      text: `She had no heat in this race, so DNC: one more than the ${plural(largest, 'boat')} in the largest heat = ${points}.`,
    };
  }
  const byCommittee = ['DSQ', 'DNE', 'DGM'].includes(code)
    ? decisionFor(state, boat, score)?.kind === code
    : false;
  return {
    rule: byCommittee ? 'RRS A6.1, SHRS 5.2' : 'SHRS 5.2',
    text: `${code}${name}${byCommittee ? ', by the protest committee; the boats behind her moved up' : ''}: one more than the ${plural(largest, 'boat')} in the largest heat = ${points}.`,
  };
}

function describeDiscards(profile: DiscardProfile): string {
  switch (profile.kind) {
    case 'none':
      return 'The race committee set this series to exclude no score.';
    case 'thresholds':
      return `The race committee changed the rule: one more score is excluded at each of ${profile.at.join(', ')} races.`;
    case 'custom':
      return `The race committee changed the rule: after ${profile.first} races 1 score is excluded, after ${profile.second} races 2, then 1 more every ${profile.every} races.`;
    default:
      return 'Standard rule: after 4 races 1 score is excluded, after 8 races 2, then 1 more every 8 races.';
  }
}

function explainSeries(
  state: EventState,
  standing: Standing,
  completedRaces: number,
  profile: DiscardProfile,
  largest: number,
  prefix: string,
  ties: TieExplanation[],
): SeriesExplanation {
  const { scores } = standing;
  const labels = new Map(
    scores.map((score, i) => [score, `${prefix}${i + 1}`]),
  );
  const seriesCount = discardCount(completedRaces, profile);
  const count = scores.filter((score) => score.excluded).length;
  const worstExcluded = Math.min(
    ...scores.filter((score) => score.excluded).map((score) => score.points),
  );

  let text =
    seriesCount === 0
      ? `${plural(completedRaces, 'race')} completed in this series, so no score is excluded yet.`
      : `${plural(completedRaces, 'race')} completed in this series, so ${plural(seriesCount, 'worst score')} ${seriesCount === 1 ? 'is' : 'are'} excluded.`;
  text += ` ${describeDiscards(profile)}`;
  if (count < seriesCount) {
    text += ` She keeps at least one score, and DNE / DGM are never excluded, so ${plural(count, 'score')} ${count === 1 ? 'is' : 'are'} excluded.`;
  }

  return {
    place: standing.place,
    total: standing.total,
    gross: sum(scores.map((score) => score.points)),
    largestHeat: largest,
    completedRaces,
    discards: { rule: 'SHRS 5.4', text, count },
    races: scores.map((score) => {
      let note: Reason | undefined;
      if (NOT_EXCLUDABLE.has(score.code ?? '') && seriesCount > 0) {
        note = {
          rule: 'RRS 90.3(b)',
          text: `${score.code} can never be excluded.`,
        };
      } else if (
        !score.excluded &&
        count > 0 &&
        score.points === worstExcluded
      ) {
        note = {
          rule: 'RRS A2.1',
          text: 'Equal to an excluded score: the one from the race sailed earliest is excluded.',
        };
      }
      return {
        label: labels.get(score)!,
        heat: score.ref?.heat ?? null,
        race: score.ref?.race ?? null,
        ...(score.place !== undefined ? { place: score.place } : {}),
        ...(score.code !== undefined ? { code: score.code } : {}),
        points: score.points,
        excluded: score.excluded,
        reason: racePoints(
          state,
          standing.boat,
          score,
          scores,
          labels,
          largest,
        ),
        ...(note ? { note } : {}),
      };
    }),
    ties,
  };
}

/** Negative: `a` ahead; positive: `b`; 0: neither. */
const aheadOf = (result: number, a: BoatId, b: BoatId): BoatId | null => {
  if (result < 0) return a;
  if (result > 0) return b;
  return null;
};

function tieExplanation(
  a: BoatId,
  b: BoatId,
  series: TieExplanation['series'],
  totals: [number, number],
  places: [number, number],
  verdict: () => Verdict,
  circular: boolean,
): TieExplanation {
  if (totals[0] !== totals[1]) {
    return {
      boats: [a, b],
      series,
      ahead: totals[0] < totals[1] ? a : b,
      steps: [
        {
          rule: series === 'overall' ? 'SHRS 5.5' : 'RRS A2.1',
          text: `Not tied: ${totals[0]} against ${totals[1]} points; the lower total is ahead.`,
        },
      ],
    };
  }
  const { result, steps } = verdict();
  // `ahead` is always the order shown; the steps say why.
  const shown = aheadOf(places[0] - places[1], a, b);
  const all = [...steps];
  if (result === 0 && shown === null) {
    all.push({
      rule: '',
      text: 'No rule separates them, so they share the place.',
    });
  } else if (result === 0) {
    all.push({
      rule: 'SHRS 5.7(ii)(3)',
      text: `No rule separates these two directly, but other boats are tied with them on these points and those comparisons place ${shown === a ? 'the first' : 'the second'} higher: the higher place is settled first, and a boat shares a place only with boats no rule separates her from.`,
    });
  }
  if (circular) {
    all.push({
      rule: 'SHRS 5.7(ii), RRS A8',
      text: 'Among the boats tied on these points the tie-break goes round in a circle (each pair is compared on its own races), which the rules do not settle; the places in it were given by RRS A8 without changes.',
    });
  }
  return { boats: [a, b], series, ahead: shown, steps: all };
}

const keptEntry = (standing: Standing) => ({
  scores: standing.scores,
  keptBest: bestFirst(kept(standing.scores)),
});

/** Why one of two boats is ahead of the other in a series. */
export function explainTie(
  state: EventState,
  a: BoatId,
  b: BoatId,
  series: TieExplanation['series'] = 'qualifying',
): TieExplanation {
  if (series === 'qualifying') {
    const { standings } = qualifyingStandings(state);
    const x = standings.find((s) => s.boat === a);
    const y = standings.find((s) => s.boat === b);
    if (!x || !y) throw new Error('Both boats need qualifying scores.');
    const verdict = qualifyingVerdict(singleHeatEvent(state));
    return tieExplanation(
      a,
      b,
      series,
      [x.total, y.total],
      [x.place, y.place],
      () => verdict(keptEntry(x), keptEntry(y)),
      Boolean(x.circular && y.circular),
    );
  }
  if (series === 'final') {
    const fleet = finalStandings(state).find(
      (f) =>
        f.standings.some((s) => s.boat === a) &&
        f.standings.some((s) => s.boat === b),
    );
    if (!fleet) throw new Error('The two boats are not in the same fleet.');
    const x = fleet.standings.find((s) => s.boat === a)!;
    const y = fleet.standings.find((s) => s.boat === b)!;
    if (fleet.races === 0) {
      return {
        boats: [a, b],
        series,
        ahead: aheadOf(x.place - y.place, a, b),
        steps: [
          {
            rule: 'SHRS 1.5',
            text: 'The fleet has sailed no race yet, so its boats are in their qualifying order.',
          },
        ],
      };
    }
    return tieExplanation(
      a,
      b,
      series,
      [x.total, y.total],
      [x.place, y.place],
      () => fleetVerdict(x, y),
      false,
    );
  }
  const overall = overallStandings(state);
  const x = overall.find((s) => s.boat === a);
  const y = overall.find((s) => s.boat === b);
  if (!x || !y) throw new Error('Both boats need overall standings.');
  if (x.fleet !== y.fleet || !state.fleets?.some((f) => f.races.length > 0)) {
    return {
      boats: [a, b],
      series,
      ahead: aheadOf(x.place - y.place, a, b),
      steps: [
        x.fleet !== y.fleet
          ? {
              rule: 'SHRS 5.5',
              text: `${x.place < y.place ? x.fleet : y.fleet} is ranked before ${x.place < y.place ? y.fleet : x.fleet} whatever the points: Gold before Silver, Silver before Bronze, and so on.`,
            }
          : {
              rule: 'SHRS 1.5',
              text: 'No Final Series race is completed, so the qualifying ranking stands.',
            },
      ],
    };
  }
  const entries = new Map(
    overallEntries(state, qualifyingStandings(state).standings).flatMap((f) =>
      f.entries.map((entry) => [entry.boat, entry]),
    ),
  );
  return tieExplanation(
    a,
    b,
    series,
    [x.total, y.total],
    [x.place, y.place],
    () => multiHeatVerdict(entries.get(a)!, entries.get(b)!),
    Boolean(x.circular && y.circular),
  );
}

/** A boat's scores explained, series by series. */
export function explainScore(state: EventState, boat: BoatId): BoatExplanation {
  const qualifying = qualifyingStandings(state);
  const q = qualifying.standings.find((s) => s.boat === boat);
  const qualifyingTies = (own: Standing) =>
    qualifying.standings
      .filter((other) => other.boat !== boat && other.total === own.total)
      .map((other) => explainTie(state, boat, other.boat, 'qualifying'));

  const fleets = finalStandings(state);
  const fleet = fleets.find((f) => f.standings.some((s) => s.boat === boat));
  const f = fleet?.standings.find((s) => s.boat === boat);

  const overall = state.fleets?.some((fl) => fl.races.length > 0)
    ? overallStandings(state).find((s) => s.boat === boat)
    : undefined;

  return {
    boat,
    qualifying: q
      ? explainSeries(
          state,
          q,
          qualifying.completedRaces,
          state.settings.discards.qualifying,
          largestHeat(state.rounds.flat()),
          'Q',
          qualifyingTies(q),
        )
      : null,
    final:
      fleet && f && fleet.races > 0
        ? {
            fleet: fleet.fleet,
            ...explainSeries(
              state,
              f,
              fleet.races,
              state.settings.discards.final,
              largestHeat(state.fleets ?? []),
              'F',
              fleet.standings
                .filter((o) => o.boat !== boat && o.total === f.total)
                .map((o) => explainTie(state, boat, o.boat, 'final')),
            ),
          }
        : null,
    overall: overall
      ? {
          place: overall.place,
          total: overall.total,
          reason: {
            rule: 'SHRS 5.5',
            text: `Qualifying ${overall.qualifying} + ${overall.fleet} fleet ${overall.final} = ${overall.total}. Boats are ranked fleet by fleet, Gold first, then by these totals.`,
          },
        }
      : null,
  };
}
