/**
 * Fixture loader for the IOM European Championship 2025 e2e JSON files.
 *
 * Two published documents from the same event live in `e2e/fixtures`:
 *
 *  - `The IOM EC 2025 corrected.json` — the corrected final result sheet.
 *    98 competitors, 5 heats (A–E), 18 races (Q1–Q12 qualifying, F1–F6 final;
 *    Heat E sailed no F6). Every cell carries the printed text (`raw`), the
 *    numeric `score`, the penalty `code` and whether the sheet parenthesised
 *    it as a discard, plus the published `total` (gross) and `nett` columns and
 *    the published `overall_rank` / `heat_rank`.
 *
 *  - `The International One Metre Class European Championship 2025_heat_1.json`
 *    — the starting heats for QRace 1: the 98 entries split A/B/C/D/E as
 *    20/20/20/19/19, each heat listed in seeding order.
 *
 * These are the ONLY published numbers the logic tests treat as ground truth.
 * Everything the tests compare against is read from here, never recomputed by
 * the test with a second copy of the scoring rules.
 *
 * The JSON is read with `fs` rather than `import`ed: `resolveJsonModule` would
 * make TypeScript infer a literal type for a 280 KB file on every ts-jest
 * compile, which is slow enough to be worth avoiding.
 */
import fs from 'fs';
import path from 'path';
import { fleetNameForIndex } from '../../shared/fleetNames';

const FIXTURE_DIR = path.resolve(__dirname, '../../../e2e/fixtures');

export interface PublishedRace {
  /** "Q1".."Q12" for the qualifying series, "F1".."F6" for the finals. */
  race: string;
  /** The cell as printed, e.g. "5", "(7)", "(DNF 21)". */
  raw: string;
  /** True when the sheet printed the cell in parentheses. */
  discarded: boolean;
  /** Penalty code, or null for an ordinary finish. */
  code: string | null;
  score: number;
}

export interface PublishedCompetitor {
  /** The boat's FINAL heat, "Heat A".."Heat E". */
  heat: string;
  overall_rank: number;
  heat_rank: number;
  name: string;
  country: string;
  sail_number: string;
  category: string;
  category_code: string | null;
  boat_type: string;
  races: PublishedRace[];
  /** Published gross score: the sum of all 18 (17 for Heat E) races. */
  total: number;
  /** Published nett score: gross minus the discards. */
  nett: number;
}

export interface PublishedResults {
  event: string;
  short_name: string;
  competitor_count: number;
  heats: string[];
  results: PublishedCompetitor[];
}

export interface StartingHeatEntry {
  position: number;
  name: string;
  country: string;
  sail_number: string;
}

export interface StartingHeat {
  heat: string;
  race: string;
  heat_letter: string;
  entry_count: number;
  entries: StartingHeatEntry[];
}

export interface StartingHeats {
  event: string;
  heat_count: number;
  entry_count: number;
  heats: StartingHeat[];
}

function readFixture<T>(fileName: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8'),
  ) as T;
}

export const publishedResults = (): PublishedResults =>
  readFixture<PublishedResults>('The IOM EC 2025 corrected.json');

export const startingHeats = (): StartingHeats =>
  readFixture<StartingHeats>(
    'The International One Metre Class European Championship 2025_heat_1.json',
  );

export const QUALIFYING_LABELS = Array.from(
  { length: 12 },
  (_unused, index) => `Q${index + 1}`,
);
export const FINAL_LABELS = Array.from(
  { length: 6 },
  (_unused, index) => `F${index + 1}`,
);

export const isQualifying = (race: PublishedRace) => race.race.startsWith('Q');
export const isFinal = (race: PublishedRace) => race.race.startsWith('F');

/**
 * The heat letters A–E are the final fleets in precedence order, so Heat A is
 * the app's "Gold", Heat B "Silver", … and Heat E the 5th fleet, which the app
 * names "Fleet 5" (SHRS 4.1 allows more fleets than there are named ones —
 * `fleetNameForIndex` is the app's own naming, reused here so the replay uses
 * the fleet labels the app would have created rather than a second copy).
 */
export const HEAT_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export const fleetForHeat = (heat: string): string => {
  const index = HEAT_LETTERS.indexOf(heat.replace(/^Heat\s+/i, '').trim());
  if (index === -1) throw new Error(`Unknown heat: ${heat}`);
  return fleetNameForIndex(index);
};

/** The `Heats.heat_name` the app stores for a final fleet, e.g. "Final Gold". */
export const finalHeatNameFor = (heat: string): string =>
  `Final ${fleetForHeat(heat)}`;

/**
 * The published `code` values, mapped onto the app's score-status vocabulary
 * (src/main/functions/scoreStatus.ts).
 *
 * Every code in this fixture — DNF, DNS, DNC, DSQ, BFD, RET, DNE, NSC, OCS —
 * is spelled the same way by the app. Only redress differs: the sheet prints a
 * bare "RDG" while the app distinguishes RDG1/RDG2/RDG3 by which RRS A6.2 /
 * A10 method produced the points. The method is not recorded on the sheet, and
 * it does not affect scoring (all three are excludable and keep the points
 * given), so RDG1 stands in for all of them.
 */
export const statusForCode = (code: string | null): string => {
  if (!code) return 'FINISHED';
  return code === 'RDG' ? 'RDG1' : code;
};

/**
 * One row of the app's `Scores` table, joined to its race and heat — the shape
 * every scoring query in the main process reads.
 */
export interface ReplayScoreRow {
  boat_id: string;
  race_id: number;
  race_number: number;
  points: number;
  status: string;
  heat_type: 'Qualifying' | 'Final';
  heat_name: string;
}

