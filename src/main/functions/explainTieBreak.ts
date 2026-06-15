/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import {
  getEventDiscardConfig,
  getExcludeCountForConfig,
  DiscardConfig,
} from './discardConfig';
import { getExcludedIndexes } from './scoringUtils';
import {
  compareQualifyingTieCandidates,
  detectSingleHeatEvent,
} from './calculateBoatScores';
import {
  buildOverallTiePacket,
  compareOverallTiePackets,
} from './overallTieBreak';

// Authoritative tie-break explanation for the leaderboard compare panel.
//
// The *winner* is always taken from the same comparator the ranking uses
// (compareQualifyingTieCandidates for the qualifying series,
// compareOverallTiePackets for the combined overall/final series), so the
// panel can never disagree with the actual placement. The steps, route and
// race grid are narration built from the same underlying scores.

type RaceRow = {
  race_id: number;
  race_number: number;
  points: number;
  status: string;
  heat_type: string;
};

type DisplayRace = RaceRow & { excluded: boolean };

type Comparison = {
  mode: 'A8.1' | 'A8.2';
  scoreA: number;
  scoreB: number;
  position?: number;
  raceId?: number;
};

type Step = {
  rule: string;
  note: string;
  subtitle?: string;
  resolved: boolean;
  comparison?: Comparison;
};

type RaceGridCell = {
  key: string;
  label: string;
  scoreA: number | string;
  scoreB: number | string;
  excludedA: boolean;
  excludedB: boolean;
  shared: boolean;
  isBreaker: boolean;
};

type RacePair = {
  raceId: number;
  raceNumber: number;
  pointsA: number;
  pointsB: number;
  excludedA: boolean;
  excludedB: boolean;
  displayA: number;
  displayB: number;
};

export type TieBreakExplanation = {
  tied: boolean;
  totalA: number;
  totalB: number;
  winnerBoatId: string | null;
  route: { rule: string; note: string } | null;
  steps: Step[];
  raceGrid: RaceGridCell[];
  sharedRacePairs: RacePair[];
  sharedQualRacePairs: RacePair[];
};

function getSeriesRaceDisplay(
  event_id: any,
  boat_id: any,
  heat_type: 'Qualifying' | 'Final',
  discardConfig: DiscardConfig,
): DisplayRace[] {
  const rows = db
    .prepare(
      `SELECT s.race_id, r.race_number, s.points,
              COALESCE(s.status, 'FINISHED') as status, h.heat_type
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = ?
       ORDER BY r.race_number ASC, s.race_id ASC`,
    )
    .all(event_id, boat_id, heat_type) as RaceRow[];

  const excludeCount = getExcludeCountForConfig(rows.length, discardConfig);
  const excludedIdx = getExcludedIndexes(rows, excludeCount);
  return rows.map((row, idx) => ({ ...row, excluded: excludedIdx.has(idx) }));
}

