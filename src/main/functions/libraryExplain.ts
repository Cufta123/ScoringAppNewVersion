/**
 * The two explanations ("how was this score calculated?" and the compare
 * panel's tie-break), worked out by regatta-core from the event's decision
 * log (phase 2 of docs/regatta-core-switch.md), in the shapes the renderer
 * reads (`BoatScoreExplanation`, `TieBreakExplanation`).
 *
 * Every number, rule and verdict comes from the library: the same standings
 * the leaderboard reads (functions/libraryStandings.ts) and the library's
 * own explanation of them, so an explanation cannot disagree with the order
 * on screen. What the race office entered in a race (its id, number, place,
 * status, the races an RDG2 averages) is the stored result the library
 * scored.
 */
import {
  explainScore,
  explainTie,
  finalStandings,
  overallStandings,
  qualifyingStandings,
  type EventState,
  type Reason,
  type RaceRef,
  type Score,
  type SeriesExplanation,
  type TieExplanation,
} from 'regatta-core';
import { db } from '../database/DBManager';
import { replayEvent } from './libraryStandings';
import { getHeatRoundFromName } from '../../shared/heatNames';
import { parseRedressRaceIds } from './raceSheet';
import type {
  BoatScoreExplanation,
  ExplainedRace,
  SeriesBlock,
  TieNote,
} from '../../shared/scoring/explain';
import type {
  TieBreakComparison,
  TieBreakExplanation,
  TieBreakRaceGridCell,
  TieBreakRacePair,
  TieBreakRoute,
  TieBreakStep,
} from '../../shared/scoring/tieBreakTypes';

type RaceIdOf = (ref: RaceRef) => number | undefined;

interface StoredRow {
  race_id: number;
  boat_id: number;
  race_number: number;
  status: string;
  position: number | null;
  rdg_race_ids: string | null;
  heat_name: string;
  heat_type: string;
}

/**
 * Every stored result of the event: by race id and boat, and (qualifying)
 * by round and race number, where the app files the DNC of a boat that had
 * no heat in a race (as `storedCells` in libraryStandings does).
 */
function storedResults(eventId: number) {
  const rows = db
    .prepare(
      `SELECT sc.race_id, sc.boat_id, r.race_number,
              COALESCE(sc.status, 'FINISHED') AS status, sc.position,
              sc.rdg_race_ids, h.heat_name, h.heat_type
       FROM Scores sc
       JOIN Races r ON r.race_id = sc.race_id
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE h.event_id = ?`,
    )
    .all(eventId) as StoredRow[];
  const byRace = new Map<string, StoredRow>();
  const byRound = new Map<string, StoredRow>();
  rows.forEach((row) => {
    byRace.set(`${row.race_id}|${row.boat_id}`, row);
    if (row.heat_type === 'Qualifying') {
      const round = getHeatRoundFromName(row.heat_name) || 1;
      byRound.set(`${round}#${row.race_number}|${row.boat_id}`, row);
    }
  });
  return (boat: string, score: Score, raceIdOf: RaceIdOf) => {
    const raceId = score.ref ? raceIdOf(score.ref) : undefined;
    return raceId !== undefined
      ? byRace.get(`${raceId}|${boat}`)
      : byRound.get(`${score.round}#${score.raceNumber}|${boat}`);
  };
}

/** "NAT SAIL" for every boat of the event. */
function sailNames(eventId: number) {
  const rows = db
    .prepare(
      `SELECT b.boat_id, b.country, b.sail_number
       FROM Boat_Event be JOIN Boats b ON b.boat_id = be.boat_id
       WHERE be.event_id = ?`,
    )
    .all(eventId) as {
    boat_id: number;
    country: string | null;
    sail_number: string | number | null;
  }[];
  const byId = new Map(
    rows.map((row) => [
      String(row.boat_id),
      `${row.country ?? ''} ${row.sail_number ?? ''}`.trim(),
    ]),
  );
  return (boat: string) => byId.get(boat) ?? '';
}

// --- "How was this score calculated?" ---------------------------------------

/**
 * The step that decided a tie: the last one, except the closing "no rule
 * separates them" line, where the comparison before it says why.
 */
