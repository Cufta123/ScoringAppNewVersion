/**
 * Replay of a real, published regatta through the app's own scoring functions.
 *
 * The fixture is the corrected final result sheet of the IOM European
 * Championship 2025 (`e2e/fixtures/The IOM EC 2025 corrected.json`): 98
 * competitors, 12 qualifying races, 5 final fleets, 6 final races, and the
 * penalty codes a real week produces — 33 DNF, 19 BFD, 14 DSQ, 13 DNS, 8 RET,
 * 5 RDG, 4 DNC, 4 DNE, 3 NSC, 1 OCS.
 *
 * The test feeds each boat the scores she actually got and checks that the app
 * arrives at the numbers the sheet printed. Where it does not, the difference
 * is characterised and explained at the assertion rather than smoothed over —
 * nothing in `src/` is changed on account of these results.
 *
 * What is compared, and against what:
 *
 *   - the app's qualifying total + final total, against the sheet's printed
 *     `nett` column;
 *   - which races the app discards, against the cells the sheet printed in
 *     parentheses;
 *   - the overall order the app produces, against the sheet's `overall_rank`.
 *
 * Nothing here recomputes a score with a second copy of the scoring rules: the
 * expected values are read from the sheet.
 */
import calculateBoatScores from '../main/functions/calculateBoatScores';
import calculateFinalBoatScores from '../main/functions/calculateFinalBoatScores';
import {
  buildOverallTiePacket,
  resolveOverallTieGroupSequentially,
  OverallTiePacket,
} from '../main/functions/overallTieBreak';
import { getExcludedIndexes } from '../shared/scoring/discards';
import { fleetRank } from '../shared/fleetNames';
import { db } from '../../public/Database/DBManager';
import { createReplayDb } from './fixtures/replayScoringDb';
import {
  buildReplay,
  fleetForHeat,
  grossForSeries,
  publishedResults,
  racesInSeries,
  sheetFlaggedNettForSeries,
  statusForCode,
  FINAL_LABELS,
  QUALIFYING_LABELS,
  PublishedCompetitor,
  Replay,
} from './fixtures/euroIom2025';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

const EVENT_ID = 1;

const published = publishedResults();
const replay: Replay = buildReplay(published);
const competitorOf = (boat_id: string) =>
  replay.boatById.get(boat_id)?.competitor as PublishedCompetitor;

/** Qualifying totals as the app computes them, keyed by boat_id. */
function runQualifying(): Map<string, number> {
  const results = replay.boats.map((boat) => ({
    boat_id: boat.boat_id,
    total_points_event: 0,
    number_of_races: racesInSeries(boat.competitor, 'Qualifying').length,
  }));
  const table = calculateBoatScores(results, EVENT_ID);
  return new Map(table.map((row) => [row.boat_id, row.totalPoints]));
}

/** Final-series tables per fleet, exactly as the app builds them. */
function runFinal() {
  const results = replay.boats.map((boat) => ({
    boat_id: boat.boat_id,
    total_points_final: 0,
    heat_name: boat.finalHeatName,
  }));
  return calculateFinalBoatScores(results, EVENT_ID);
}

let qualifyingTotals: Map<string, number>;
let finalTables: Map<
  string,
  { boat_id: string; totalPoints: number; place?: number }[]
>;
let finalTotals: Map<string, number>;

beforeAll(() => {
  // calculateBoatScores logs a line per boat and per tie group; 98 boats make
  // that ~250 lines of noise around the assertions.
  jest.spyOn(console, 'log').mockImplementation(() => {});
  (db as unknown as { prepare: jest.Mock }).prepare.mockImplementation(
    createReplayDb({ scores: replay.scores }).prepare,
  );
  qualifyingTotals = runQualifying();
  finalTables = runFinal();
  finalTotals = new Map();
  finalTables.forEach((table) =>
    table.forEach((row) => finalTotals.set(row.boat_id, row.totalPoints)),
  );
});

afterAll(() => {
  jest.restoreAllMocks();
});

/**
 * The overall order, built the way `readOverallLeaderboard` builds it: SHRS 5.5
 * fleet precedence first, then the combined qualifying + final score, then the
 * SHRS 5.7.2 tie-break packets. That handler is bound to `ipcMain.handle`, so
 * its ordering is mirrored here rather than imported; every rule it applies
 * comes from the modules under test.
 */
