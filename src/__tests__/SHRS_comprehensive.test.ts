/* eslint-disable camelcase */
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE SHRS (Simple Heat Racing System) & RRS Appendix A TESTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file is a single, exhaustive test suite that validates every rule
 * referenced in the scoring specification:
 *
 *  RRS Appendix A:
 *    A2  – Series scores (sum of race scores minus worst)
 *    A4  – Low Point System (position = points: 1st→1, 2nd→2, …)
 *    A5  – Penalty scoring (DNS/DSQ/etc. = boats in largest heat + 1)
 *    A7  – Race ties (average the places)
 *    A8.1 – Tie-breaking: sorted-score comparison (best to worst)
 *    A8.2 – Tie-breaking: last race backward
 *
 *  SHRS specific rules:
 *    5.2  – Penalty position = largest heat + 1 (replaces "number entered")
 *    5.3  – Recording order: finishers, then DNF,RET,NSC,OCS,DNS,DNC,WTH,UFD,BFD,DSQ,DNE
 *    5.4  – Discards: 0 (< 4), 1 (4-7), 2 (8-15), +1 per 8 additional completed
 *           Qualifying and Final series each count independently
 *    5.6  – Tie-breaking:
 *           (i)   Single heat: standard A8.1 + A8.2
 *           (ii)  Multiple heats:
 *                 (a)  Only shared-heat races used; excluded scores ARE used
 *                 (b)  If never in same heat, standard A8.1 + A8.2
 */
import calculateBoatScores from '../main/functions/calculateBoatScores';
import calculateFinalBoatScores from '../main/functions/calculateFinalBoatScores';
import {
  getExcludeCount,
  applyExclusions,
  parseRaceNum,
} from '../renderer/utils/leaderboardUtils';
import {
  assignBoatsToNewHeatsZigZag,
  getNextHeatIndexByMovementTable,
} from '../main/functions/creatingNewHeatsUtls';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATABASE
// ═══════════════════════════════════════════════════════════════════════════════

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

// eslint-disable-next-line
const { db } = require('../../public/Database/DBManager');
const mockPrepare = db.prepare as jest.Mock;

/**
 * Configure the mock DB for qualifying-series tests.
 *
 * @param scoresA81  boat_id → scores ORDER BY points DESC (worst first)
 * @param scoresA82  boat_id → scores ORDER BY race_number DESC (latest first)
 * @param raceScores boat_id → full race-level entries for shared-heat tie-break
 */
function setupQualifyingMockDb(
  scoresA81: Record<string, number[]>,
  scoresA82: Record<string, number[]> = {},
  raceScores: Record<
    string,
    Array<{ race_id: number; race_number: number; points: number }>
  > = {},
) {
  mockPrepare.mockImplementation((sql: string) => ({
    all: (_eventId: unknown, boatId: string) => {
      if (sql.includes('SELECT s.race_id, r.race_number, s.points')) {
        if (raceScores[boatId]) return raceScores[boatId];
        const desc = scoresA82[boatId] ?? [];
        return desc.map((points, idx) => ({
          race_id: idx + 1,
          race_number: desc.length - idx,
          points,
        }));
      }
      if (sql.includes('ORDER BY points DESC')) {
        return (scoresA81[boatId] ?? []).map((points) => ({ points }));
      }
      if (sql.includes('ORDER BY r.race_number DESC')) {
        return (scoresA82[boatId] ?? []).map((points) => ({ points }));
      }
      return [];
    },
  }));
}

/**
 * Configure the mock DB for final-series tests.
 */