function decidingStep(tie: TieExplanation): Reason {
  const { steps } = tie;
  const last = steps[steps.length - 1];
  if (last && last.rule === '' && steps.length > 1) {
    return steps[steps.length - 2];
  }
  return last ?? { rule: 'SHRS 5.7', text: '' };
}

function tieNote(tie: TieExplanation, sail: (boat: string) => string): TieNote {
  const other = tie.boats[1];
  const step = decidingStep(tie);
  return {
    boat_id: Number(other),
    sail: sail(other),
    winnerBoatId: tie.ahead,
    rule: step.rule,
    note: step.text,
  };
}

/** One series of the library's explanation, with the stored race columns. */
function seriesBlock(
  boat: string,
  explained: SeriesExplanation,
  scores: Score[],
  stored: ReturnType<typeof storedResults>,
  raceIdOf: RaceIdOf,
): SeriesBlock {
  const races = explained.races.map((race, i): ExplainedRace => {
    // The library explains her scores in the order of `scores`.
    const score = scores[i];
    const row = stored(boat, score, raceIdOf);
    const raceId = row?.race_id ?? (score.ref ? raceIdOf(score.ref) : null);
    if (raceId == null) {
      throw new Error(
        `The race of ${race.label} cannot be found in this event's results.`,
      );
    }
    return {
      race_id: raceId,
      race_number: row?.race_number ?? score.raceNumber,
      label: race.label,
      status: row?.status ?? race.code ?? 'FINISHED',
      position: Number(row?.position ?? race.place ?? 0),
      points: race.points,
      rdg_race_ids: parseRedressRaceIds(row?.rdg_race_ids),
      reason: race.reason,
      excluded: race.excluded,
      ...(race.note ? { exclusionNote: race.note } : {}),
    };
  });
  return {
    races,
    discards: explained.discards,
    gross: explained.gross,
    total: explained.total,
    largestHeat: explained.largestHeat,
    seriesRaceCount: explained.completedRaces,
    ties: [],
  };
}

/** One boat's score, race by race, with the rules behind each number. */
export function explainBoatScore(
  eventId: number,
  boatId: number,
): BoatScoreExplanation {
  const { state, raceIdOf } = replayEvent(eventId);
  const boat = String(boatId);
  const stored = storedResults(eventId);
  const sail = sailNames(eventId);
  const explained = explainScore(state, boat);

  const q = qualifyingStandings(state).standings.find((s) => s.boat === boat);
  const qualifying =
    explained.qualifying && q
      ? seriesBlock(boat, explained.qualifying, q.scores, stored, raceIdOf)
      : null;

  const fleet = finalStandings(state).find((f) =>
    f.standings.some((s) => s.boat === boat),
  );
  if (!fleet) {
    // Qualifying Series (or a boat in no final fleet): the boats on the same
    // qualifying total, and how SHRS 5.7 separated them.
    if (qualifying && explained.qualifying) {
      qualifying.ties = explained.qualifying.ties.map((tie) =>
        tieNote(tie, sail),
      );
    }
    return { qualifying, final: null, overall: null };
  }

  const own = fleet.standings.find((s) => s.boat === boat)!;
  const final: SeriesBlock & { fleet: string } = {
    ...(explained.final
      ? seriesBlock(boat, explained.final, own.scores, stored, raceIdOf)
      : {
          races: [],
          discards: {
            rule: 'SHRS 5.4',
            text: 'Her fleet has not raced yet.',
            count: 0,
          },
          gross: 0,
          total: 0,
          largestHeat: 0,
          seriesRaceCount: 0,
          ties: [],
        }),
    fleet: fleet.fleet,
  };

  // SHRS 5.5: boats are ranked fleet by fleet on the overall points, so her
  // ties are the boats of her fleet on the same overall points.
  const overall = overallStandings(state);
  const mine = overall.find((row) => row.boat === boat);
  if (mine) {
    final.ties = overall
      .filter(
        (row) =>
          row.boat !== boat &&
          row.fleet === mine.fleet &&
          row.total === mine.total,
      )
      .map((row) =>
        tieNote(explainTie(state, boat, row.boat, 'overall'), sail),
      );
  }

  return {
    qualifying,
    final,
    overall: mine
      ? {
          points: mine.total,
          rule: 'SHRS 5.5',
          text: `Overall score = qualifying series ${mine.qualifying} + final series ${mine.final} = ${mine.total}. Boats in ${fleet.fleet} are ranked among their own fleet; Gold is ranked before Silver, Silver before Bronze, and so on.`,
        }
      : null,
  };
}