function orderFor(
  rep: Replay,
  qTotals: Map<string, number>,
  fTotals: Map<string, number>,
) {
  const rows = rep.boats.map((boat) => ({
    boat_id: boat.boat_id,
    placement_group: fleetForHeat(boat.competitor.heat),
    overall_points:
      (qTotals.get(boat.boat_id) as number) +
      (fTotals.get(boat.boat_id) as number),
  }));

  rows.sort((left, right) => {
    const fleetDelta =
      fleetRank(left.placement_group) - fleetRank(right.placement_group);
    if (fleetDelta !== 0) return fleetDelta;
    return left.overall_points - right.overall_points;
  });

  const packets = new Map<string, OverallTiePacket>();
  const getTiePacket = (boat_id: string) => {
    if (!packets.has(boat_id)) {
      packets.set(boat_id, buildOverallTiePacket(EVENT_ID, boat_id));
    }
    return packets.get(boat_id) as OverallTiePacket;
  };

  const resolved: typeof rows = [];
  let i = 0;
  while (i < rows.length) {
    const { placement_group, overall_points } = rows[i];
    const group: typeof rows = [];
    while (
      i < rows.length &&
      rows[i].placement_group === placement_group &&
      rows[i].overall_points === overall_points
    ) {
      group.push(rows[i]);
      i += 1;
    }
    resolved.push(
      ...(group.length > 1
        ? resolveOverallTieGroupSequentially(group, getTiePacket)
        : group),
    );
  }
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// The premises the replay rests on. If one of these breaks, the scoring
// comparisons below are comparing something other than what they claim to.
// ─────────────────────────────────────────────────────────────────────────────
describe('published sheet — structure the replay depends on', () => {
  it('is the 98-boat, 5-heat event the fixture header claims', () => {
    expect(published.results).toHaveLength(published.competitor_count);
    expect(published.results).toHaveLength(98);
    expect(published.heats).toEqual([
      'Heat A',
      'Heat B',
      'Heat C',
      'Heat D',
      'Heat E',
    ]);
    const sizes = published.heats.map(
      (heat) => published.results.filter((c) => c.heat === heat).length,
    );
    expect(sizes).toEqual([20, 20, 20, 19, 19]);
  });

  it("prints a `total` that is the plain sum of the boat's races", () => {
    published.results.forEach((competitor) => {
      const sum = competitor.races.reduce((acc, race) => acc + race.score, 0);
      // Two boats carry a redress score of x.1, so compare with a tolerance
      // rather than exactly — the sheet prints one decimal.
      expect(sum).toBeCloseTo(competitor.total, 6);
    });
  });

  it('sailed Q1–Q12 for everyone and F1–F6 for every fleet but Heat E', () => {
    published.results.forEach((competitor) => {
      const labels = competitor.races.map((race) => race.race);
      const expected =
        competitor.heat === 'Heat E'
          ? [...QUALIFYING_LABELS, ...FINAL_LABELS.slice(0, 5)]
          : [...QUALIFYING_LABELS, ...FINAL_LABELS];
      expect(labels).toEqual(expected);
    });
  });

  it('scores each qualifying race in five heats, so the sheet cannot say which heat a boat was in', () => {
    // Every qualifying place is held by exactly five boats — five heats of
    // ~20 sailing the same race number. Which five boats shared a heat is not
    // printed anywhere, which is why `buildReplay` models a qualifying label
    // as one race; see the note there.
    QUALIFYING_LABELS.forEach((label) => {
      const winners = published.results.filter((competitor) =>
        competitor.races.some(
          (race) => race.race === label && race.score === 1,
        ),
      );
      expect(winners).toHaveLength(5);
    });
  });

  it('scores each final race inside one fleet, which the sheet does record', () => {
    // Within a fleet a final race is a permutation of 1..n, with a penalty
    // score of 21 standing in for a place. That is what lets `buildReplay`
    // give each (fleet, label) pair its own race_id.
    published.heats.forEach((heat) => {
      const fleet = published.results.filter((c) => c.heat === heat);
      const labels =
        heat === 'Heat E' ? FINAL_LABELS.slice(0, 5) : FINAL_LABELS;
      labels.forEach((label) => {
        const finishes = fleet
          .map((competitor) =>
            competitor.races.find((race) => race.race === label),
          )
          .filter((race) => race && !race.code)
          .map((race) => (race as { score: number }).score);
        expect(new Set(finishes).size).toBe(finishes.length);
      });
    });
  });

  it('scores non-finishers as largest heat + 1 (SHRS 5.2)', () => {
    // The largest heat is 20 boats, so DNF/DNS/DNC/DSQ/BFD score 21 — which is
    // the value the app's own `deriveNonFinisherPoints` would produce.
    const nonFinisher = published.results.flatMap((competitor) =>
      competitor.races.filter((race) =>
        [
          'DNF',
          'DNS',
          'DNC',
          'DSQ',
          'BFD',
          'RET',
          'DNE',
          'NSC',
          'OCS',
        ].includes(race.code ?? ''),
      ),
    );
    expect(nonFinisher.length).toBeGreaterThan(90);
    nonFinisher.forEach((race) => expect(race.score).toBe(21));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Qualifying series — src/main/functions/calculateBoatScores.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('qualifying series scored by calculateBoatScores', () => {
  it('scores all 98 boats', () => {
    expect(qualifyingTotals.size).toBe(98);
  });

  it('discards two qualifying races, as SHRS 5.4 requires for a 12-race series', () => {
    // 12 races: one discard from 4, a second from 8, the third only from 16.
    // Checked without re-deriving WHICH two: the amount the app dropped has to
    // be the sum of exactly two of the boat's own twelve scores.
    replay.boats.forEach((boat) => {
      const scores = racesInSeries(boat.competitor, 'Qualifying').map(
        (race) => race.score,
      );
      const dropped =
        grossForSeries(boat.competitor, 'Qualifying') -
        (qualifyingTotals.get(boat.boat_id) as number);
      const pairs = scores.flatMap((left, index) =>
        scores.slice(index + 1).map((right) => left + right),
      );
      expect(pairs.some((sum) => Math.abs(sum - dropped) < 1e-6)).toBe(true);
      // …and never a single score, which is what one discard would have left.
      expect(scores.some((score) => Math.abs(score - dropped) < 1e-6)).toBe(
        false,
      );
    });
  });

  it('picks the same two qualifying discards the sheet printed, for 96 of 98 boats', () => {
    const differing = replay.boats.filter((boat) => {
      const appTotal = qualifyingTotals.get(boat.boat_id) as number;
      return (
        Math.abs(
          appTotal - sheetFlaggedNettForSeries(boat.competitor, 'Qualifying'),
        ) > 1e-6
      );
    });

    // The two exceptions are the two boats that carry a DNE.
    //
    // The sheet PRINTS "(DNE 21)" — in parentheses, its own notation for a
    // discard — but its `nett` column is computed as though the DNE were not
    // discarded, dropping the next-worst score instead. RRS 90.3(b) makes a DNE
    // non-excludable, so the nett column is right and the parentheses are a
    // presentation artefact of the source PDF.
    //
    // The app agrees with the nett column: `scoringUtils.nonExcludableStatuses`
    // holds DNE and DGM, and `getExcludedIndexes` skips them. So this is the
    // app matching the published RESULT while disagreeing with the published
    // FORMATTING — the third assertion below pins that down.
    expect(differing.map((boat) => boat.competitor.name).sort()).toEqual([
      'Goirand Philippe',
      'Gomes Paulo Maio',
    ]);

    differing.forEach((boat) => {
      const races = racesInSeries(boat.competitor, 'Qualifying');
      const flagged = races.filter((race) => race.discarded);
      // Exactly one of the cells the sheet parenthesised is a DNE …
      expect(flagged.filter((race) => race.code === 'DNE')).toHaveLength(1);
      // … and the app excluded a different pair, which never includes the DNE.
      const excluded = getExcludedIndexes(
        races.map((race) => ({
          points: race.score,
          status: statusForCode(race.code),
          race_number: Number(race.race.slice(1)),
        })),
        2,
      );
      expect([...excluded].some((index) => races[index].code === 'DNE')).toBe(
        false,
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Final series — src/main/functions/calculateFinalBoatScores.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('final series scored by calculateFinalBoatScores', () => {
  it('builds one table per fleet, with the published fleet sizes', () => {
    expect([...finalTables.keys()].sort()).toEqual(
      published.heats.map(fleetForHeat).sort(),
    );
    published.heats.forEach((heat) => {
      const table = finalTables.get(fleetForHeat(heat)) as unknown[];
      expect(table).toHaveLength(
        published.results.filter((c) => c.heat === heat).length,
      );
    });
  });

  it('reproduces every final-series discard the sheet printed', () => {
    // Six final races (five for Heat E) means one discard, and unlike the
    // qualifying series there is no DNE among the final races, so the app and
    // the sheet agree on all 98 boats.
    replay.boats.forEach((boat) => {
      expect(finalTotals.get(boat.boat_id)).toBeCloseTo(
        sheetFlaggedNettForSeries(boat.competitor, 'Final'),
        6,
      );
    });
  });

  it("ranks each fleet by its FINAL-series score, which is not the sheet's heat_rank", () => {
    // Worth being explicit about, because the columns look comparable and are
    // not. `FinalLeaderboard.place` is the boat's place in the final series
    // alone (SHRS 5.1 scores each fleet as its own series). The sheet's
    // `heat_rank` is her place in the heat OVERALL — qualifying plus final —
    // which in this app is `readOverallLeaderboard`, exercised further down.
    finalTables.forEach((table) => {
      const totals = table.map((row) => row.totalPoints);
      expect([...totals].sort((a, b) => a - b)).toEqual(totals);
      expect(table.map((row) => row.place)).toEqual(
        table.map((_row, index) => index + 1),
      );
    });

    const sheetOrder = published.results
      .filter((competitor) => competitor.heat === 'Heat A')
      .map((competitor) => competitor.name);
    const finalSeriesOrder = (
      finalTables.get(fleetForHeat('Heat A')) as { boat_id: string }[]
    ).map((row) => competitorOf(row.boat_id).name);
    expect(finalSeriesOrder).not.toEqual(sheetOrder);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overall leaderboard — the combined series the sheet actually publishes.
// ─────────────────────────────────────────────────────────────────────────────
describe('overall standings', () => {
  it("reproduces the sheet's nett column for all 98 boats", () => {
    // This is the headline check: the app scores the two series separately
    // (12 qualifying races, 2 discards; 6 final races, 1 discard) and adds
    // them, which is exactly the decomposition behind the published nett.
    replay.boats.forEach((boat) => {
      const combined =
        (qualifyingTotals.get(boat.boat_id) as number) +
        (finalTotals.get(boat.boat_id) as number);
      expect(combined).toBeCloseTo(boat.competitor.nett, 6);
    });
  });

  it('ranks the fleets in the published order (SHRS 5.5)', () => {
    const heats = orderFor(replay, qualifyingTotals, finalTotals).map(
      (row) => competitorOf(row.boat_id).heat,
    );
    expect(heats).toEqual(published.results.map((c) => c.heat));
  });

  it('reproduces the published overall order except for one tie the sheet cannot explain', () => {
    const appOrder = orderFor(replay, qualifyingTotals, finalTotals).map(
      (row) => competitorOf(row.boat_id).name,
    );
    const sheetOrder = published.results.map((competitor) => competitor.name);

    const differing = appOrder
      .map((name, index) => ({ name, sheet: sheetOrder[index], index }))
      .filter((row) => row.name !== row.sheet);

    // 96 of 98 rows land on the published rank. The two that do not are the
    // Heat A pair tied on 70 points, ranked 7th and 8th on the sheet:
    //
    //   Beltri Guillermo  Q 2 4 2 (9) 1 5 6 5 1 5 (DSQ 21) 1 | F 8 3 (13) 3 13 11
    //   Golison Mark      Q 3 9 1 4 (12) 7 2 (15) 4 1 1 2   | F (19) 6 6 1 7 16
    //
    // The sheet puts Beltri first. Every A8.1 comparison that can be
    // reconstructed from the sheet puts Golison first:
    //   - kept scores only (RRS A8.1):    Beltri 1,1,1,2,…  Golison 1,1,1,1,… → Golison
    //   - all 18 scores (SHRS 5.7.2.2):   Beltri 1,1,1,2,…  Golison 1,1,1,1,… → Golison
    //   - their shared final races only:  Beltri 3,3,8,…    Golison 1,6,6,…   → Golison
    // A8.2 (last race backward over the final races) is the one comparison that
    // favours Beltri: F6 11 against 16.
    //
    // A8.2 only gets to run if A8.1 leaves the boats level, and for this pair
    // A8.1 can never do that on any race set that includes their six shared
    // Heat A finals: A8.1 compares the two sorted score vectors, and Beltri's
    // finals contain an 8, an 11 and two 13s, none of which appears anywhere in
    // Golison's eighteen scores. No addition of shared qualifying races can
    // make the two multisets equal.
    //
    // So the published order is NOT reproducible from the numbers on the sheet
    // under A8 as the app applies it. What remains, none of it checkable here:
    //   - the tie was broken on qualifying races alone (a shared-race set that
    //     excludes the finals CAN tie under A8.1, and the sheet does not record
    //     which qualifying heat anyone was in — see the structure test above);
    //   - it was broken by something outside A8 — national letter, say, where
    //     ESP precedes USA (SHRS 5.3 orders recorded ties that way, and some
    //     scoring software reuses it as a last resort);
    //   - or the sheet has it the wrong way round.
    //
    // Left as a documented difference rather than chased: the other eight ties
    // on this sheet are all resolved by A8.1 on the shared final races, exactly
    // as the app resolves them, so there is no evidence of a rule the app is
    // missing. Applying A8.2 before A8.1 would "fix" this pair and reverse five
    // of the other eight.
    expect(differing.map((row) => row.name)).toEqual([
      'Golison Mark',
      'Beltri Guillermo',
    ]);
    expect(differing.map((row) => row.index)).toEqual([6, 7]);

    // Every other published rank is reproduced exactly.
    const withoutThatTie = appOrder.filter(
      (name) => name !== 'Golison Mark' && name !== 'Beltri Guillermo',
    );
    expect(withoutThatTie).toEqual(
      sheetOrder.filter(
        (name) => name !== 'Golison Mark' && name !== 'Beltri Guillermo',
      ),
    );
  });

  it('reproduces the published heat_rank inside every fleet', () => {
    const order = orderFor(replay, qualifyingTotals, finalTotals);
    published.heats.forEach((heat) => {
      const appRanks = order
        .filter((row) => competitorOf(row.boat_id).heat === heat)
        .map((row, index) => ({
          name: competitorOf(row.boat_id).name,
          rank: index + 1,
        }));
      const sheetRanks = published.results
        .filter((competitor) => competitor.heat === heat)
        .map((competitor) => ({
          name: competitor.name,
          rank: competitor.heat_rank,
        }));
      // Heat A carries the unexplainable tie documented above; the other four
      // fleets match the sheet row for row.
      if (heat === 'Heat A') {
        expect(appRanks).not.toEqual(sheetRanks);
      } else {
        expect(appRanks).toEqual(sheetRanks);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the missing qualifying-heat information is worth.
// ─────────────────────────────────────────────────────────────────────────────
describe('the qualifying races the sheet does not record', () => {
  /**
   * The replay above never tells the app that two boats shared a qualifying
   * race, because the sheet does not say so (`buildReplay`, 'per-boat'). The
   * other reading — treat "Q7" as one race the whole entry list sailed — is
   * the tempting one, and this test is here to show what it costs.
   *
   * It is not a difference in the app: the same comparator is asked a
   * different question, because it has been handed a shared-race set that the
   * event did not have.
   */
  it('flips a second published tie if a qualifying label is modelled as one fleet-wide race', () => {
    const sharedReplay = buildReplay(published, 'shared');
    (db as unknown as { prepare: jest.Mock }).prepare.mockImplementation(
      createReplayDb({ scores: sharedReplay.scores }).prepare,
    );
    try {
      const qualifying = new Map(
        calculateBoatScores(
          sharedReplay.boats.map((boat) => ({
            boat_id: boat.boat_id,
            total_points_event: 0,
            number_of_races: racesInSeries(boat.competitor, 'Qualifying')
              .length,
          })),
          EVENT_ID,
        ).map((row) => [row.boat_id, row.totalPoints]),
      );
      const finals = new Map<string, number>();
      calculateFinalBoatScores(
        sharedReplay.boats.map((boat) => ({
          boat_id: boat.boat_id,
          total_points_final: 0,
          heat_name: boat.finalHeatName,
        })),
        EVENT_ID,
      ).forEach((table) =>
        table.forEach((row) => finals.set(row.boat_id, row.totalPoints)),
      );

      // Totals are untouched — race identity cannot change a series score.
      sharedReplay.boats.forEach((boat) => {
        expect(qualifying.get(boat.boat_id)).toBeCloseTo(
          qualifyingTotals.get(boat.boat_id) as number,
          6,
        );
        expect(finals.get(boat.boat_id)).toBeCloseTo(
          finalTotals.get(boat.boat_id) as number,
          6,
        );
      });

      // The order is not. Hrvoje Duvančić and Vedran Vesanović are tied on 129
      // in Heat C, ranked 6th and 7th on the sheet. Compared on the races the
      // sheet does record — their six shared final races — A8.1 puts Duvančić
      // first, as published. Told instead that they also shared all twelve
      // qualifying races, A8.1 walks a different vector and puts Vesanović
      // first. The published order is the one the recorded data supports.
      const names = orderFor(sharedReplay, qualifying, finals).map(
        (row) =>
          (
            sharedReplay.boatById.get(row.boat_id) as {
              competitor: PublishedCompetitor;
            }
          ).competitor.name,
      );
      const sheetOrder = published.results.map((competitor) => competitor.name);
      const differing = names.filter(
        (name, index) => name !== sheetOrder[index],
      );
      expect(differing.sort()).toEqual(
        [
          'Beltri Guillermo',
          'Golison Mark',
          'Hrvoje Duvančić',
          'Vedran Vesanović',
        ].sort(),
      );
    } finally {
      (db as unknown as { prepare: jest.Mock }).prepare.mockImplementation(
        createReplayDb({ scores: replay.scores }).prepare,
      );
    }
  });
});