export interface ReplayBoat {
  boat_id: string;
  competitor: PublishedCompetitor;
  finalHeatName: string;
}

export interface Replay {
  boats: ReplayBoat[];
  scores: ReplayScoreRow[];
  boatById: Map<string, ReplayBoat>;
}

/**
 * Turn the published sheet into the rows the app's scoring functions read.
 *
 * RACE IDENTITY — the one thing the sheet does not record.
 *
 * The result sheet gives each boat one score per race LABEL (Q1..Q12, F1..F6).
 * For the FINAL series that is a faithful description of the event: each fleet
 * sails its own race, and the sheet does record which final heat each boat was
 * in, so "F3 in Heat C" is a single, identifiable race. Each (fleet, label)
 * pair therefore gets its own `race_id`.
 *
 * The QUALIFYING series is different. Each qualifying round was five separate
 * races sailed by five heats of ~20 (for every Q label exactly five boats are
 * scored on each place, 1..20), and SHRS 3.1 re-seeds the heats after every
 * round — but the sheet never prints which qualifying heat a boat was in.
 *
 * That matters only for tie-breaks. SHRS 5.7.2.2 compares two tied boats on
 * the races they SHARED, and falls back to plain RRS A8 for boats that shared
 * none (5.7.2.5). So the replay has to choose what to tell the app about
 * qualifying races that it does not actually know:
 *
 *   'per-boat' (default) — give every boat her own race_id for each qualifying
 *     label, so the app is never told that two boats shared a qualifying race.
 *     Tie-breaks then use only the shared races the sheet does record (a common
 *     final fleet), which is the honest reading of the fixture.
 *
 *   'shared' — model a qualifying label as ONE race sailed by all 98 boats.
 *     Convenient, but it asserts a shared-race set that is not in the data, and
 *     it also flips `detectSingleHeatEvent` to true, which sends the qualifying
 *     leaderboard down the SHRS 5.7.1 single-heat branch. Kept so a test can
 *     show what changes; see euroIom2025.published.test.ts.
 *
 * Neither choice can change a total: a boat's series score depends only on her
 * own scores and the series-wide discard count, both of which are printed.
 */
export type QualifyingRaceIdentity = 'per-boat' | 'shared';

export function buildReplay(
  published: PublishedResults,
  qualifyingRaceIdentity: QualifyingRaceIdentity = 'per-boat',
): Replay {
  const boats: ReplayBoat[] = published.results.map((competitor, index) => ({
    // The app's boat_id is a string primary key; the scoring functions compare
    // it with `===` and use it as a Map key, so the type has to match theirs.
    boat_id: String(index + 1),
    competitor,
    finalHeatName: finalHeatNameFor(competitor.heat),
  }));

  // Qualifying race ids. In 'shared' mode one id per label; in 'per-boat' mode
  // one id per (boat, label), so no two boats ever share a qualifying race id.
  const qualifyingRaceId = (boatIndex: number, label: string): number => {
    const labelIndex = QUALIFYING_LABELS.indexOf(label);
    return qualifyingRaceIdentity === 'shared'
      ? 1000 + labelIndex
      : 1000 + (boatIndex + 1) * QUALIFYING_LABELS.length + labelIndex;
  };

  // Final race ids continue after the qualifying block and are unique per
  // (fleet, label), because each fleet sails its own final race.
  const finalRaceId = new Map<string, number>();
  published.heats.forEach((heat, heatIndex) => {
    FINAL_LABELS.forEach((label, labelIndex) => {
      finalRaceId.set(
        `${heat}|${label}`,
        100 + heatIndex * FINAL_LABELS.length + labelIndex,
      );
    });
  });

  const scores: ReplayScoreRow[] = [];
  boats.forEach((boat, boatIndex) => {
    boat.competitor.races.forEach((race) => {
      const qualifying = isQualifying(race);
      const raceNumber = Number(race.race.slice(1));
      scores.push({
        boat_id: boat.boat_id,
        race_id: qualifying
          ? qualifyingRaceId(boatIndex, race.race)
          : (finalRaceId.get(`${boat.competitor.heat}|${race.race}`) as number),
        // Race numbers restart at 1 for the final series: it is a separate
        // series (SHRS 5.1) with its own race sequence, which is how the app
        // numbers final races too.
        race_number: raceNumber,
        points: race.score,
        status: statusForCode(race.code),
        heat_type: qualifying ? 'Qualifying' : 'Final',
        heat_name: qualifying ? 'Qualifying' : boat.finalHeatName,
      });
    });
  });

  return {
    boats,
    scores,
    boatById: new Map(boats.map((boat) => [boat.boat_id, boat])),
  };
}

/** A competitor's races in one series, in printed order. */
export const racesInSeries = (
  competitor: PublishedCompetitor,
  series: 'Qualifying' | 'Final',
): PublishedRace[] =>
  competitor.races.filter(series === 'Qualifying' ? isQualifying : isFinal);

/** Sum of the printed scores for one series (the gross score for that series). */
export const grossForSeries = (
  competitor: PublishedCompetitor,
  series: 'Qualifying' | 'Final',
): number =>
  racesInSeries(competitor, series).reduce((sum, race) => sum + race.score, 0);

/**
 * The series nett the SHEET ITSELF asserts, taken from its parentheses: gross
 * minus every cell the sheet printed as discarded.
 *
 * Not the same thing as the published `nett` column for two of the 98 boats —
 * see the DNE discussion in euroIom2025.published.test.ts.
 */
export const sheetFlaggedNettForSeries = (
  competitor: PublishedCompetitor,
  series: 'Qualifying' | 'Final',
): number =>
  racesInSeries(competitor, series).reduce(
    (sum, race) => (race.discarded ? sum : sum + race.score),
    0,
  );
