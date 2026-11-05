/**
 * The SHRS 5.7 / RRS A8 tie-breaks, each as a verdict: who is ahead, and
 * the steps that decided it, in words. The rankings use only `result`;
 * explanations show `steps`. One function does both, so an explanation is
 * the calculation itself and cannot disagree with the order on screen.
 */
import {
  bestFirst,
  compareLists,
  lastRaceFirst,
  type TieScore,
} from '../rules/ranking';

export interface Reason {
  /** e.g. "SHRS 5.7(ii)(4)", "RRS A8.1". */
  rule: string;
  text: string;
}

export interface Verdict {
  /** Negative: the first boat is ahead; 0: no rule separates them. */
  result: number;
  steps: Reason[];
}

/** What a tie-break needs of a boat. */
export interface TieEntry {
  scores: TieScore[];
  /** Her kept (not excluded) scores, best first. */
  keptBest: number[];
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

const list = (values: readonly number[]) =>
  values.length === 0 ? 'none' : values.join(', ');

/** "A2", "A2 race 2", "Gold race 3"; a race with no heat says so. */
export function raceLabel(key: string): string {
  const [ref, noHeat] = key.split('~');
  const [heat, race] = ref.split('#');
  const base =
    race === '1' && /^[A-Z]\d+$/.test(heat) ? heat : `${heat} race ${race}`;
  return noHeat ? `${base} (no heat)` : base;
}

function firstDifference(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? Infinity) !== (b[i] ?? Infinity)) return i;
  }
  return -1;
}

/** Two lists compared as A8.1 / A8.2 compare them, with the reason. */
function compareStep(
  rule: string,
  what: string,
  a: readonly number[],
  b: readonly number[],
  labels?: readonly string[],
): Verdict {
  const result = compareLists(a, b);
  const at = firstDifference(a, b);
  let text = `${what}: ${list(a)} against ${list(b)}`;
  if (result === 0) {
    text += ', the same.';
  } else {
    const where = labels?.[at] ? ` (${labels[at]})` : '';
    text += `. The ${ordinal(at + 1)}${where} decides: ${a[at] ?? 'none'} against ${b[at] ?? 'none'}.`;
  }
  return { result, steps: [{ rule, text }] };
}

const then = (first: Verdict, next: () => Verdict): Verdict => {
  if (first.result !== 0) return first;
  const second = next();
  return { result: second.result, steps: [...first.steps, ...second.steps] };
};

const after = (step: Reason, verdict: Verdict): Verdict => ({
  result: verdict.result,
  steps: [step, ...verdict.steps],
});

/** RRS A8.1 then A8.2, as written. */
export function plainA8Verdict(a: TieEntry, b: TieEntry): Verdict {
  return then(
    compareStep(
      'RRS A8.1',
      'Scores best first, excluded scores left out',
      a.keptBest,
      b.keptBest,
    ),
    () =>
      compareStep(
        'RRS A8.2',
        'Scores from the last race back, excluded scores included',
        lastRaceFirst(a.scores),
        lastRaceFirst(b.scores),
      ),
  );
}

/**
 * SHRS 5.7(ii)(1)-(2): only the races both boats sailed in the same heat,
 * excluded scores included; A8.1 on them, then A8.2. Null if they never
 * met.
 */
export function sharedRacesVerdict(a: TieEntry, b: TieEntry): Verdict | null {
  const theirs = new Map(b.scores.map((score) => [score.race, score]));
  const shared = a.scores
    .filter((score) => theirs.has(score.race))
    .sort((x, y) => y.order - x.order)
    .map((score) => ({
      label: raceLabel(score.race),
      a: score.points,
      b: theirs.get(score.race)!.points,
    }));
  if (shared.length === 0) return null;
  const left = shared.map((pair) => pair.a);
  const right = shared.map((pair) => pair.b);
  const races = shared
    .map((pair) => pair.label)
    .reverse()
    .join(', ');
  return then(
    compareStep(
      'SHRS 5.7(ii)(1)-(2), RRS A8.1',
      `In the races they sailed in the same heat (${races}), best first, excluded scores included`,
      bestFirst(left),
      bestFirst(right),
    ),
    () =>
      compareStep(
        'SHRS 5.7(ii)(1), RRS A8.2',
        'The same races, last race first',
        left,
        right,
        shared.map((pair) => pair.label),
      ),
  );
}

/** SHRS 5.7(i): a single-heat event. */
export function singleHeatVerdict(a: TieEntry, b: TieEntry): Verdict {
  return after(
    { rule: 'SHRS 5.7(i)', text: 'A single-heat event: RRS A8.1, then A8.2.' },
    plainA8Verdict(a, b),
  );
}

/** SHRS 5.7(ii): several heats. */
export function multiHeatVerdict(a: TieEntry, b: TieEntry): Verdict {
  return (
    sharedRacesVerdict(a, b) ??
    after(
      {
        rule: 'SHRS 5.7(ii)(4)',
        text: 'They never sailed in the same heat: RRS A8.1 and A8.2 without changes.',
      },
      plainA8Verdict(a, b),
    )
  );
}

/**
 * One Final Series fleet: every boat sailed every race of it, so all its
 * races are shared. A8.1 with excluded scores too (5.7(ii)(2)), then A8.2.
 */
export function fleetVerdict(
  a: { scores: TieScore[] },
  b: { scores: TieScore[] },
): Verdict {
  return then(
    compareStep(
      'SHRS 5.7(ii)(2), RRS A8.1',
      'Scores in this fleet best first, excluded scores included',
      bestFirst(a.scores.map((score) => score.points)),
      bestFirst(b.scores.map((score) => score.points)),
    ),
    () =>
      compareStep(
        'RRS A8.2',
        'Scores from the last race back',
        lastRaceFirst(a.scores),
        lastRaceFirst(b.scores),
      ),
  );
}