// --- The compare panel's tie-break ------------------------------------------

/** A score of one boat with the leaderboard column it is shown in. */
interface Column {
  score: Score;
  /** "Q3", "F1": the leaderboard column. */
  label: string;
  /** 1-based column number in its series. */
  number: number;
  heatType: 'Qualifying' | 'Final';
}

const columns = (
  scores: Score[] | undefined,
  heatType: Column['heatType'],
): Column[] =>
  (scores ?? []).map((score, i) => ({
    score,
    label: `${heatType === 'Final' ? 'F' : 'Q'}${i + 1}`,
    number: i + 1,
    heatType,
  }));

/** Races both boats sailed in the same heat, in the order sailed. */
function sharedPairs(
  a: Column[],
  b: Column[],
  raceIdOf: RaceIdOf,
): TieBreakRacePair[] {
  const theirs = new Map(b.map((col) => [col.score.race, col]));
  return a
    .filter((col) => col.score.ref !== null && theirs.has(col.score.race))
    .sort((x, y) => x.score.order - y.score.order)
    .flatMap((col) => {
      const other = theirs.get(col.score.race)!;
      const raceId = raceIdOf(col.score.ref!);
      if (raceId === undefined) return [];
      return [
        {
          raceId,
          raceNumber: col.number,
          round: col.score.round,
          heatType: col.heatType,
          pointsA: col.score.points,
          pointsB: other.score.points,
          excludedA: col.score.excluded,
          excludedB: other.score.excluded,
          displayA: col.score.points,
          displayB: other.score.points,
        },
      ];
    });
}

const bestFirst = (points: number[]) => [...points].sort((x, y) => x - y);
const lastRaceFirst = (cols: Column[]) =>
  [...cols].sort((x, y) => y.score.order - x.score.order);
const keptBest = (cols: Column[]) =>
  bestFirst(cols.filter((c) => !c.score.excluded).map((c) => c.score.points));

function firstDifference(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? Infinity) !== (b[i] ?? Infinity)) return i;
  }
  return -1;
}

/**
 * The lists a library step compared, by its rule: the same lists the
 * library's tie-breaks build (standings/ties.ts), from the same scores.
 */
function comparedLists(
  rule: string,
  a: Column[],
  b: Column[],
): {
  mode: 'A8.1' | 'A8.2';
  a: number[];
  b: number[];
  races?: Column[][];
} | null {
  if (rule === 'RRS A8.1') {
    return { mode: 'A8.1', a: keptBest(a), b: keptBest(b) };
  }
  if (rule === 'RRS A8.2') {
    const left = lastRaceFirst(a);
    const right = lastRaceFirst(b);
    return {
      mode: 'A8.2',
      a: left.map((c) => c.score.points),
      b: right.map((c) => c.score.points),
      races: left.map((c, i) => [c, right[i]]),
    };
  }
  const theirs = new Map(b.map((col) => [col.score.race, col]));
  const shared = lastRaceFirst(a.filter((col) => theirs.has(col.score.race)));
  const left = shared.map((c) => c.score.points);
  const right = shared.map((c) => theirs.get(c.score.race)!.score.points);
  if (rule === 'SHRS 5.7(ii)(1)-(2), RRS A8.1') {
    return { mode: 'A8.1', a: bestFirst(left), b: bestFirst(right) };
  }
  if (rule === 'SHRS 5.7(ii)(1), RRS A8.2') {
    return {
      mode: 'A8.2',
      a: left,
      b: right,
      races: shared.map((c) => [c, theirs.get(c.score.race)!]),
    };
  }
  return null;
}

/** "SHRS 5.7(ii)(1), RRS A8.2" -> "RRS A8.2, SHRS 5.7(ii)(1)". */
const rrsFirst = (rule: string) => {
  const parts = rule.split(', ');
  return [
    ...parts.filter((p) => p.startsWith('RRS')),
    ...parts.filter((p) => !p.startsWith('RRS')),
  ].join(', ');
};