// All boats with a qualifying score in the event. Needed so single-vs-multi
// heat is decided at the EVENT level (SHRS 5.7), not from the tied pair alone.
function getAllQualifyingBoatIds(event_id: any): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT s.boat_id
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ? AND h.heat_type = 'Qualifying'`,
    )
    .all(event_id) as { boat_id: any }[];
  return rows.map((row) => String(row.boat_id));
}

const sumKept = (races: DisplayRace[]) =>
  races.reduce((acc, race) => (race.excluded ? acc : acc + race.points), 0);

// First position (best-to-worst, ascending) where two sorted score arrays
// differ — mirrors RRS A8.1.
function firstAscDiff(sortedA: number[], sortedB: number[]) {
  const maxLen = Math.max(sortedA.length, sortedB.length);
  for (let i = 0; i < maxLen; i += 1) {
    const a = sortedA[i] ?? Number.MAX_SAFE_INTEGER;
    const b = sortedB[i] ?? Number.MAX_SAFE_INTEGER;
    if (a !== b) {
      return { position: i + 1, scoreA: a, scoreB: b };
    }
  }
  return null;
}

// First race (paired, last-race-backward) where two boats differ — RRS A8.2.
function firstPairDiff(
  pairsDesc: { raceId: number; pointsA: number; pointsB: number }[],
) {
  for (let i = 0; i < pairsDesc.length; i += 1) {
    const { raceId, pointsA, pointsB } = pairsDesc[i];
    if (pointsA !== pointsB) {
      return { raceId, scoreA: pointsA, scoreB: pointsB };
    }
  }
  return null;
}

function buildSharedPairs(
  aRaces: DisplayRace[],
  bRaces: DisplayRace[],
): RacePair[] {
  const bByRace = new Map(bRaces.map((race) => [race.race_id, race]));
  return aRaces
    .filter((race) => bByRace.has(race.race_id))
    .map((race) => {
      const other = bByRace.get(race.race_id) as DisplayRace;
      return {
        raceId: race.race_id,
        raceNumber: race.race_number,
        pointsA: race.points,
        pointsB: other.points,
        excludedA: race.excluded,
        excludedB: other.excluded,
        displayA: race.points,
        displayB: other.points,
      };
    })
    .sort((left, right) => left.raceNumber - right.raceNumber);
}

function buildSharedRaceGrid(
  sharedPairs: RacePair[],
  breakerRaceId: number | null,
): RaceGridCell[] {
  return sharedPairs.map((pair, idx) => ({
    key: String(pair.raceId),
    label: `R${idx + 1}`,
    scoreA: pair.pointsA,
    scoreB: pair.pointsB,
    excludedA: pair.excludedA,
    excludedB: pair.excludedB,
    shared: true,
    isBreaker: breakerRaceId != null && pair.raceId === breakerRaceId,
  }));
}

function buildIndividualRaceGrid(
  aRaces: DisplayRace[],
  bRaces: DisplayRace[],
): RaceGridCell[] {
  const maxLen = Math.max(aRaces.length, bRaces.length);
  return Array.from({ length: maxLen }, (_unused, idx) => {
    const a = aRaces[idx];
    const b = bRaces[idx];
    return {
      key: `ind-${idx}`,
      label: `R${idx + 1}`,
      scoreA: a ? a.points : '–',
      scoreB: b ? b.points : '–',
      excludedA: Boolean(a?.excluded),
      excludedB: Boolean(b?.excluded),
      shared: false,
      isBreaker: false,
    };
  });
}

// Build the A8.1 (best-to-worst) then A8.2 (last-race-backward) narration for
// a pair of boats given the score arrays each rule operates on.
function buildA8Steps(options: {
  a81A: number[];
  a81B: number[];
  a81IncludesExcluded: boolean;
  a82PairsDesc: { raceId: number; pointsA: number; pointsB: number }[];
  a81Subtitle: string;
  a82Subtitle: string;
  a81RuleLabel: string;
}): { steps: Step[]; breakerRaceId: number | null } {
  const steps: Step[] = [];
  let breakerRaceId: number | null = null;

  const sortedA = [...options.a81A].sort((x, y) => x - y);
  const sortedB = [...options.a81B].sort((x, y) => x - y);
  const a81 = firstAscDiff(sortedA, sortedB);
  const excludedNote = options.a81IncludesExcluded
    ? 'Excluded scores included.'
    : 'Excluded scores not used.';

  if (a81) {
    steps.push({
      rule: options.a81RuleLabel,
      note: `${excludedNote} ${a81.scoreA} vs ${a81.scoreB} at position ${a81.position}.`,
      subtitle: options.a81Subtitle,
      resolved: true,
      comparison: { mode: 'A8.1', ...a81 },
    });
    return { steps, breakerRaceId };
  }

  steps.push({
    rule: options.a81RuleLabel,
    note: `${excludedNote} All compared scores identical — still tied.`,
    subtitle: options.a81Subtitle,
    resolved: false,
  });

  const a82 = firstPairDiff(options.a82PairsDesc);
  if (a82) {
    breakerRaceId = a82.raceId;
    steps.push({
      rule: 'RRS A8.2',
      note: `Last race backward: ${a82.scoreA} vs ${a82.scoreB}.`,
      subtitle: options.a82Subtitle,
      resolved: true,
      comparison: {
        mode: 'A8.2',
        scoreA: a82.scoreA,
        scoreB: a82.scoreB,
        raceId: a82.raceId,
      },
    });
  } else {
    steps.push({
      rule: 'RRS A8.2',
      note: 'All scores identical — tie could not be broken.',
      subtitle: options.a82Subtitle,
      resolved: false,
    });
  }

  return { steps, breakerRaceId };
}

function explainQualifying(
  event_id: any,
  boatAId: string,
  boatBId: string,
): TieBreakExplanation {
  const discardConfig = getEventDiscardConfig(event_id, 'qualifying');
  const aRaces = getSeriesRaceDisplay(
    event_id,
    boatAId,
    'Qualifying',
    discardConfig,
  );
  const bRaces = getSeriesRaceDisplay(
    event_id,
    boatBId,
    'Qualifying',
    discardConfig,
  );

  const totalA = sumKept(aRaces);
  const totalB = sumKept(bRaces);
  const tied = totalA === totalB;

  const base: TieBreakExplanation = {
    tied,
    totalA,
    totalB,
    winnerBoatId: null,
    route: null,
    steps: [],
    raceGrid: [],
    sharedRacePairs: buildSharedPairs(aRaces, bRaces),
    sharedQualRacePairs: [],
  };
  if (!tied) return base;

  const keptA = aRaces
    .filter((r) => !r.excluded)
    .map((r) => r.points)
    .sort((x, y) => x - y);
  const keptB = bRaces
    .filter((r) => !r.excluded)
    .map((r) => r.points)
    .sort((x, y) => x - y);

  // Authoritative winner from the same comparator the ranking uses. Single-
  // vs-multi-heat is an event-level property, so it is detected across every
  // boat in the event — not just this tied pair (SHRS 5.7.1 vs 5.7.2).
  const allBoatIds = getAllQualifyingBoatIds(event_id);
  const isSingleHeatEvent = detectSingleHeatEvent(
    event_id,
    allBoatIds.length >= 2 ? allBoatIds : [boatAId, boatBId],
  );
  const cmp = compareQualifyingTieCandidates(
    event_id,
    { boat_id: boatAId, keptScores: keptA },
    { boat_id: boatBId, keptScores: keptB },
    isSingleHeatEvent,
  );
  base.winnerBoatId = cmp <= 0 ? boatAId : boatBId;

  const sharedPairs = base.sharedRacePairs;
  const a82PairsDesc = [...sharedPairs].sort(
    (l, r) => r.raceNumber - l.raceNumber || r.raceId - l.raceId,
  );

  let route: { rule: string; note: string };
  let stepResult: { steps: Step[]; breakerRaceId: number | null };

  if (sharedPairs.length > 0 && !isSingleHeatEvent) {
    route = {
      rule: 'SHRS 5.7(ii)',
      note: `Multiple-heat event. ${sharedPairs.length} shared-heat race(s) are used to break the tie, including excluded scores (SHRS 5.7(ii)(2)).`,
    };
    stepResult = buildA8Steps({
      a81A: sharedPairs.map((p) => p.pointsA),
      a81B: sharedPairs.map((p) => p.pointsB),
      a81IncludesExcluded: true,
      a82PairsDesc,
      a81Subtitle:
        'Compare shared-heat scores best to worst (excluded scores included).',
      a82Subtitle: 'Compare shared-heat scores from last race backward.',
      a81RuleLabel: 'RRS A8.1 + SHRS 5.7(ii)(2)',
    });
  } else if (sharedPairs.length > 0) {
    route = {
      rule: 'SHRS 5.7(i)',
      note: 'Single-heat event. Standard RRS A8.1 then A8.2 apply.',
    };
    stepResult = buildA8Steps({
      a81A: keptA,
      a81B: keptB,
      a81IncludesExcluded: false,
      a82PairsDesc,
      a81Subtitle: 'Compare non-excluded scores, best to worst.',
      a82Subtitle: 'Compare all scores from last race backward.',
      a81RuleLabel: 'RRS A8.1',
    });
  } else {
    route = {
      rule: 'SHRS 5.7(ii)(4)',
      note: 'The tied boats never sailed in the same heat. Standard RRS A8.1 and A8.2 apply without modification.',
    };
    // No shared races: A8.2 compares each boat's own scores by index, last-first.
    const maxLen = Math.max(aRaces.length, bRaces.length);
    const indPairsDesc = Array.from({ length: maxLen }, (_u, i) => ({
      raceId: aRaces[i]?.race_id ?? bRaces[i]?.race_id ?? -i,
      pointsA: aRaces[i]?.points ?? Number.MAX_SAFE_INTEGER,
      pointsB: bRaces[i]?.points ?? Number.MAX_SAFE_INTEGER,
    })).reverse();
    stepResult = buildA8Steps({
      a81A: keptA,
      a81B: keptB,
      a81IncludesExcluded: false,
      a82PairsDesc: indPairsDesc,
      a81Subtitle: 'Compare non-excluded scores, best to worst.',
      a82Subtitle: 'Compare all scores from last race backward.',
      a81RuleLabel: 'RRS A8.1',
    });
  }

  base.route = route;
  base.steps = stepResult.steps;
  base.raceGrid =
    sharedPairs.length > 0
      ? buildSharedRaceGrid(sharedPairs, stepResult.breakerRaceId)
      : buildIndividualRaceGrid(aRaces, bRaces);
  return base;
}

function explainOverall(
  event_id: any,
  boatAId: string,
  boatBId: string,
): TieBreakExplanation {
  const qualConfig = getEventDiscardConfig(event_id, 'qualifying');
  const finalConfig = getEventDiscardConfig(event_id, 'final');

  const aQual = getSeriesRaceDisplay(
    event_id,
    boatAId,
    'Qualifying',
    qualConfig,
  );
  const bQual = getSeriesRaceDisplay(
    event_id,
    boatBId,
    'Qualifying',
    qualConfig,
  );
  const aFinal = getSeriesRaceDisplay(event_id, boatAId, 'Final', finalConfig);
  const bFinal = getSeriesRaceDisplay(event_id, boatBId, 'Final', finalConfig);

  const aAll = [...aQual, ...aFinal];
  const bAll = [...bQual, ...bFinal];

  const totalA = sumKept(aQual) + sumKept(aFinal);
  const totalB = sumKept(bQual) + sumKept(bFinal);
  const tied = totalA === totalB;

  const sharedQualRacePairs = buildSharedPairs(aQual, bQual);
  const sharedFinalRacePairs = buildSharedPairs(aFinal, bFinal);
  const sharedPairs = [...sharedQualRacePairs, ...sharedFinalRacePairs];

  const base: TieBreakExplanation = {
    tied,
    totalA,
    totalB,
    winnerBoatId: null,
    route: null,
    steps: [],
    raceGrid: [],
    sharedRacePairs: sharedFinalRacePairs,
    sharedQualRacePairs,
  };
  if (!tied) return base;

  // Authoritative winner from the overall (combined) comparator.
  const packetA = buildOverallTiePacket(event_id, boatAId);
  const packetB = buildOverallTiePacket(event_id, boatBId);
  const cmp = compareOverallTiePackets(boatAId, boatBId, packetA, packetB);
  base.winnerBoatId = cmp <= 0 ? boatAId : boatBId;

  const a82PairsDesc = [...sharedPairs].sort(
    (l, r) => r.raceNumber - l.raceNumber || r.raceId - l.raceId,
  );

  let route: { rule: string; note: string };
  let stepResult: { steps: Step[]; breakerRaceId: number | null };

  if (sharedPairs.length > 0) {
    route = {
      rule: 'SHRS 5.7(ii)',
      note: `Multiple-heat event. ${sharedPairs.length} shared-heat race(s) across the qualifying and final series are used, including excluded scores (SHRS 5.7(ii)(2)).`,
    };
    stepResult = buildA8Steps({
      a81A: sharedPairs.map((p) => p.pointsA),
      a81B: sharedPairs.map((p) => p.pointsB),
      a81IncludesExcluded: true,
      a82PairsDesc,
      a81Subtitle:
        'Compare shared-heat scores best to worst (excluded scores included).',
      a82Subtitle: 'Compare shared-heat scores from last race backward.',
      a81RuleLabel: 'RRS A8.1 + SHRS 5.7(ii)(2)',
    });
  } else {
    route = {
      rule: 'SHRS 5.7(ii)(4)',
      note: 'The tied boats never sailed in the same heat. Standard RRS A8.1 and A8.2 apply without modification.',
    };
    const keptA = aAll.filter((r) => !r.excluded).map((r) => r.points);
    const keptB = bAll.filter((r) => !r.excluded).map((r) => r.points);
    const maxLen = Math.max(aAll.length, bAll.length);
    const indPairsDesc = Array.from({ length: maxLen }, (_u, i) => ({
      raceId: aAll[i]?.race_id ?? bAll[i]?.race_id ?? -i,
      pointsA: aAll[i]?.points ?? Number.MAX_SAFE_INTEGER,
      pointsB: bAll[i]?.points ?? Number.MAX_SAFE_INTEGER,
    })).reverse();
    stepResult = buildA8Steps({
      a81A: keptA,
      a81B: keptB,
      a81IncludesExcluded: false,
      a82PairsDesc: indPairsDesc,
      a81Subtitle: 'Compare non-excluded scores, best to worst.',
      a82Subtitle: 'Compare all scores from last race backward.',
      a81RuleLabel: 'RRS A8.1',
    });
  }

  base.route = route;
  base.steps = stepResult.steps;
  base.raceGrid =
    sharedPairs.length > 0
      ? buildSharedRaceGrid(sharedPairs, stepResult.breakerRaceId)
      : buildIndividualRaceGrid(aAll, bAll);
  return base;
}

export default function explainTieBreak(
  event_id: any,
  boatAId: string,
  boatBId: string,
  isFinalSeries: boolean,
): TieBreakExplanation {
  return isFinalSeries
    ? explainOverall(event_id, boatAId, boatBId)
    : explainQualifying(event_id, boatAId, boatBId);
}
