/* eslint-disable camelcase */
/**
 * Tests for explainTieBreak.ts — the backend tie-break explanation that backs
 * the leaderboard compare panel. The winner it reports must always match the
 * authoritative comparators (calculateBoatScores / overallTieBreak), and the
 * route/steps must cite the correct SHRS 5.7 rules.
 */
import explainTieBreak from '../main/functions/explainTieBreak';
import { db } from '../../public/Database/DBManager';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

const mockPrepare = (db as unknown as { prepare: jest.Mock }).prepare;

type RaceInput = {
  race_id: number;
  race_number: number;
  points: number;
  status?: string;
  heat_type?: string;
  heat_name?: string;
};

type Dataset = Record<string, RaceInput[]>;

function normalize(races: RaceInput[]): Required<RaceInput>[] {
  return races.map((race) => ({
    status: 'FINISHED',
    heat_type: 'Qualifying',
    heat_name: 'Heat A',
    ...race,
  }));
}

// Boats whose Heat_Boat row for the final heat is missing, so
// getBoatFinalHeatName returns null even though they have final Scores rows
// (a repaired/imported event). Cleared by each setupDb call.
const boatsWithoutFinalHeatRow = new Set<string>();

function setupDb(dataset: Dataset, discardProfile = 'standard') {
  boatsWithoutFinalHeatRow.clear();
  const data: Record<string, Required<RaceInput>[]> = {};
  Object.entries(dataset).forEach(([boatId, races]) => {
    data[boatId] = normalize(races);
  });

  mockPrepare.mockImplementation((sql: string) => {
    const flat = sql.replace(/\s+/g, ' ');
    return {
      get: (arg0: unknown, arg1?: string, arg2?: string) => {
        if (flat.includes('discard_profile')) {
          return { discard_profile: discardProfile };
        }
        // getSeriesDiscardRaceCount: series-wide (qualifying) / fleet-wide
        // (final) completed-race count — the max per-boat score count.
        if (flat.includes('MAX(race_count)')) {
          const heatType = arg1;
          const fleet = arg2;
          let maxCount = 0;
          Object.values(data).forEach((races) => {
            const relevant =
              heatType === 'Final'
                ? races.filter(
                    (r) =>
                      r.heat_type === 'Final' &&
                      (fleet == null || r.heat_name === fleet),
                  )
                : races.filter((r) => r.heat_type === 'Qualifying');
            maxCount = Math.max(maxCount, relevant.length);
          });
          return { max_count: maxCount };
        }
        // getBoatFinalHeatName: a boat's final fleet heat_name.
        if (
          flat.includes('h.heat_name FROM Heats h') &&
          flat.includes('Heat_Boat')
        ) {
          const boatId = arg1;
          if (boatsWithoutFinalHeatRow.has(String(boatId))) {
            return undefined;
          }
          const races = data[boatId as string] ?? [];
          const finalRace = races.find((r) => r.heat_type === 'Final');
          return finalRace ? { heat_name: finalRace.heat_name } : undefined;
        }
        return undefined;
      },
      all: (eventId: unknown, boatId?: string, heatType?: string) => {
        // Distinct boat ids across qualifying scores.
        if (flat.includes('SELECT DISTINCT s.boat_id')) {
          return Object.keys(data)
            .filter((id) => data[id].some((r) => r.heat_type === 'Qualifying'))
            .map((id) => ({ boat_id: id }));
        }

        const races = data[boatId as string] ?? [];

        // Overall tie packet: both series.
        if (flat.includes("IN ('Qualifying', 'Final')")) {
          return races.map((r) => ({ ...r }));
        }

        // getSeriesRaceDisplay: heat_type filtered, race_number ASC.
        if (
          flat.includes('h.heat_type = ?') &&
          flat.includes('ORDER BY r.race_number ASC')
        ) {
          return races
            .filter((r) => r.heat_type === heatType)
            .sort(
              (a, b) => a.race_number - b.race_number || a.race_id - b.race_id,
            )
            .map((r) => ({ ...r }));
        }

        const qual = races.filter((r) => r.heat_type === 'Qualifying');

        // getScoresForA81: points DESC.
        if (flat.includes('ORDER BY points DESC')) {
          return [...qual].sort(
            (a, b) =>
              b.points - a.points ||
              a.race_number - b.race_number ||
              a.race_id - b.race_id,
          );
        }

        // getRaceScoresForTieBreak: race_number DESC, race_id DESC.
        if (flat.includes('ORDER BY r.race_number DESC, s.race_id DESC')) {
          return [...qual]
            .sort(
              (a, b) => b.race_number - a.race_number || b.race_id - a.race_id,
            )
            .map((r) => ({
              race_id: r.race_id,
              race_number: r.race_number,
              points: r.points,
            }));
        }

        // getScoresForA82: race_number DESC, points only.
        if (flat.includes('ORDER BY r.race_number DESC')) {
          return [...qual]
            .sort((a, b) => b.race_number - a.race_number)
            .map((r) => ({ points: r.points }));
        }

        return [];
      },
    };
  });
}