/** A library step as the compare panel shows it. */
function panelStep(
  step: Reason,
  a: Column[],
  b: Column[],
  raceIdOf: RaceIdOf,
): { step: TieBreakStep; breaker: { raceId?: number; index?: number } | null } {
  const lists = comparedLists(step.rule, a, b);
  if (!lists) {
    // A statement, not a comparison: "no rule separates them" decides
    // nothing; SHRS 5.7(ii)(3) and the A8 way out of a circle decide.
    return {
      step: {
        rule: rrsFirst(step.rule),
        note: step.text,
        resolved: step.rule !== '',
      },
      breaker: null,
    };
  }
  const resolved = step.text.includes(' decides: ');
  const colon = step.text.indexOf(': ');
  const out: TieBreakStep = {
    rule: rrsFirst(step.rule),
    note: step.text,
    ...(colon > 0 ? { subtitle: step.text.slice(0, colon) } : {}),
    resolved,
  };
  if (!resolved) return { step: out, breaker: null };
  const at = firstDifference(lists.a, lists.b);
  const scoreA = lists.a[at];
  const scoreB = lists.b[at];
  // Only what the library's own words confirm.
  if (
    at < 0 ||
    scoreA === undefined ||
    scoreB === undefined ||
    !step.text.includes(`decides: ${scoreA} against ${scoreB}`)
  ) {
    return { step: out, breaker: null };
  }
  if (lists.mode === 'A8.1') {
    out.comparison = { mode: 'A8.1', scoreA, scoreB, position: at + 1 };
    return { step: out, breaker: null };
  }
  const [left, right] = lists.races![at];
  const sameRace = left.score.race === right.score.race && left.score.ref;
  const raceId = sameRace ? raceIdOf(left.score.ref!) : undefined;
  const comparison: TieBreakComparison = { mode: 'A8.2', scoreA, scoreB };
  if (raceId !== undefined) comparison.raceId = raceId;
  out.comparison = comparison;
  if (raceId !== undefined) return { step: out, breaker: { raceId } };
  // Each boat's k-th last race: one column when both have as many.
  return {
    step: out,
    breaker: a.length === b.length ? { index: a.length - 1 - at } : null,
  };
}

const ROUTE_RULES = new Set([
  'SHRS 5.7(i)',
  'SHRS 5.7(ii)(4)',
  'SHRS 1.5',
  'SHRS 5.5',
]);

/** The route (which rules apply) and the remaining steps of a tie. */
function splitRoute(
  tie: TieExplanation,
  sharedCount: number,
): { route: TieBreakRoute | null; steps: Reason[] } {
  const [first, ...rest] = tie.steps;
  if (first && ROUTE_RULES.has(first.rule)) {
    return { route: { rule: first.rule, note: first.text }, steps: rest };
  }
  if (first && first.rule.startsWith('SHRS 5.7(ii)(1)')) {
    // The library goes straight to the races they sailed together.
    return {
      route: {
        rule: 'SHRS 5.7(ii)',
        note: `Several heats, and they sailed ${sharedCount} race${sharedCount === 1 ? '' : 's'} in the same heat: they are compared on those races, excluded scores included.`,
      },
      steps: tie.steps,
    };
  }
  return { route: null, steps: tie.steps };
}

function raceGrid(
  pairs: TieBreakRacePair[],
  a: Column[],
  b: Column[],
  breaker: { raceId?: number; index?: number } | null,
): TieBreakRaceGridCell[] {
  if (pairs.length > 0) {
    return pairs.map((pair) => ({
      key: String(pair.raceId),
      label: `${pair.heatType === 'Final' ? 'F' : 'Q'}${pair.raceNumber}`,
      scoreA: pair.pointsA,
      scoreB: pair.pointsB,
      excludedA: pair.excludedA,
      excludedB: pair.excludedB,
      shared: true,
      isBreaker: breaker?.raceId === pair.raceId,
    }));
  }
  return Array.from({ length: Math.max(a.length, b.length) }, (_u, i) => ({
    key: `ind-${i}`,
    label: a[i]?.label ?? b[i]?.label ?? `R${i + 1}`,
    scoreA: a[i] ? a[i].score.points : '–',
    scoreB: b[i] ? b[i].score.points : '–',
    excludedA: Boolean(a[i]?.score.excluded),
    excludedB: Boolean(b[i]?.score.excluded),
    shared: false,
    isBreaker: breaker?.index === i,
  }));
}