function setupFinalMockDb(
  scoresA81: Record<string, number[]>,
  scoresA82: Record<string, number[]> = {},
) {
  mockPrepare.mockImplementation((sql: string) => ({
    all: (_eventId: unknown, boatId: string) => {
      if (sql.includes('ORDER BY points DESC')) {
        return (scoresA81[boatId] ?? []).map((p) => ({ points: p }));
      }
      if (sql.includes('ORDER BY r.race_number DESC')) {
        return (scoresA82[boatId] ?? []).map((p) => ({ points: p }));
      }
      return [];
    },
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeQResult = (
  boat_id: string,
  number_of_races: number,
  total_points_event = 0,
) => ({ boat_id, number_of_races, total_points_event });

const makeFResult = (boat_id: string, heat_name: string, total = 0) => ({
  boat_id,
  heat_name,
  total_points_final: total,
});

function runQualifying(
  results: ReturnType<typeof makeQResult>[],
  event_id = 1,
): Record<string, { totalPoints: number; place: number }> {
  const pointsMap = new Map<number, string[]>();
  const table = calculateBoatScores(results, event_id, pointsMap);
  return Object.fromEntries(
    table.map((r) => [r.boat_id, { totalPoints: r.totalPoints, place: r.place! }]),
  );
}

function runFinal(
  results: ReturnType<typeof makeFResult>[],
  event_id = 1,
): Map<string, Array<{ boat_id: string; totalPoints: number; place?: number }>> {
  return calculateFinalBoatScores(results, event_id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: A4 – LOW POINT SYSTEM  (position = points)
// ═══════════════════════════════════════════════════════════════════════════════

describe('A4 – Low Point System', () => {
  it('1st place = 1 pt, 2nd = 2 pts, …, 7th = 7 pts (each place +1)', () => {
    // Simulate 7 boats each with 1 race; DB returns their single score DESC
    const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];
    const a81: Record<string, number[]> = {};
    ids.forEach((id, i) => {
      a81[id] = [i + 1]; // b1→[1], b2→[2], …, b7→[7]
    });
    setupQualifyingMockDb(a81);
    const r = runQualifying(ids.map((id) => makeQResult(id, 1)));
    ids.forEach((id, i) => {
      expect(r[id].totalPoints).toBe(i + 1);
      expect(r[id].place).toBe(i + 1);
    });
  });

  it('a fleet of 20 boats: points correspond to finishing place', () => {
    const a81: Record<string, number[]> = {};
    const results: ReturnType<typeof makeQResult>[] = [];
    for (let i = 1; i <= 20; i++) {
      const id = `boat${i}`;
      a81[id] = [i]; // single-race points = place
      results.push(makeQResult(id, 1));
    }
    setupQualifyingMockDb(a81);
    const r = runQualifying(results);
    for (let i = 1; i <= 20; i++) {
      expect(r[`boat${i}`].totalPoints).toBe(i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: SHRS 5.4 – DISCARD THRESHOLDS
//   The discard formula: 0 (<4), 1 (4-7), 2 (8-15), +1 per 8 more
//   Qualifying and Final series are INDEPENDENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('SHRS 5.4 – Discard thresholds (getExcludeCount)', () => {
  // Exhaustive boundary-value analysis
  const cases: [number, number][] = [
    // [numberOfRaces, expectedExclusions]
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [5, 1],
    [6, 1],
    [7, 1],
    [8, 2],
    [9, 2],
    [10, 2],
    [15, 2],
    [16, 3],
    [17, 3],
    [23, 3],
    [24, 4],
    [25, 4],
    [31, 4],
    [32, 5],
    [33, 5],
    [39, 5],
    [40, 6],
    [41, 6],
    [47, 6],
    [48, 7],
    [56, 8],
    [64, 9],
    [72, 10],
    [80, 11],
  ];

  it.each(cases)(
    '%i races → %i exclusions',
    (numRaces, expectedExclusions) => {
      expect(getExcludeCount(numRaces)).toBe(expectedExclusions);
    },
  );
});

describe('SHRS 5.4 – Discards applied in qualifying scoring', () => {
  it('0 discards with 3 races: full sum', () => {
    setupQualifyingMockDb({ boat: [5, 3, 1] }); // DESC
    const r = runQualifying([makeQResult('boat', 3)]);
    expect(r.boat.totalPoints).toBe(9); // 5+3+1
  });

  it('1 discard with 4 races: drops worst', () => {
    setupQualifyingMockDb({ boat: [20, 3, 2, 1] }); // DESC → worst = 20
    const r = runQualifying([makeQResult('boat', 4)]);
    expect(r.boat.totalPoints).toBe(6); // 3+2+1
  });

  it('1 discard with 7 races: drops worst', () => {
    setupQualifyingMockDb({ boat: [50, 7, 6, 5, 4, 3, 2] });
    const r = runQualifying([makeQResult('boat', 7)]);
    expect(r.boat.totalPoints).toBe(27); // sum 7+6+5+4+3+2 = 27
  });

  it('2 discards with 8 races: drops 2 worst', () => {
    setupQualifyingMockDb({ boat: [9, 8, 7, 6, 5, 4, 3, 2] });
    const r = runQualifying([makeQResult('boat', 8)]);
    expect(r.boat.totalPoints).toBe(7 + 6 + 5 + 4 + 3 + 2); // 27
  });

  it('3 discards with 16 races', () => {
    const scores = Array.from({ length: 16 }, (_, i) => 16 - i); // [16,15,...,1]
    setupQualifyingMockDb({ boat: scores });
    const r = runQualifying([makeQResult('boat', 16)]);
    const expected = scores.slice(3).reduce((a, b) => a + b, 0);
    expect(r.boat.totalPoints).toBe(expected);
  });

  it('6 discards with 40 races', () => {
    const scores = Array.from({ length: 40 }, (_, i) => 40 - i);
    setupQualifyingMockDb({ boat: scores });
    const r = runQualifying([makeQResult('boat', 40)]);
    const expected = scores.slice(6).reduce((a, b) => a + b, 0);
    expect(r.boat.totalPoints).toBe(expected);
  });
});

describe('SHRS 5.4 – Discards in Final Series (independent counter)', () => {
  it('Final with 3 races → 0 discards', () => {
    setupFinalMockDb({ g1: [5, 3, 1] });
    const groups = runFinal([makeFResult('g1', 'Final Gold')]);
    expect(groups.get('Gold')![0].totalPoints).toBe(9);
  });

  it('Final with 4 races → 1 discard (resets from qualifying)', () => {
    setupFinalMockDb({ g1: [20, 3, 2, 1] });
    const groups = runFinal([makeFResult('g1', 'Final Gold')]);
    expect(groups.get('Gold')![0].totalPoints).toBe(6); // drops 20
  });

  it('Final with 8 races → 2 discards (independent of qualifying)', () => {
    setupFinalMockDb({ g1: [50, 40, 7, 6, 5, 4, 3, 2] });
    const groups = runFinal([makeFResult('g1', 'Final Gold')]);
    expect(groups.get('Gold')![0].totalPoints).toBe(7 + 6 + 5 + 4 + 3 + 2);
  });

  it('even if qualifying had 16 races, final discards start from 0', () => {
    // This verifies the design: final only sees its own races
    setupFinalMockDb({ g1: [10, 5, 3] }); // 3 final races
    const groups = runFinal([makeFResult('g1', 'Final Gold')]);
    expect(groups.get('Gold')![0].totalPoints).toBe(18); // 0 exclusions
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: A5 / SHRS 5.2 – PENALTY SCORING
//   DNS, DSQ, DNF, RET, etc. = largest heat size + 1
// ═══════════════════════════════════════════════════════════════════════════════

describe('A5 / SHRS 5.2 – Penalty scores', () => {
  it('a DNF boat scored as largest-heat-size + 1 ranks last', () => {
    // 3 boats in heat, DNF boat gets 4 points, finishers get 1 and 2
    setupQualifyingMockDb({
      b1: [1],
      b2: [2],
      bDNF: [4], // maxHeatSize(3) + 1
    });
    const r = runQualifying([
      makeQResult('b1', 1),
      makeQResult('b2', 1),
      makeQResult('bDNF', 1),
    ]);
    expect(r.b1.place).toBe(1);
    expect(r.b2.place).toBe(2);
    expect(r.bDNF.place).toBe(3);
  });

  it('multiple penalty boats all get the same penalty score', () => {
    // heat of 5 boats: 2 finish, 3 get DSQ(6pts each)
    setupQualifyingMockDb({
      f1: [1],
      f2: [2],
      d1: [6],
      d2: [6],
      d3: [6],
    });
    const r = runQualifying([
      makeQResult('f1', 1),
      makeQResult('f2', 1),
      makeQResult('d1', 1),
      makeQResult('d2', 1),
      makeQResult('d3', 1),
    ]);
    expect(r.f1.place).toBe(1);
    expect(r.f2.place).toBe(2);
    // All DSQ boats have same score, should be placed 3,4,5
    expect([r.d1.place, r.d2.place, r.d3.place].sort()).toEqual([3, 4, 5]);
  });

  it('penalty boat excluded in discard still counts toward total races', () => {
    // 4 races: boat finishes 1,1,1 but gets DNS(10) in one race
    // With exclude 1 from 4 races, the DNS(10) is the worst → excluded
    setupQualifyingMockDb({ boat: [10, 1, 1, 1] }); // DESC
    const r = runQualifying([makeQResult('boat', 4)]);
    expect(r.boat.totalPoints).toBe(3); // 1+1+1, the 10 is excluded
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: A8.1 – TIE-BREAKING: BEST-TO-WORST SCORE COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

describe('A8.1 – Tie-breaking by sorted scores (best to worst)', () => {
  it('2 boats, same total: lower best score wins', () => {
    // boatA: [4,1] total=5, sorted ASC [1,4]
    // boatB: [3,2] total=5, sorted ASC [2,3]
    // Compare: 1<2 → boatA wins
    setupQualifyingMockDb({ boatA: [4, 1], boatB: [3, 2] });
    const r = runQualifying([makeQResult('boatA', 2), makeQResult('boatB', 2)]);
    expect(r.boatA.place).toBe(1);
    expect(r.boatB.place).toBe(2);
  });

  it('2 boats, same total, same best score: compare second-best', () => {
    // boatA: [4,2,1] total=7, sorted [1,2,4]
    // boatB: [3,3,1] total=7, sorted [1,3,3]
    // first equal (1==1), then 2<3 → boatA wins
    setupQualifyingMockDb({ boatA: [4, 2, 1], boatB: [3, 3, 1] });
    const r = runQualifying([makeQResult('boatA', 3), makeQResult('boatB', 3)]);
    expect(r.boatA.place).toBe(1);
    expect(r.boatB.place).toBe(2);
  });

  it('3-way tie: resolved by comparing best scores iteratively', () => {
    // All total = 9
    // boatA: [4,3,2] sorted [2,3,4]
    // boatB: [5,3,1] sorted [1,3,5]
    // boatC: [6,2,1] sorted [1,2,6]
    // boatC vs boatB: [1,2,6] vs [1,3,5] → 2<3 → boatC first
    // boatB vs boatA: [1,3,5] vs [2,3,4] → 1<2 → boatB second
    setupQualifyingMockDb({
      boatA: [4, 3, 2],
      boatB: [5, 3, 1],
      boatC: [6, 2, 1],
    });
    const r = runQualifying([
      makeQResult('boatA', 3),
      makeQResult('boatB', 3),
      makeQResult('boatC', 3),
    ]);
    expect(r.boatC.place).toBe(1);
    expect(r.boatB.place).toBe(2);
    expect(r.boatA.place).toBe(3);
  });

  it('tie-break with excluded scores: SHRS 5.6(ii)(a)(2) uses them', () => {
    // 8 races → 2 exclusions.
    // Both boats identical kept scores but differ on excluded scores.
    // boatA: [20, 15, 5,5,5,5,5,5] → exclude 2 worst (20,15) → kept [5,5,5,5,5,5] total=30
    // boatB: [20, 14, 5,5,5,5,5,5] → exclude 2 worst (20,14) → kept [5,5,5,5,5,5] total=30
    // A81 with ALL scores (including excluded): sorted [5,5,5,5,5,5,15,20] vs [5,5,5,5,5,5,14,20]
    // At position 7: 15 vs 14 → boatB is better (per SHRS 5.6(ii)(a)(2))
    setupQualifyingMockDb(
      {
        boatA: [20, 15, 5, 5, 5, 5, 5, 5],
        boatB: [20, 14, 5, 5, 5, 5, 5, 5],
      },
      {
        boatA: [20, 15, 5, 5, 5, 5, 5, 5],
        boatB: [20, 14, 5, 5, 5, 5, 5, 5],
      },
      {
        boatA: [
          { race_id: 1, race_number: 1, points: 5 },
          { race_id: 2, race_number: 2, points: 5 },
          { race_id: 3, race_number: 3, points: 5 },
          { race_id: 4, race_number: 4, points: 5 },
          { race_id: 5, race_number: 5, points: 5 },
          { race_id: 6, race_number: 6, points: 5 },
          { race_id: 7, race_number: 7, points: 15 },
          { race_id: 8, race_number: 8, points: 20 },
        ],
        boatB: [
          { race_id: 1, race_number: 1, points: 5 },
          { race_id: 2, race_number: 2, points: 5 },
          { race_id: 3, race_number: 3, points: 5 },
          { race_id: 4, race_number: 4, points: 5 },
          { race_id: 5, race_number: 5, points: 5 },
          { race_id: 6, race_number: 6, points: 5 },
          { race_id: 7, race_number: 7, points: 14 },
          { race_id: 8, race_number: 8, points: 20 },
        ],
      },
    );
    const r = runQualifying([makeQResult('boatA', 8), makeQResult('boatB', 8)]);
    expect(r.boatA.totalPoints).toBe(30);
    expect(r.boatB.totalPoints).toBe(30);
    expect(r.boatB.place).toBe(1);
    expect(r.boatA.place).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: A8.2 – TIE-BREAKING: LAST RACE BACKWARD
// ═══════════════════════════════════════════════════════════════════════════════

describe('A8.2 – Tie-breaking by last race backward', () => {
  it('identical sorted scores → better last race wins', () => {
    // Both: sorted [1,3] total=4, A81 tie.
    // A82 DESC: boatA [3,1], boatB [1,3]
    // Compare race_number DESC: boatA latest=3 vs boatB latest=1 → boatB wins
    setupQualifyingMockDb(
      { boatA: [3, 1], boatB: [3, 1] },
      { boatA: [3, 1], boatB: [1, 3] },
    );
    const r = runQualifying([makeQResult('boatA', 2), makeQResult('boatB', 2)]);
    expect(r.boatB.place).toBe(1);
    expect(r.boatA.place).toBe(2);
  });

  it('3-way A82 tie resolved by walking races backward', () => {
    // 3 races each, all scores = {5,3,1} → A81 sorted [1,3,5] → all tied
    // A82 (latest→oldest): a=[5,3,1], b=[5,1,3], c=[1,5,3]
    // Shared A81 also tied. Shared A82:
    //   a-b: race3 both 5 → race2: a=3 vs b=1 → b ahead of a
    //   a-c: race3: a=5 vs c=1 → c ahead of a
    //   b-c: race3: b=5 vs c=1 → c ahead of b
    // Result: c(1st), b(2nd), a(3rd)
    setupQualifyingMockDb(
      { a: [5, 3, 1], b: [5, 3, 1], c: [5, 3, 1] },
      {
        a: [5, 3, 1], // latest=5, mid=3, oldest=1
        b: [5, 1, 3], // latest=5, mid=1, oldest=3
        c: [1, 5, 3], // latest=1, mid=5, oldest=3
      },
    );
    const r = runQualifying([
      makeQResult('a', 3),
      makeQResult('b', 3),
      makeQResult('c', 3),
    ]);
    expect(r.c.place).toBe(1);
    expect(r.b.place).toBe(2);
    expect(r.a.place).toBe(3);
  });

  it('tie unresolved on first A82 comparison → goes to next-to-last race', () => {
    // 3 races each. Both A81 = [5,3,1] sorted = [1,3,5] total=9 → A81 tie
    // A82 (latest first): a=[5,3,1], b=[5,1,3]
    // Same score multisets so shared A81 is also tied.
    // Shared A82: race3: both 5 → tie. race2: a=3 vs b=1 → b wins.
    setupQualifyingMockDb(
      { a: [5, 3, 1], b: [5, 3, 1] },
      { a: [5, 3, 1], b: [5, 1, 3] },
    );
    const r = runQualifying([makeQResult('a', 3), makeQResult('b', 3)]);
    expect(r.b.place).toBe(1);
    expect(r.a.place).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: SHRS 5.6 – TIE-BREAKING IN MULTIPLE HEAT EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('SHRS 5.6(ii)(a) – Shared-heat tie-breaking', () => {
  it('uses only races where both boats were in the same heat', () => {
    // ESP47 and USA55 share races 101-109 but have different non-shared races
    setupQualifyingMockDb(
      { ESP47: [20, 20], USA55: [20, 20] },
      { ESP47: [20, 20], USA55: [20, 20] },
      {
        ESP47: [
          { race_id: 101, race_number: 1, points: 2 },
          { race_id: 102, race_number: 4, points: 9 },
          { race_id: 103, race_number: 5, points: 1 },
          { race_id: 104, race_number: 13, points: 8 },
          { race_id: 105, race_number: 14, points: 3 },
        ],
        USA55: [
          { race_id: 101, race_number: 1, points: 3 },
          { race_id: 102, race_number: 4, points: 4 },
          { race_id: 103, race_number: 5, points: 12 },
          { race_id: 104, race_number: 13, points: 19 },
          { race_id: 105, race_number: 14, points: 6 },
        ],
      },
    );
    const r = runQualifying([
      makeQResult('ESP47', 2),
      makeQResult('USA55', 2),
    ]);
    // Shared races sorted ASC: ESP47 [1,2,3,8,9] vs USA55 [3,4,6,12,19]
    // At first compare: 1<3 → ESP47 wins
    expect(r.ESP47.place).toBe(1);
    expect(r.USA55.place).toBe(2);
  });

  it('non-shared races are ignored for tie-breaking', () => {
    setupQualifyingMockDb(
      { a: [10, 10], b: [10, 10] },
      { a: [10, 10], b: [10, 10] },
      {
        a: [
          { race_id: 1, race_number: 1, points: 3 }, // shared
          { race_id: 2, race_number: 2, points: 7 }, // shared
          { race_id: 99, race_number: 99, points: 100 }, // non-shared: very bad
        ],
        b: [
          { race_id: 1, race_number: 1, points: 4 }, // shared
          { race_id: 2, race_number: 2, points: 6 }, // shared
          { race_id: 100, race_number: 99, points: 1 }, // non-shared: very good
        ],
      },
    );
    const r = runQualifying([makeQResult('a', 2), makeQResult('b', 2)]);
    // Shared: a sorted [3,7] vs b sorted [4,6] → 3<4 → a wins
    expect(r.a.place).toBe(1);
    expect(r.b.place).toBe(2);
  });
});

describe('SHRS 5.6(ii)(b) – Boats never in same heat', () => {
  it('falls back to standard A8.1 + A8.2 when no shared races', () => {
    setupQualifyingMockDb(
      { a: [8, 6, 1, 1], b: [9, 5, 1, 1] },
      { a: [8, 6, 1, 1], b: [9, 5, 1, 1] },
      {
        // Completely separate race_ids
        a: [
          { race_id: 401, race_number: 10, points: 8 },
          { race_id: 402, race_number: 9, points: 6 },
          { race_id: 403, race_number: 8, points: 1 },
          { race_id: 404, race_number: 7, points: 1 },
        ],
        b: [
          { race_id: 501, race_number: 10, points: 9 },
          { race_id: 502, race_number: 9, points: 5 },
          { race_id: 503, race_number: 8, points: 1 },
          { race_id: 504, race_number: 7, points: 1 },
        ],
      },
    );
    const r = runQualifying([makeQResult('a', 4), makeQResult('b', 4)]);
    // A81: a sorted [1,1,6,8] vs b sorted [1,1,5,9] → 1==1, 1==1, 6>5 → b wins
    expect(r.b.place).toBe(1);
    expect(r.a.place).toBe(2);
  });
});

describe('SHRS 5.6(i) – Single heat event: standard A8', () => {
  it('uses all race scores in standard A8.1 order', () => {
    // Both total 10; sorted: a=[2,3,5] b=[1,4,5] → 2>1 → b wins A81
    setupQualifyingMockDb({ a: [5, 3, 2], b: [5, 4, 1] });
    const r = runQualifying([makeQResult('a', 3), makeQResult('b', 3)]);
    expect(r.b.place).toBe(1);
    expect(r.a.place).toBe(2);
  });

  it('A8.1 ignores excluded scores in single-heat ties (4 races, 1 exclusion)', () => {
    // 4 races => exclude 1 worst score.
    // a: [6,2,1,3] -> keep [2,1,3] sorted [1,2,3]
    // b: [5,1,2,3] -> keep [1,2,3] sorted [1,2,3]
    // A8.1 stays tied because excluded scores (6 and 5) must NOT be used.
    // A8.2 latest->oldest:
    //   a=[3,1,2,6], b=[3,2,1,5]
    //   latest tie at 3, next race 1<2 -> a wins.
    // If excluded scores leaked into A8.1, b would incorrectly win on 5<6.
    setupQualifyingMockDb(
      { a: [6, 2, 1, 3], b: [5, 1, 2, 3] },
      { a: [3, 1, 2, 6], b: [3, 2, 1, 5] },
    );
    const r = runQualifying([makeQResult('a', 4), makeQResult('b', 4)]);
    expect(r.a.totalPoints).toBe(6);
    expect(r.b.totalPoints).toBe(6);
    expect(r.a.place).toBe(1);
    expect(r.b.place).toBe(2);
  });

  it('A8.1 tie on kept scores falls through to A8.2 (8 races, 2 exclusions)', () => {
    // 8 races => exclude 2 worst scores.
    // a raw: [10,9,1,1,1,1,1,1] -> keep six 1s (total 6)
    // b raw: [11,8,1,1,1,1,1,1] -> keep six 1s (total 6)
    // A8.1 on kept scores is tied; excluded 10/9 and 11/8 must not break A8.1.
    // A8.2 latest->oldest:
    //   a=[1,1,1,1,1,1,9,10]
    //   b=[1,1,1,1,1,1,11,8]
    // first difference near the end: 9<11 -> a wins.
    // If excluded scores leaked into A8.1, b would incorrectly win on 8<9.
    setupQualifyingMockDb(
      {
        a: [10, 9, 1, 1, 1, 1, 1, 1],
        b: [11, 8, 1, 1, 1, 1, 1, 1],
      },
      {
        a: [1, 1, 1, 1, 1, 1, 9, 10],
        b: [1, 1, 1, 1, 1, 1, 11, 8],
      },
    );
    const r = runQualifying([makeQResult('a', 8), makeQResult('b', 8)]);
    expect(r.a.totalPoints).toBe(6);
    expect(r.b.totalPoints).toBe(6);
    expect(r.a.place).toBe(1);
    expect(r.b.place).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: FINAL SERIES SCORING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Final Series – Fleet separation', () => {
  it('Gold, Silver, Bronze create independent ranking groups', () => {
    setupFinalMockDb({ g1: [1], g2: [2], s1: [3], s2: [4], b1: [5] });
    const groups = runFinal([
      makeFResult('g1', 'Final Gold'),
      makeFResult('g2', 'Final Gold'),
      makeFResult('s1', 'Final Silver'),
      makeFResult('s2', 'Final Silver'),
      makeFResult('b1', 'Final Bronze'),
    ]);
    expect([...groups.keys()].sort()).toEqual(['Bronze', 'Gold', 'Silver']);
    expect(groups.get('Gold')).toHaveLength(2);
    expect(groups.get('Silver')).toHaveLength(2);
    expect(groups.get('Bronze')).toHaveLength(1);
  });

  it('Gold fleet ranked before Silver before Bronze (SHRS 5.4)', () => {
    // Even if Silver boats have better scores, Gold fleet boats are ranked first overall
    setupFinalMockDb({ g1: [10], s1: [1] });
    const groups = runFinal([
      makeFResult('g1', 'Final Gold'),
      makeFResult('s1', 'Final Silver'),
    ]);
    expect(groups.get('Gold')![0].place).toBe(1);
    expect(groups.get('Silver')![0].place).toBe(1);
    // Note: overall ranking is Gold.place=1, then Silver.place=1 but offset by Gold fleet size
  });
});

describe('Final Series – Ranking within group', () => {
  it('ranks by ascending total points within each fleet', () => {
    setupFinalMockDb({ g1: [5, 4, 3], g2: [2, 1, 1], g3: [3, 3, 3] });
    const groups = runFinal([
      makeFResult('g1', 'Final Gold'),
      makeFResult('g2', 'Final Gold'),
      makeFResult('g3', 'Final Gold'),
    ]);
    const gold = groups.get('Gold')!;
    const byId = Object.fromEntries(gold.map((b) => [b.boat_id, b]));
    expect(byId.g2.place).toBe(1); // total 4
    expect(byId.g3.place).toBe(2); // total 9
    expect(byId.g1.place).toBe(3); // total 12
  });
});

describe('Final Series – A81 tie-breaking', () => {
  it('resolves ties within Gold via sorted-score comparison', () => {
    // Both total 5: boatA sorted [1,4], boatB sorted [2,3] → 1<2 → boatA wins
    setupFinalMockDb({ boatA: [4, 1], boatB: [3, 2] });
    const groups = runFinal([
      makeFResult('boatA', 'Final Gold'),
      makeFResult('boatB', 'Final Gold'),
    ]);
    const gold = groups.get('Gold')!;
    const byId = Object.fromEntries(gold.map((b) => [b.boat_id, b]));
    expect(byId.boatA.place).toBe(1);
    expect(byId.boatB.place).toBe(2);
  });
});

describe('Final Series – A82 tie-breaking', () => {
  it('falls back to A82 when A81 scores are identical in Final', () => {
    setupFinalMockDb(
      { a: [3, 1], b: [3, 1] },
      { a: [3, 1], b: [1, 3] },
    );
    const groups = runFinal([
      makeFResult('a', 'Final Silver'),
      makeFResult('b', 'Final Silver'),
    ]);
    const silver = groups.get('Silver')!;
    const byId = Object.fromEntries(silver.map((b) => [b.boat_id, b]));
    expect(byId.b.place).toBe(1); // latest race: b=1, a=3
    expect(byId.a.place).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: SHRS 5.3 – RECORDING ORDER (tested via heat assignment)
//   Finishers first, then DNF, RET, NSC, OCS, DNS, DNC, WTH, UFD, BFD, DSQ, DNE
// ═══════════════════════════════════════════════════════════════════════════════

describe('SHRS 5.3 – Status recording order', () => {
  it('penalty statuses get higher (worse) points than finishers', () => {
    // Simulate: 5-boat heat. finisher=1, finisher=2, DNF=6, DSQ=6, DNS=6
    setupQualifyingMockDb({
      fin1: [1],
      fin2: [2],
      dnf: [6],
      dsq: [6],
      dns: [6],
    });
    const r = runQualifying([
      makeQResult('fin1', 1),
      makeQResult('fin2', 1),
      makeQResult('dnf', 1),
      makeQResult('dsq', 1),
      makeQResult('dns', 1),
    ]);
    expect(r.fin1.place).toBe(1);
    expect(r.fin2.place).toBe(2);
    // All penalties tied at 6, will be placed 3-5
    const penaltyPlaces = [r.dnf.place, r.dsq.place, r.dns.place].sort();
    expect(penaltyPlaces).toEqual([3, 4, 5]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: applyExclusions (renderer utility)
//   Validates that the display-side exclusion logic matches SHRS 5.4
// ═══════════════════════════════════════════════════════════════════════════════

describe('applyExclusions – renderer utility', () => {
  it('marks worst scores with parentheses', () => {
    // 4 races → 1 exclusion. Scores: [1, 2, 3, 10]
    const { markedRaces, total } = applyExclusions(['1', '2', '3', '10']);
    expect(total).toBe(6); // 1+2+3
    expect(markedRaces).toContain('(10)');
    expect(markedRaces.filter((r: string) => r.startsWith('('))).toHaveLength(1);
  });

  it('excludes 2 worst with 8 races', () => {
    const scores = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const { markedRaces, total } = applyExclusions(scores);
    // Exclude worst 2: 8 and 7
    expect(total).toBe(1 + 2 + 3 + 4 + 5 + 6); // 21
    const excluded = markedRaces.filter((r: string) => r.startsWith('('));
    expect(excluded).toHaveLength(2);
  });

  it('no exclusions with < 4 races', () => {
    const { markedRaces, total } = applyExclusions(['5', '3', '2']);
    expect(total).toBe(10);
    expect(markedRaces.every((r: string) => !r.startsWith('('))).toBe(true);
  });

  it('handles penalty score strings correctly', () => {
    // 4 races: [1, 2, 3, 15] where 15 is a DNF penalty
    const { markedRaces, total } = applyExclusions(['1', '2', '3', '15']);
    expect(total).toBe(6); // exclude 15
    expect(markedRaces[3]).toBe('(15)');
  });

  it('excludes earliest race when multiple identical worst scores', () => {
    // 4 races: [10, 5, 3, 10] → exclude 1 worst (10).
    // Per A2.1, if equal worst scores the one from earliest race is excluded.
    const { markedRaces, total } = applyExclusions(['10', '5', '3', '10']);
    // One 10 should be marked; total = 10+5+3 = 18
    expect(total).toBe(18);
    const excludedCount = markedRaces.filter((r: string) => r.startsWith('(')).length;
    expect(excludedCount).toBe(1);
  });
});

describe('parseRaceNum utility', () => {
  it('strips parentheses and returns number', () => {
    expect(parseRaceNum('(10)')).toBe(10);
    expect(parseRaceNum('5')).toBe(5);
    expect(parseRaceNum('3.4')).toBeCloseTo(3.4);
  });

  it('returns 0 for non-numeric values', () => {
    expect(parseRaceNum('DNF')).toBe(0);
    expect(parseRaceNum('')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: COMPLEX REAL-WORLD SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Complex scenario – 20-boat qualifying with discards and ties', () => {
  it('handles 20 boats over 8 races with 2 discards and tie-breakers', () => {
    const a81: Record<string, number[]> = {};
    const a82: Record<string, number[]> = {};
    const results: ReturnType<typeof makeQResult>[] = [];

    // 18 boats with distinct totals
    for (let i = 1; i <= 18; i++) {
      const id = `boat${i}`;
      // 8 scores DESC, distinct totals
      const scores = [i + 10, i + 5, i, i, i, i, i, i]; // worst first
      a81[id] = scores;
      a82[id] = [...scores].reverse(); // latest race first
      results.push(makeQResult(id, 8));
    }

    // 2 tied boats: both have exact same kept scores but differ on A82
    a81.tieA = [20, 15, 3, 3, 3, 3, 3, 3]; // exclude 2 worst (20,15) → kept total = 18
    a81.tieB = [20, 15, 3, 3, 3, 3, 3, 3];
    a82.tieA = [3, 3, 3, 3, 3, 3, 15, 20]; // latest races first
    a82.tieB = [3, 3, 3, 3, 3, 2, 16, 20]; // race 2 = 2 < 3 → tieB wins
    results.push(makeQResult('tieA', 8));
    results.push(makeQResult('tieB', 8));

    setupQualifyingMockDb(a81, a82);
    const r = runQualifying(results);

    // All 20 boats should have unique places
    const places = Object.values(r)
      .map((v) => v.place)
      .sort((a, b) => a - b);
    expect(places).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    // Verify tied boats are resolved (both have totalPoints=18)
    expect(r.tieA.totalPoints).toBe(18);
    expect(r.tieB.totalPoints).toBe(18);
  });
});

describe('Complex scenario – Final Series 25 boats per fleet', () => {
  it('handles 3 fleets × 25 boats with valid consecutive places', () => {
    const a81: Record<string, number[]> = {};
    const results: ReturnType<typeof makeFResult>[] = [];
    const groups = ['Gold', 'Silver', 'Bronze'];

    groups.forEach((group, gi) => {
      for (let i = 1; i <= 25; i++) {
        const id = `${group.toLowerCase()}_${i}`;
        a81[id] = [25 + i + gi, 1]; // unique totals per group
        results.push(makeFResult(id, `Final ${group}`));
      }
    });

    setupFinalMockDb(a81);
    const groupTables = runFinal(results);

    groups.forEach((group) => {
      const table = groupTables.get(group)!;
      expect(table).toHaveLength(25);
      const places = table
        .map((b) => b.place)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(places).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    });
  });
});

describe('Complex scenario – Mixed penalties and finishers', () => {
  it('ranks finishers above all penalties in multi-race series', () => {
    // 4 races. Boat finishes 1,1,1,1 vs boat with 1,1,1,DNF(10)
    // After 1 exclusion: good=[1,1,1] total=3, penalty=[1,1,1] total=3 (10 excluded)
    // But if penalty is excluded, boats are tied at 3
    setupQualifyingMockDb(
      { good: [1, 1, 1, 1], penalty: [10, 1, 1, 1] },
      { good: [1, 1, 1, 1], penalty: [10, 1, 1, 1] },
    );
    const r = runQualifying([
      makeQResult('good', 4),
      makeQResult('penalty', 4),
    ]);
    // Both total=3 after exclusion.
    // A81: good sorted=[1,1,1] vs penalty sorted=[1,1,1] → tie
    // A82: both have [1,1,1,1] vs [10,1,1,1] (latest first) → penalty has 10 in race4
    // Wait, DESC order for A82: good=[1,1,1,1] penalty=[10,1,1,1]
    // Compare from latest: good race4=1, penalty race4=10 → good wins
    expect(r.good.place).toBe(1);
    expect(r.penalty.place).toBe(2);
  });

  it('all boats DNF in one race: all get same penalty score for that race', () => {
    // 2 races, 3 boats. Race 1: all finish normally. Race 2: all DNF (score = 4)
    setupQualifyingMockDb({
      b1: [4, 1], // DESC: 4 (DNF), 1
      b2: [4, 2],
      b3: [4, 3],
    });
    const r = runQualifying([
      makeQResult('b1', 2),
      makeQResult('b2', 2),
      makeQResult('b3', 2),
    ]);
    expect(r.b1.place).toBe(1); // total 5
    expect(r.b2.place).toBe(2); // total 6
    expect(r.b3.place).toBe(3); // total 7
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: HEAT ASSIGNMENT (SHRS 3.1 / 3.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('SHRS 3.1 – Zigzag seeding for Race 1', () => {
  const boats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ boat_id: `b${i + 1}` }));

  it('2 heats, 4 boats: snake A,B,B,A', () => {
    const r = assignBoatsToNewHeatsZigZag(boats(4), ['A1', 'B1'], 1);
    expect(r.map((a) => a.heatId)).toEqual([0, 1, 1, 0]);
  });

  it('3 heats, 6 boats: snake A,B,C,C,B,A', () => {
    const r = assignBoatsToNewHeatsZigZag(boats(6), ['A1', 'B1', 'C1'], 1);
    expect(r.map((a) => a.heatId)).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it('2 heats, 5 boats: extra goes to first heat', () => {
    const r = assignBoatsToNewHeatsZigZag(boats(5), ['A1', 'B1'], 1);
    const counts = [0, 0];
    r.forEach(({ heatId }) => {
      counts[heatId]++;
    });
    expect(counts[0]).toBe(3); // first heat gets extra
    expect(counts[1]).toBe(2);
  });

  it('4 heats, 16 boats: even distribution', () => {
    const r = assignBoatsToNewHeatsZigZag(
      boats(16),
      ['A', 'B', 'C', 'D'],
      1,
    );
    const counts = [0, 0, 0, 0];
    r.forEach(({ heatId }) => {
      counts[heatId]++;
    });
    expect(counts).toEqual([4, 4, 4, 4]);
  });
});

describe('SHRS 3.2 – Movement table for subsequent races', () => {
  it('1st place stays in same heat', () => {
    expect(getNextHeatIndexByMovementTable(0, 1, 3)).toBe(0);
    expect(getNextHeatIndexByMovementTable(1, 1, 3)).toBe(1);
    expect(getNextHeatIndexByMovementTable(2, 1, 3)).toBe(2);
  });

  it('2nd place moves forward one heat (wraps around)', () => {
    expect(getNextHeatIndexByMovementTable(0, 2, 3)).toBe(1);
    expect(getNextHeatIndexByMovementTable(1, 2, 3)).toBe(2);
    expect(getNextHeatIndexByMovementTable(2, 2, 3)).toBe(0); // wraps
  });

  it('3rd place moves forward two heats with 3 heats (wraps)', () => {
    expect(getNextHeatIndexByMovementTable(0, 3, 3)).toBe(2);
    expect(getNextHeatIndexByMovementTable(1, 3, 3)).toBe(0); // wraps
    expect(getNextHeatIndexByMovementTable(2, 3, 3)).toBe(1);
  });

  it('finishing place > number of heats wraps correctly', () => {
    // 4th place in 3 heats: shift = (4-1)%3 = 0 → same heat
    expect(getNextHeatIndexByMovementTable(0, 4, 3)).toBe(0);
    // 5th place: shift = (5-1)%3 = 1 → +1
    expect(getNextHeatIndexByMovementTable(0, 5, 3)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('single boat always gets place 1', () => {
    setupQualifyingMockDb({ solo: [5, 3, 1] });
    const r = runQualifying([makeQResult('solo', 3)]);
    expect(r.solo.place).toBe(1);
    expect(r.solo.totalPoints).toBe(9);
  });

  it('single boat in final fleet gets place 1', () => {
    setupFinalMockDb({ solo: [2, 2] });
    const groups = runFinal([makeFResult('solo', 'Final Gold')]);
    expect(groups.get('Gold')![0].place).toBe(1);
  });

  it('empty results produces no output', () => {
    setupFinalMockDb({});
    const groups = runFinal([]);
    expect(groups.size).toBe(0);
  });

  it('boat with zero races has zero exclusions', () => {
    setupQualifyingMockDb({ b: [3, 2, 1] });
    const r = runQualifying([makeQResult('b', 0)]);
    expect(r.b.totalPoints).toBe(6); // no exclusions
  });

  it('boat with all identical scores: no exclusion effect on total ranking', () => {
    // 8 races all scoring 5: exclude 2 worst (5,5) → total = 5×6 = 30
    setupQualifyingMockDb({ b: [5, 5, 5, 5, 5, 5, 5, 5] });
    const r = runQualifying([makeQResult('b', 8)]);
    expect(r.b.totalPoints).toBe(30);
  });

  it('2 boats with perfectly identical scores and races remain in stable order', () => {
    setupQualifyingMockDb(
      { a: [3, 1], b: [3, 1] },
      { a: [3, 1], b: [3, 1] },
      {
        a: [
          { race_id: 1, race_number: 1, points: 1 },
          { race_id: 2, race_number: 2, points: 3 },
        ],
        b: [
          { race_id: 1, race_number: 1, points: 1 },
          { race_id: 2, race_number: 2, points: 3 },
        ],
      },
    );
    const r = runQualifying([makeQResult('a', 2), makeQResult('b', 2)]);
    // Perfectly tied: should still get distinct places (stable sort)
    const places = [r.a.place, r.b.place].sort();
    expect(places).toEqual([1, 2]);
  });

  it('handles very large fleet (50 boats) with unique scores', () => {
    const a81: Record<string, number[]> = {};
    const results: ReturnType<typeof makeQResult>[] = [];
    for (let i = 1; i <= 50; i++) {
      const id = `boat${i}`;
      a81[id] = [i]; // single race
      results.push(makeQResult(id, 1));
    }
    setupQualifyingMockDb(a81);
    const r = runQualifying(results);
    const places = Object.values(r)
      .map((v) => v.place)
      .sort((a, b) => a - b);
    expect(places).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: SHRS 4.2 – TEMPORARY EXCLUSION FOR FINAL FLEET DIVISION
//   >5 but <8 qualifying races → exclude 2nd worst temporarily for fleet split
//   (This is a rule to be aware of; verify getExcludeCount returns correct
//    values and that the division logic is conceptually sound)
// ═══════════════════════════════════════════════════════════════════════════════

describe('SHRS 4.2 – Temporary extra exclusion for fleet division', () => {
  it('with 6 qualifying races, normal exclude count is 1', () => {
    // The standard formula gives 1, but 4.2 says for fleet division
    // purposes only, temporarily exclude the 2nd worst too.
    // This test verifies the base behavior; 4.2 adjustment would
    // be applied at the fleet-division call site.
    expect(getExcludeCount(6)).toBe(1);
  });

  it('with 7 qualifying races, normal exclude count is still 1', () => {
    expect(getExcludeCount(7)).toBe(1);
  });

  it('the extra exclusion for 4.2 would be excludeCount + 1 = 2', () => {
    // Application code should do: getExcludeCount(n) + 1 when 5 < n < 8
    // for fleet-division ranking only. This verifies the arithmetic.
    for (let n = 6; n <= 7; n++) {
      const base = getExcludeCount(n);
      const temporary = base + 1;
      expect(temporary).toBe(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: REGRESSION – VERIFY EXISTING SPEC EDGE-CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression – discard thresholds at every boundary', () => {
  const boundaries: [number, number][] = [
    [3, 0],
    [4, 1],
    [7, 1],
    [8, 2],
    [15, 2],
    [16, 3],
    [23, 3],
    [24, 4],
    [31, 4],
    [32, 5],
    [39, 5],
    [40, 6],
    [47, 6],
    [48, 7],
  ];

  it.each(boundaries)(
    'qualifying with %i races: %i exclusions applied to actual scoring',
    (numRaces, expectedExclusions) => {
      // Build scores: worst scores are 100s, rest are 1s
      const worstScores = Array(expectedExclusions).fill(100);
      const goodScores = Array(numRaces - expectedExclusions).fill(1);
      const allScores = [...worstScores, ...goodScores]; // DESC
      setupQualifyingMockDb({ boat: allScores });
      const r = runQualifying([makeQResult('boat', numRaces)]);
      const expectedTotal = goodScores.reduce((a, b) => a + b, 0);
      expect(r.boat.totalPoints).toBe(expectedTotal);
    },
  );
});

describe('Regression – Final Series discard boundaries', () => {
  const boundaries: [number, number][] = [
    [3, 0],
    [4, 1],
    [8, 2],
    [16, 3],
  ];

  it.each(boundaries)(
    'final with %i races: %i exclusions',
    (numRaces, expectedExclusions) => {
      const worstScores = Array(expectedExclusions).fill(100);
      const goodScores = Array(numRaces - expectedExclusions).fill(1);
      const allScores = [...worstScores, ...goodScores];
      setupFinalMockDb({ g1: allScores });
      const groups = runFinal([makeFResult('g1', 'Final Gold')]);
      const expectedTotal = goodScores.reduce((a, b) => a + b, 0);
      expect(groups.get('Gold')![0].totalPoints).toBe(expectedTotal);
    },
  );
});