describe('explainTieBreak — qualifying series', () => {
  it('reports not tied when totals differ', () => {
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 1 },
        { race_id: 2, race_number: 2, points: 1 },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 5 },
        { race_id: 2, race_number: 2, points: 5 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(false);
    expect(res.winnerBoatId).toBeNull();
    expect(res.totalA).toBe(2);
    expect(res.totalB).toBe(10);
  });

  it('uses the series-wide discard count (not the boat own) for a late entrant (SHRS 5.4)', () => {
    // The series has 8 completed qualifying races (boat C sailed them all);
    // boats A and B are late entrants with only 5 scores. Their totals must
    // discard TWO scores (series-wide 8-race count), not one (their own 5-race
    // count) — matching calculateBoatScores. RULE-M22 regression.
    setupDb({
      A: [
        { race_id: 4, race_number: 4, points: 10 },
        { race_id: 5, race_number: 5, points: 10 },
        { race_id: 6, race_number: 6, points: 1 },
        { race_id: 7, race_number: 7, points: 1 },
        { race_id: 8, race_number: 8, points: 1 },
      ],
      B: [
        { race_id: 4, race_number: 4, points: 3 },
        { race_id: 5, race_number: 5, points: 3 },
        { race_id: 6, race_number: 6, points: 3 },
        { race_id: 7, race_number: 7, points: 3 },
        { race_id: 8, race_number: 8, points: 3 },
      ],
      C: [
        { race_id: 1, race_number: 1, points: 1 },
        { race_id: 2, race_number: 2, points: 1 },
        { race_id: 3, race_number: 3, points: 1 },
        { race_id: 4, race_number: 4, points: 1 },
        { race_id: 5, race_number: 5, points: 1 },
        { race_id: 6, race_number: 6, points: 1 },
        { race_id: 7, race_number: 7, points: 1 },
        { race_id: 8, race_number: 8, points: 1 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    // A: worst two (10,10) discarded -> kept [1,1,1] = 3.
    // B: worst two (3,3) discarded -> kept [3,3,3] = 9.
    expect(res.totalA).toBe(3);
    expect(res.totalB).toBe(9);
    expect(res.tied).toBe(false);
  });

  it('single-heat event: A8.1 without excluded scores (SHRS 5.7(i))', () => {
    // Both boats raced the same 2 races (single-heat event), tied at 5.
    // A8.1 best-to-worst: A [1,4] vs B [2,3] -> 1 < 2, A wins.
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 4 },
        { race_id: 2, race_number: 2, points: 1 },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 3 },
        { race_id: 2, race_number: 2, points: 2 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.winnerBoatId).toBe('A');
    expect(res.route?.rule).toBe('SHRS 5.7(i)');
  });

  it('multi-heat event where tied pair shared all races: uses excluded scores (SHRS 5.7(ii)(2))', () => {
    // A and B sailed the same races (601-604); C sailed different races, so the
    // EVENT is multi-heat. Kept scores ([1,2,3] each) tie, but A's excluded
    // worst (9) > B's (7), so under 5.7.2.2 (excluded scores used) B wins.
    setupDb({
      A: [
        { race_id: 601, race_number: 1, points: 9 },
        { race_id: 602, race_number: 2, points: 3 },
        { race_id: 603, race_number: 3, points: 2 },
        { race_id: 604, race_number: 4, points: 1 },
      ],
      B: [
        { race_id: 601, race_number: 1, points: 7 },
        { race_id: 602, race_number: 2, points: 1 },
        { race_id: 603, race_number: 3, points: 2 },
        { race_id: 604, race_number: 4, points: 3 },
      ],
      C: [
        { race_id: 701, race_number: 1, points: 1 },
        { race_id: 702, race_number: 2, points: 1 },
        { race_id: 703, race_number: 3, points: 1 },
        { race_id: 704, race_number: 4, points: 2 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.winnerBoatId).toBe('B');
    expect(res.route?.rule).toBe('SHRS 5.7(ii)');
    expect(res.steps.some((s) => s.rule.includes('5.7(ii)(2)'))).toBe(true);
  });

  it('single-heat event confirmed at the EVENT level with 3+ boats sharing the identical race set (detectSingleHeatEvent)', () => {
    // A, B and C all raced the identical two races -> event-level single-heat
    // is true even though a third boat is present. A/B are tied at 5; A8.1
    // best-to-worst: A [1,4] vs B [2,3] -> 1 < 2, A wins.
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 4 },
        { race_id: 2, race_number: 2, points: 1 },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 3 },
        { race_id: 2, race_number: 2, points: 2 },
      ],
      C: [
        { race_id: 1, race_number: 1, points: 1 },
        { race_id: 2, race_number: 2, points: 1 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.route?.rule).toBe('SHRS 5.7(i)');
    expect(res.winnerBoatId).toBe('A');
  });

  // Regression guard (fixed in 7ec1616). SHRS 5.7(ii)(4) / RRS A8.1+A8.2: when
  // neither rule can separate two boats they remain tied. The shared-heat
  // comparator in `calculateBoatScores.ts` (via `compareQualifyingTieCandidates`)
  // returns "still tied" rather than a `localeCompare(boat_id)` order, so
  // `winnerBoatId` is null when every step reports the tie could not be broken.
  it('multi-heat event, tied pair shares every race with identical points: stays tied, no winner (SHRS 5.7(ii))', () => {
    setupDb({
      A: [
        { race_id: 601, race_number: 1, points: 1 },
        { race_id: 602, race_number: 2, points: 2 },
        { race_id: 603, race_number: 3, points: 3 },
        { race_id: 604, race_number: 4, points: 4 },
      ],
      B: [
        { race_id: 601, race_number: 1, points: 1 },
        { race_id: 602, race_number: 2, points: 2 },
        { race_id: 603, race_number: 3, points: 3 },
        { race_id: 604, race_number: 4, points: 4 },
      ],
      // Different race set so the event is multi-heat.
      C: [
        { race_id: 701, race_number: 1, points: 1 },
        { race_id: 702, race_number: 2, points: 1 },
        { race_id: 703, race_number: 3, points: 1 },
        { race_id: 704, race_number: 4, points: 2 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)');
    // Every score matches exactly, so A8.1 and A8.2 both report "still tied"
    // and there is no rule-legal winner.
    expect(res.winnerBoatId).toBeNull();
  });

  it('multi-heat event, no shared races: standard A8 (SHRS 5.7(ii)(4))', () => {
    // A and B never shared a race; C provides a different race set so the event
    // is multi-heat. Tie on kept total (10 each); A8.1 best score 1 vs 1, then
    // second 2 vs 3 -> A wins.
    setupDb({
      A: [
        { race_id: 401, race_number: 1, points: 2 },
        { race_id: 402, race_number: 2, points: 8 },
      ],
      B: [
        { race_id: 501, race_number: 1, points: 3 },
        { race_id: 502, race_number: 2, points: 7 },
      ],
      C: [
        { race_id: 601, race_number: 1, points: 1 },
        { race_id: 602, race_number: 2, points: 1 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)(4)');
    expect(res.winnerBoatId).toBe('A');
  });
});

describe('explainTieBreak — final/overall series', () => {
  it('breaks a combined tie using shared races including excluded scores', () => {
    // Two boats, qualifying + final, tied on combined total. They share races
    // across both series; excluded scores are used (5.7.2.2). A's shared
    // best-to-worst beats B's.
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 1, heat_type: 'Qualifying' },
        { race_id: 2, race_number: 2, points: 4, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
        {
          race_id: 12,
          race_number: 2,
          points: 2,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 2, heat_type: 'Qualifying' },
        { race_id: 2, race_number: 2, points: 3, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 2,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
        {
          race_id: 12,
          race_number: 2,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
    });
    // No discard (4 races -> 1 discard each; configure standard).
    const res = explainTieBreak(1, 'A', 'B', true);
    expect(res.tied).toBe(true);
    expect(['A', 'B']).toContain(res.winnerBoatId);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)');
    // Shared pairs split across both series.
    expect(res.sharedQualRacePairs.length).toBe(2);
    expect(res.sharedRacePairs.length).toBe(2);
  });

  it('falls back to the boat own race count when its final fleet is unknown', () => {
    // RULE-M22 regression: a boat with final Scores rows but no Heat_Boat row
    // for a final heat (a repaired/imported event) has no identifiable fleet.
    // getSeriesDiscardRaceCount must not be called without a heat_name — that
    // drops the fleet filter and returns the largest race count across ALL
    // fleets, and SHRS 4.5 lets fleets sail different numbers of races. Here A
    // sailed 4 final races (1 discard) while B's fleet sailed 8 (2 discards);
    // borrowing B's count would discard a second score from A.
    setupDb({
      A: [
        {
          race_id: 11,
          race_number: 1,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Silver',
        },
        {
          race_id: 12,
          race_number: 2,
          points: 2,
          heat_type: 'Final',
          heat_name: 'Final Silver',
        },
        {
          race_id: 13,
          race_number: 3,
          points: 3,
          heat_type: 'Final',
          heat_name: 'Final Silver',
        },
        {
          race_id: 14,
          race_number: 4,
          points: 9,
          heat_type: 'Final',
          heat_name: 'Final Silver',
        },
      ],
      B: Array.from({ length: 8 }, (_unused, idx) => ({
        race_id: 20 + idx,
        race_number: idx + 1,
        points: 1,
        heat_type: 'Final',
        heat_name: 'Final Gold',
      })),
    });
    boatsWithoutFinalHeatRow.add('A');

    const res = explainTieBreak(1, 'A', 'B', true);

    // 4 races -> 1 discard: the 9 goes, leaving 1 + 2 + 3 = 6. Borrowing the
    // Gold fleet's 8-race count would discard the 3 as well and report 3.
    expect(res.totalA).toBe(6);
  });

  it('multi-heat event, no shared races anywhere: standard A8 fallback (SHRS 5.7(ii)(4))', () => {
    // A and B never sailed the same qualifying or final heat (disjoint
    // race_ids in both series) but are tied on combined total (10 each).
    // A8.1 best-to-worst over the combined (unsorted-input, sorted-by-helper)
    // score set: A [2,8] vs B [3,7] -> 2 < 3, A wins.
    setupDb({
      A: [
        { race_id: 401, race_number: 1, points: 2, heat_type: 'Qualifying' },
        { race_id: 402, race_number: 2, points: 8, heat_type: 'Qualifying' },
      ],
      B: [
        { race_id: 501, race_number: 1, points: 3, heat_type: 'Qualifying' },
        { race_id: 502, race_number: 2, points: 7, heat_type: 'Qualifying' },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', true);
    expect(res.tied).toBe(true);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)(4)');
    expect(res.winnerBoatId).toBe('A');
    expect(res.sharedQualRacePairs.length).toBe(0);
    expect(res.sharedRacePairs.length).toBe(0);
  });

  it('M7: winnerBoatId is decided by the shared FINAL race, not a higher-numbered shared Qualifying race', () => {
    // A and B share one qualifying race (race_number 4) and one final race
    // (race_number 1, but it's the event's actual LAST race since final
    // races are sailed after qualifying and restart numbering at 1).
    // A8.1 ties ([1,5] vs [1,5] for both); the authoritative comparator
    // (compareOverallTiePackets, already fixed for M7) must decide A8.2 by
    // the final race: A=1 vs B=5 -> A wins. This mirrors the
    // HeatRaceHandler.overallTieBreak.test.ts handler-level M7 test, but
    // pins the SAME expectation through the explain panel's `winnerBoatId`.
    setupDb({
      A: [
        { race_id: 1, race_number: 4, points: 5, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
      B: [
        { race_id: 1, race_number: 4, points: 1, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 5,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', true);
    expect(res.tied).toBe(true);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)');
    expect(res.winnerBoatId).toBe('A');
  });

  // Regression guard (fixed in 7ec1616). RRS A8.2 walks the event's last race
  // backward, and final-series races are sailed after the qualifying series but
  // restart their numbering at 1. The narration's `a82PairsDesc` must therefore
  // rank shared Final-series pairs ahead of shared Qualifying pairs (mirroring
  // the `seriesRank` order in overallTieBreak.ts), NOT sort by race_number
  // alone — otherwise a Qualifying race numbered 4 would outrank a Final race
  // numbered 1 and the panel would cite the wrong tie-breaker race.
  it('M7: the A8.2 narration step cites the shared FINAL race as the tie-breaker, not the higher-numbered Qualifying race', () => {
    setupDb({
      A: [
        { race_id: 1, race_number: 4, points: 5, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
      B: [
        { race_id: 1, race_number: 4, points: 1, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 5,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', true);
    const a82Step = res.steps.find((s) => s.comparison?.mode === 'A8.2');
    expect(a82Step?.comparison?.raceId).toBe(11); // the Final race, not race 1 (Qualifying)
    expect(a82Step?.comparison?.scoreA).toBe(1);
    expect(a82Step?.comparison?.scoreB).toBe(5);
  });

  // Regression guard (fixed in 7ec1616). When every shared race is identical the
  // boats stay genuinely tied: `compareOverallTiePackets` returns 0 rather than
  // inventing an order from the internal boat_id, and this panel's `winnerBoatId`
  // reports no winner. Directly observable here because the panel promises never
  // to disagree with the authoritative comparator. See the companion assertion
  // in overallTieBreak.test.ts ("M8: unresolved tie must stay tied").
  it('multi-heat overall tie, every shared race identical: stays tied, no winner (SHRS 5.7(ii))', () => {
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 2, heat_type: 'Qualifying' },
        { race_id: 2, race_number: 2, points: 1, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 2,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
        {
          race_id: 12,
          race_number: 2,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 2, heat_type: 'Qualifying' },
        { race_id: 2, race_number: 2, points: 1, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 2,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
        {
          race_id: 12,
          race_number: 2,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', true);
    expect(res.tied).toBe(true);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)');
    expect(res.winnerBoatId).toBeNull();
  });
});