function seriesOf(state: EventState, boat: string) {
  const q = qualifyingStandings(state).standings.find((s) => s.boat === boat);
  const f = finalStandings(state)
    .flatMap((fleet) => fleet.standings)
    .find((s) => s.boat === boat);
  return {
    qualifying: q,
    qualifyingColumns: columns(q?.scores, 'Qualifying'),
    finalColumns: columns(f?.scores, 'Final'),
  };
}

/**
 * Why one of two boats is ahead of the other: the qualifying series, or
 * (`isFinalSeries`) the overall ranking of the Final Series screen.
 */
export function explainTieBreak(
  eventId: number,
  boatA: string,
  boatB: string,
  isFinalSeries: boolean,
): TieBreakExplanation {
  const { state, raceIdOf } = replayEvent(eventId);
  const a = seriesOf(state, boatA);
  const b = seriesOf(state, boatB);

  let totals: [number | undefined, number | undefined];
  let colsA: Column[];
  let colsB: Column[];
  let sharedRacePairs: TieBreakRacePair[];
  let sharedQualRacePairs: TieBreakRacePair[];
  const qualPairs = sharedPairs(
    a.qualifyingColumns,
    b.qualifyingColumns,
    raceIdOf,
  );
  if (isFinalSeries) {
    const overall = overallStandings(state);
    totals = [
      overall.find((row) => row.boat === boatA)?.total,
      overall.find((row) => row.boat === boatB)?.total,
    ];
    colsA = [...a.qualifyingColumns, ...a.finalColumns];
    colsB = [...b.qualifyingColumns, ...b.finalColumns];
    // The panel shows these as the F badges and highlights them in the
    // fleet's F columns; the qualifying ones go in sharedQualRacePairs.
    sharedRacePairs = sharedPairs(a.finalColumns, b.finalColumns, raceIdOf);
    sharedQualRacePairs = qualPairs;
  } else {
    totals = [a.qualifying?.total, b.qualifying?.total];
    colsA = a.qualifyingColumns;
    colsB = b.qualifyingColumns;
    sharedRacePairs = qualPairs;
    sharedQualRacePairs = [];
  }

  const [totalA, totalB] = totals;
  const result: TieBreakExplanation = {
    tied: false,
    totalA: totalA ?? 0,
    totalB: totalB ?? 0,
    winnerBoatId: null,
    route: null,
    steps: [],
    raceGrid: [],
    sharedRacePairs,
    sharedQualRacePairs,
  };
  // A boat not ranked in this series (no completed race yet, or in no
  // final fleet) is not compared.
  if (totalA === undefined || totalB === undefined) return result;

  const tie = explainTie(
    state,
    boatA,
    boatB,
    isFinalSeries ? 'overall' : 'qualifying',
  );
  result.winnerBoatId = tie.ahead;
  result.tied = totalA === totalB;
  if (!result.tied) return result;

  const allPairs = [...sharedQualRacePairs, ...sharedRacePairs];
  const split = splitRoute(tie, allPairs.length);
  let { route } = split;
  let { steps } = split;
  if (route?.rule === 'SHRS 1.5') {
    // No final race yet: the qualifying ranking stands, so the qualifying
    // tie-break is why one is ahead (the same order, from the same places).
    const qualifying = explainTie(state, boatA, boatB, 'qualifying');
    if (qualifying.ahead === tie.ahead) {
      const inner = splitRoute(qualifying, qualPairs.length);
      route = {
        rule: route.rule,
        note: inner.route ? `${route.note} ${inner.route.note}` : route.note,
      };
      steps = inner.steps;
    }
  }

  let breaker: { raceId?: number; index?: number } | null = null;
  result.route = route;
  result.steps = steps.map((reason) => {
    const mapped = panelStep(reason, colsA, colsB, raceIdOf);
    if (mapped.breaker) breaker = mapped.breaker;
    return mapped.step;
  });
  result.raceGrid = raceGrid(allPairs, colsA, colsB, breaker);
  return result;
}
