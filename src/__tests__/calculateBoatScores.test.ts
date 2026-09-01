/* eslint-disable camelcase */
/**
 * Tests for calculateBoatScores.ts
 *
 * Scoring rules implemented (based on Appendix A8 of ISAF Racing Rules):
 *  - Scores are fetched ordered by points DESC (worst/highest first).
 *  - Exclusion thresholds: 1 exclusion added per [4,8,16,24,32,40,48,56,64,72] races reached.
 *  - Tie-breaking A81: compare each boat's kept scores sorted ASC – lower wins.
 *  - Tie-breaking A82: if still tied, compare chronological race scores oldest-first – lower wins.
 */
import calculateBoatScores from '../main/functions/calculateBoatScores';
import { db } from '../../public/Database/DBManager';

// ─── Mock DB ──────────────────────────────────────────────────────────────────
// jest.mock is hoisted; the factory runs before imports, so we expose a
// mutable registry that individual tests populate.

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

// Typed handle for configuration in tests
const mockPrepare = (db as unknown as { prepare: jest.Mock }).prepare;

/**
 * Configure the mock database for a single test.
 * @param scoresA81  Map of boat_id → scores returned ORDER BY points DESC
 *                   (i.e., worst/highest scores first)
 * @param scoresA82  Map of boat_id → scores returned ORDER BY race_number DESC
 *                   (i.e., most recent race first)
 */
function setupMockDb(
  scoresA81: Record<
    string,
    Array<
      | number
      | {
          points: number;
          status?: string;
          race_id?: number;
          race_number?: number;
        }
    >
  >,
  scoresA82: Record<string, number[]> = {},
  raceScores: Record<
    string,
    Array<{ race_id: number; race_number: number; points: number }>
  > = {},
  discardConfig:
    | {
        firstDiscardAt: number;
        secondDiscardAt: number;
        additionalEvery: number;
      }
    | { thresholds: number[] } = {
    firstDiscardAt: 4,
    secondDiscardAt: 8,
    additionalEvery: 8,
  },
) {
  mockPrepare.mockImplementation((sql: string) => ({
    get: (_eventId: unknown) => {
      if (
        sql.includes(
          'SELECT shrs_discard_profile_qualifying as discard_profile',
        )
      ) {
        return { discard_profile: JSON.stringify(discardConfig) };
      }
      return undefined;
    },
    all: (_eventId: unknown, boatId: string) => {
      if (sql.includes('SELECT s.race_id, r.race_number, s.points')) {
        if (raceScores[boatId]) {
          return raceScores[boatId];
        }
        const descendingScores = scoresA82[boatId] ?? [];
        return descendingScores.map((points, index) => ({
          race_id: index + 1,
          race_number: descendingScores.length - index,
          points,
        }));
      }
      if (sql.includes('ORDER BY points DESC')) {
        return (scoresA81[boatId] ?? []).map((row, index) => {
          if (typeof row === 'number') {
            return {
              points: row,
              status: 'FINISHED',
              race_id: index + 1,
              race_number: index + 1,
            };
          }
          return {
            points: row.points,
            status: row.status ?? 'FINISHED',
            race_id: row.race_id ?? index + 1,
            race_number: row.race_number ?? index + 1,
          };
        });
      }
      if (sql.includes('ORDER BY r.race_number DESC')) {
        return (scoresA82[boatId] ?? []).map((points) => ({ points }));
      }
      return [];
    },
  }));
}

/** Convenience: build a results array entry */
const makeResult = (
  boat_id: string,
  number_of_races: number,
  total_points_event = 0,
) => ({ boat_id, number_of_races, total_points_event });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run the function and return results indexed by boat_id */
function run(
  results: ReturnType<typeof makeResult>[],
  event_id = 1,
): Record<string, { totalPoints: number; place: number }> {
  const pointsMap = new Map<number, string[]>();
  const table = calculateBoatScores(results, event_id, pointsMap);
  return Object.fromEntries(
    table.map((row) => [
      row.boat_id,
      { totalPoints: row.totalPoints, place: row.place! },
    ]),
  );
}

// ─── Score Exclusion Logic ────────────────────────────────────────────────────

describe('Score exclusion thresholds', () => {
  it('excludes 0 scores when races < 4', () => {
    setupMockDb({
      boatA: [5, 3, 2], // DESC order – worst first
    });
    const result = run([makeResult('boatA', 3)]);
    expect(result.boatA.totalPoints).toBe(10); // 5+3+2 – nothing excluded
  });

  it('excludes 1 (worst) score when races >= 4', () => {
    // DB returns DESC: [10, 3, 2, 1] – worst score is 10
    setupMockDb({ boatA: [10, 3, 2, 1] });
    const result = run([makeResult('boatA', 4)]);
    expect(result.boatA.totalPoints).toBe(6); // 3+2+1 (10 excluded)
  });

  it('excludes 2 scores when races >= 8', () => {
    // 8 races, scores DESC: [9,8,7,6,5,4,3,2] – exclude top 2 (9,8)
    setupMockDb({ boatA: [9, 8, 7, 6, 5, 4, 3, 2] });
    const result = run([makeResult('boatA', 8)]);
    expect(result.boatA.totalPoints).toBe(7 + 6 + 5 + 4 + 3 + 2); // 27
  });

  it('excludes 3 scores when races >= 16', () => {
    const scores = Array.from({ length: 16 }, (_, i) => 16 - i); // [16,15,...,1] DESC
    setupMockDb({ boatA: scores });
    const result = run([makeResult('boatA', 16)]);
    // Exclude top 3: 16,15,14 → sum of 13..1 = 91
    const expected = scores.slice(3).reduce((a, b) => a + b, 0);
    expect(result.boatA.totalPoints).toBe(expected);
  });

  it('applies the series-wide discard count to a boat that missed a race (SHRS 5.4)', () => {
    // Series has 4 completed races (boat A sailed all 4); boat B sailed only 3.
    // SHRS 5.4 keys the discard count off races completed in the SERIES, so
    // both boats discard 1 worst score — B must not get 0 discards.
    setupMockDb({
      A: [10, 1, 1, 1], // DESC worst-first
      B: [10, 1, 1],
    });
    const result = run([makeResult('A', 4), makeResult('B', 3)]);
    expect(result.A.totalPoints).toBe(3); // 1+1+1 (10 excluded)
    expect(result.B.totalPoints).toBe(2); // 1+1 (10 excluded, not kept)
  });

  // LB-11: a boat with fewer scores than the series-wide discard count must
  // never have ALL of its scores discarded (→ total 0 → wrongly ranked first).
  // The discard count is capped so at least one score always survives.
  it('caps discards so a boat with fewer races than the discard count keeps a score (LB-11)', () => {
    // Series-wide race count is 8 (boatFull sailed 8) → SHRS 5.4 gives 2
    // discards. boatLate sailed a single race (20th place) and its missing
    // races are not seeded. Without the cap it would discard its only score →
    // total 0 → ranked ahead of a boat that finished 1st in every race.
    setupMockDb({
      boatFull: [1, 1, 1, 1, 1, 1, 1, 1], // 2 discards → keeps six 1s → total 6
      boatLate: [20], // one race only
    });
    const result = run([makeResult('boatFull', 8), makeResult('boatLate', 1)]);
    expect(result.boatLate.totalPoints).toBe(20); // score kept, not zeroed
    expect(result.boatFull.place).toBe(1); // all-firsts boat correctly on top
    expect(result.boatLate.place).toBe(2);
  });

  // LB-11 (tie-break site): the SAME cap must apply when building the A8.1
  // kept-score vector, otherwise a boat whose total was computed with a capped
  // discard count enters the tie-break with an EMPTY vector — which
  // compareScoreArrays treats as the worst possible score — and always loses a
  // tie it should win on SHRS 5.7 / RRS A8.2.
  it('applies the discard cap to the A8.1 tie-break vector too (LB-11)', () => {
    // Series is 8 races (boatSeries) → SHRS 5.4 gives 2 discards.
    //   boatFull  has 3 scores → discards 2 → keeps [6] → total 6
    //   boatShort has 2 scores → cap to 1 discard → keeps [6] → total 6
    // They tie at 6 and never shared a race, so the fallback A8.1 compares
    // kept scores: [6] vs [6] → still tied → A8.2 (last race backward) decides.
    // Uncapped, boatShort's vector would be [] and it would lose outright.
    setupMockDb(
      {
        boatSeries: [2, 2, 2, 2, 2, 2, 2, 2], // keeps six 2s → 12, no tie
        boatFull: [50, 40, 6],
        boatShort: [30, 6],
      },
      {
        // A8.2: most recent race first. Equal last race (6), then boatShort's
        // 30 beats boatFull's 40 → boatShort wins the tie.
        boatSeries: [2, 2, 2, 2, 2, 2, 2, 2],
        boatFull: [6, 40, 50],
        boatShort: [6, 30],
      },
      {
        // Disjoint race_ids → the boats never shared a heat (SHRS 5.7(ii)(4)).
        boatSeries: Array.from({ length: 8 }, (_, i) => ({
          race_id: 100 + i,
          race_number: 8 - i,
          points: 2,
        })),
        boatFull: [
          { race_id: 1, race_number: 3, points: 6 },
          { race_id: 2, race_number: 2, points: 40 },
          { race_id: 3, race_number: 1, points: 50 },
        ],
        boatShort: [
          { race_id: 4, race_number: 2, points: 6 },
          { race_id: 5, race_number: 1, points: 30 },
        ],
      },
    );

    const result = run([
      makeResult('boatSeries', 8),
      makeResult('boatFull', 3),
      makeResult('boatShort', 2),
    ]);

    expect(result.boatFull.totalPoints).toBe(6);
    expect(result.boatShort.totalPoints).toBe(6);
    // A8.2 resolves the tie in boatShort's favour; without the cap boatShort
    // would be pushed below boatFull by an empty A8.1 vector.
    expect(result.boatShort.place).toBe(1);
    expect(result.boatFull.place).toBe(2);
    expect(result.boatSeries.place).toBe(3);
  });

  it('each threshold [4,8,16,24,32] adds one more exclusion', () => {
    const thresholds = [4, 8, 16, 24, 32];
    thresholds.forEach((numRaces, idx) => {
      const expectedExclusions = idx + 1;
      // Create scores: worst scores are [100, 100, ...] (first N), then all 1s
      const worstScores = Array(expectedExclusions + 1).fill(100); // +1 to be safe
      const goodScores = Array(numRaces - expectedExclusions - 1).fill(1);
      const allScores = [...worstScores, ...goodScores];
      setupMockDb({ boat1: allScores });
      const result = run([makeResult('boat1', numRaces)]);
      // The excluded count should equal expectedExclusions, so total should
      // not include the worst scores equal to expectedExclusions
      const expectedTotal = allScores
        .slice(expectedExclusions)
        .reduce((a, b) => a + b, 0);
      expect(result.boat1.totalPoints).toBe(expectedTotal);
    });
  });

  it('never excludes DNE/DGM even when they are worst scores', () => {
    setupMockDb({
      boatA: [
        { points: 10, status: 'DNE', race_id: 1, race_number: 1 },
        { points: 9, status: 'DGM', race_id: 2, race_number: 2 },
        { points: 8, status: 'FINISHED', race_id: 3, race_number: 3 },
        { points: 1, status: 'FINISHED', race_id: 4, race_number: 4 },
      ],
    });

    const result = run([makeResult('boatA', 4)]);
    // 1 discard at 4 races; worst excludable is 8 (DNE/DGM are non-excludable)
    expect(result.boatA.totalPoints).toBe(10 + 9 + 1);
  });

  it('for equal worst excludable scores excludes the earliest race first', () => {
    setupMockDb({
      boatA: [
        { points: 9, status: 'DNE', race_id: 1, race_number: 1 },
        { points: 7, status: 'FINISHED', race_id: 2, race_number: 2 },
        { points: 7, status: 'FINISHED', race_id: 3, race_number: 3 },
        { points: 1, status: 'FINISHED', race_id: 4, race_number: 4 },
      ],
    });

    const result = run([makeResult('boatA', 4)]);
    // one discard: among excludable 7 and 7, earliest race_number=2 is excluded
    expect(result.boatA.totalPoints).toBe(9 + 7 + 1);
  });

  it('applies custom discard thresholds from event settings', () => {
    // Custom: first discard at 3, second at 6, then +1 every 6 races.
    setupMockDb(
      {
        boatA: [9, 8, 7, 6, 5, 4],
      },
      {},
      {},
      { firstDiscardAt: 3, secondDiscardAt: 6, additionalEvery: 6 },
    );

    const result = run([makeResult('boatA', 6)]);
    // At 6 races => 2 discards -> remove 9 and 8
    expect(result.boatA.totalPoints).toBe(7 + 6 + 5 + 4);
  });

  it('applies custom threshold list from event settings', () => {
    setupMockDb(
      {
        boatA: [10, 9, 8, 7, 6, 5],
      },
      {},
      {},
      { thresholds: [3, 5, 6] },
    );

    const result = run([makeResult('boatA', 6)]);
    // At 6 races with thresholds [3,5,6] => 3 discards -> remove 10, 9, 8.
    expect(result.boatA.totalPoints).toBe(7 + 6 + 5);
  });
});

// ─── Basic Ranking ────────────────────────────────────────────────────────────

describe('Basic ranking (no ties)', () => {
  it('ranks 3 boats by ascending total points', () => {
    setupMockDb({
      boatA: [3, 2, 1], // total 6
      boatB: [5, 4, 3], // total 12
      boatC: [2, 1, 1], // total 4
    });
    const result = run([
      makeResult('boatA', 3),
      makeResult('boatB', 3),
      makeResult('boatC', 3),
    ]);
    expect(result.boatC.place).toBe(1);
    expect(result.boatA.place).toBe(2);
    expect(result.boatB.place).toBe(3);
  });

  it('places are consecutive integers starting at 1', () => {
    setupMockDb({
      boatA: [1],
      boatB: [2],
      boatC: [3],
      boatD: [4],
    });
    const result = run([
      makeResult('boatA', 1),
      makeResult('boatB', 1),
      makeResult('boatC', 1),
      makeResult('boatD', 1),
    ]);
    const places = Object.values(result)
      .map((r) => r.place)
      .sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4]);
  });

  it('returns correct totalPoints for each boat', () => {
    setupMockDb({
      boatX: [4, 2],
      boatY: [3, 3],
    });
    const result = run([makeResult('boatX', 2), makeResult('boatY', 2)]);
    expect(result.boatX.totalPoints).toBe(6);
    expect(result.boatY.totalPoints).toBe(6);
  });
});

// ─── Tie-Breaking A81 ─────────────────────────────────────────────────────────

describe('Tie-breaking A81 (compare kept scores sorted ascending)', () => {
  it('resolves tie in favour of boat with lower best score', () => {
    // Both boats total 5
    // boatA: DB DESC [4,1] → keep all, sorted ASC [1,4]
    // boatB: DB DESC [3,2] → keep all, sorted ASC [2,3]
    // Compare: 1 < 2 → boatA wins
    setupMockDb({
      boatA: [4, 1],
      boatB: [3, 2],
    });
    const result = run([makeResult('boatA', 2), makeResult('boatB', 2)]);
    expect(result.boatA.place).toBe(1);
    expect(result.boatB.place).toBe(2);
  });

  it('resolves tie when boats differ on second-best score', () => {
    // boatA sorted ASC: [1, 5] → first scoress are equal (1==1), compare 2nd
    // boatB sorted ASC: [1, 6]
    setupMockDb({
      boatA: [5, 1], // total 6, sorted ASC [1,5]
      boatB: [6, 1], // total 7 – not a tie, let me fix
    });
    // Actually for a tie, totals must match. Let me use:
    // boatA: [5,1] total 6, sorted [1,5]
    // boatB: [4,2] total 6, sorted [2,4]
    setupMockDb({
      boatA: [5, 1], // total 6, sorted ASC [1,5]
      boatB: [4, 2], // total 6, sorted ASC [2,4]
    });
    const result = run([makeResult('boatA', 2), makeResult('boatB', 2)]);
    // [1,5] vs [2,4]: first element 1 < 2 → boatA wins
    expect(result.boatA.place).toBe(1);
    expect(result.boatB.place).toBe(2);
  });

  it('resolves tie on second element when first elements are equal', () => {
    // boatA sorted ASC: [1,5] total 6
    // boatB sorted ASC: [1,6] total 7 — not tied on total!
    // For tied total AND same first score, differ on second:
    // boatA: [4,2,1] total 7, sorted ASC [1,2,4]
    // boatB: [3,3,1] total 7, sorted ASC [1,3,3]
    // Compare: 1==1, then 2<3 → boatA wins
    setupMockDb({
      boatA: [4, 2, 1], // total 7, sorted ASC [1,2,4]
      boatB: [3, 3, 1], // total 7, sorted ASC [1,3,3]
    });
    const result = run([makeResult('boatA', 3), makeResult('boatB', 3)]);
    expect(result.boatA.place).toBe(1);
    expect(result.boatB.place).toBe(2);
  });
});

// ─── Tie-Breaking A82 ─────────────────────────────────────────────────────────

describe('Tie-breaking A82 (compare latest race backward)', () => {
  it('resolves tie via A82 when A81 scores are identical', () => {
    // Both boats have same total AND same scores sorted ASC → triggers A82
    // boatA A81 DESC [3,1] → sorted ASC [1,3] → total 4
    // boatB A81 DESC [3,1] → sorted ASC [1,3] → total 4
    // A82 compares from latest race backward (ORDER BY race_number DESC)
    // Compare first element: boatA 3 vs boatB 1 → boatB wins
    setupMockDb(
      {
        boatA: [3, 1],
        boatB: [3, 1],
      },
      {
        boatA: [3, 1], // race_number DESC: race2=3, race1=1
        boatB: [1, 3], // race_number DESC: race2=1, race1=3
      },
    );
    const result = run([makeResult('boatA', 2), makeResult('boatB', 2)]);
    expect(result.boatB.place).toBe(1);
    expect(result.boatA.place).toBe(2);
  });

  it('resolves 3-way tie using A82', () => {
    // All three tied on total and A81 scores
    // A82 (DESC order): boatA oldest=1, boatB oldest=2, boatC oldest=3
    setupMockDb(
      {
        boatA: [4, 2],
        boatB: [4, 2],
        boatC: [4, 2],
      },
      {
        boatA: [4, 2], // oldest (last element) = 2 → race1=2
        boatB: [4, 3], // oldest = 3 → race1=3
        boatC: [4, 4], // oldest = 4 → race1=4
      },
    );
    // All have total 6, A81 same... but wait, boatA [4,2] sorted=[2,4], boatB [4,3] sorted=[3,4] → differ!
    // Let me re-examine: boatA [4,2] total=6 sorted=[2,4]
    //                    boatB [4,3] total=7 sorted=[3,4] — NOT a tie on total!
    // I need all to have identical sorted score arrays AND same total.
    // boatA: [3,1] total=4, sorted=[1,3]
    // boatB: [3,1] total=4, sorted=[1,3]
    // boatC: [3,1] total=4, sorted=[1,3]
    // Then A82 distinguishes them.
    setupMockDb(
      { boatA: [3, 1], boatB: [3, 1], boatC: [3, 1] },
      {
        boatA: [3, 1], // A82 last element (oldest) = 1
        boatB: [3, 2], // A82 last element (oldest) = 2
        boatC: [3, 3], // A82 last element (oldest) = 3
      },
    );
    const result2 = run([
      makeResult('boatA', 2),
      makeResult('boatB', 2),
      makeResult('boatC', 2),
    ]);
    expect(result2.boatA.place).toBe(1);
    expect(result2.boatB.place).toBe(2);
    expect(result2.boatC.place).toBe(3);
  });

  it('resolves 3-boat cascade by ranking winner first then remaining tie', () => {
    setupMockDb(
      {
        boatA: [3, 1],
        boatB: [3, 1],
        boatC: [3, 1],
      },
      {
        boatA: [1, 3],
        boatB: [2, 2],
        boatC: [2, 3],
      },
    );

    const result = run([
      makeResult('boatA', 2),
      makeResult('boatB', 2),
      makeResult('boatC', 2),
    ]);

    expect(result.boatA.place).toBe(1);
    expect(result.boatB.place).toBe(2);
    expect(result.boatC.place).toBe(3);
  });
});

describe('Multiple heat tie-break uses shared heats only', () => {
  it('ranks ESP47 ahead of USA55 using shared-heat race results', () => {
    setupMockDb(
      {
        ESP47: [10, 10],
        USA55: [10, 10],
      },
      {
        ESP47: [10, 10],
        USA55: [10, 10],
      },
      {
        ESP47: [
          { race_id: 101, race_number: 1, points: 2 },
          { race_id: 102, race_number: 4, points: 9 },
          { race_id: 103, race_number: 5, points: 1 },
          { race_id: 104, race_number: 13, points: 8 },
          { race_id: 105, race_number: 14, points: 3 },
          { race_id: 106, race_number: 15, points: 13 },
          { race_id: 107, race_number: 16, points: 3 },
          { race_id: 108, race_number: 17, points: 13 },
          { race_id: 109, race_number: 18, points: 11 },
        ],
        USA55: [
          { race_id: 101, race_number: 1, points: 3 },
          { race_id: 102, race_number: 4, points: 4 },
          { race_id: 103, race_number: 5, points: 12 },
          { race_id: 104, race_number: 13, points: 19 },
          { race_id: 105, race_number: 14, points: 6 },
          { race_id: 106, race_number: 15, points: 6 },
          { race_id: 107, race_number: 16, points: 1 },
          { race_id: 108, race_number: 17, points: 7 },
          { race_id: 109, race_number: 18, points: 16 },
        ],
      },
    );

    const result = run([makeResult('ESP47', 2), makeResult('USA55', 2)]);
    expect(result.ESP47.place).toBe(1);
    expect(result.USA55.place).toBe(2);
  });

  it('ignores non-shared races when breaking ties', () => {
    setupMockDb(
      {
        ESP47: [10, 10],
        USA55: [10, 10],
      },
      {
        ESP47: [10, 10],
        USA55: [10, 10],
      },
      {
        ESP47: [
          { race_id: 201, race_number: 1, points: 2 },
          { race_id: 202, race_number: 4, points: 9 },
          { race_id: 203, race_number: 5, points: 1 },
          { race_id: 204, race_number: 13, points: 8 },
          { race_id: 205, race_number: 14, points: 3 },
          { race_id: 206, race_number: 15, points: 13 },
          { race_id: 207, race_number: 16, points: 3 },
          { race_id: 208, race_number: 17, points: 13 },
          { race_id: 209, race_number: 18, points: 11 },
          { race_id: 901, race_number: 30, points: 99 },
        ],
        USA55: [
          { race_id: 201, race_number: 1, points: 3 },
          { race_id: 202, race_number: 4, points: 4 },
          { race_id: 203, race_number: 5, points: 12 },
          { race_id: 204, race_number: 13, points: 19 },
          { race_id: 205, race_number: 14, points: 6 },
          { race_id: 206, race_number: 15, points: 6 },
          { race_id: 207, race_number: 16, points: 1 },
          { race_id: 208, race_number: 17, points: 7 },
          { race_id: 209, race_number: 18, points: 16 },
          { race_id: 902, race_number: 30, points: 0 },
        ],
      },
    );

    const result = run([makeResult('ESP47', 2), makeResult('USA55', 2)]);
    expect(result.ESP47.place).toBe(1);
    expect(result.USA55.place).toBe(2);
  });

  it('applies SHRS 5.7.2.2 to tied boats that shared ALL races in a multi-heat event', () => {
    // boatA and boatB sailed the exact same races (601-604); boatC sailed
    // different races (701-704), so the EVENT is multi-heat. SHRS 5.7.2.2
    // therefore applies to the A/B tie: A8.1 uses ALL scores including
    // excluded ones. Kept scores are identical ([1,2,3] each), but A's
    // excluded worst is 9 vs B's 7, so B must win. The old pairwise
    // "shared all races = single heat" heuristic would instead fall to
    // chronological A8.2 and wrongly favour A (1 vs 3 in race 4).
    setupMockDb(
      {
        boatA: [
          { points: 9, race_id: 601, race_number: 1 },
          { points: 3, race_id: 602, race_number: 2 },
          { points: 2, race_id: 603, race_number: 3 },
          { points: 1, race_id: 604, race_number: 4 },
        ],
        boatB: [
          { points: 7, race_id: 601, race_number: 1 },
          { points: 3, race_id: 604, race_number: 4 },
          { points: 2, race_id: 603, race_number: 3 },
          { points: 1, race_id: 602, race_number: 2 },
        ],
        boatC: [
          { points: 2, race_id: 704, race_number: 4 },
          { points: 1, race_id: 701, race_number: 1 },
          { points: 1, race_id: 702, race_number: 2 },
          { points: 1, race_id: 703, race_number: 3 },
        ],
      },
      {
        boatA: [1, 2, 3, 9],
        boatB: [3, 2, 1, 7],
        boatC: [2, 1, 1, 1],
      },
      {
        boatA: [
          { race_id: 604, race_number: 4, points: 1 },
          { race_id: 603, race_number: 3, points: 2 },
          { race_id: 602, race_number: 2, points: 3 },
          { race_id: 601, race_number: 1, points: 9 },
        ],
        boatB: [
          { race_id: 604, race_number: 4, points: 3 },
          { race_id: 603, race_number: 3, points: 2 },
          { race_id: 602, race_number: 2, points: 1 },
          { race_id: 601, race_number: 1, points: 7 },
        ],
        boatC: [
          { race_id: 704, race_number: 4, points: 2 },
          { race_id: 703, race_number: 3, points: 1 },
          { race_id: 702, race_number: 2, points: 1 },
          { race_id: 701, race_number: 1, points: 1 },
        ],
      },
    );

    const result = run([
      makeResult('boatA', 4),
      makeResult('boatB', 4),
      makeResult('boatC', 4),
    ]);
    expect(result.boatC.place).toBe(1);
    expect(result.boatB.place).toBe(2);
    expect(result.boatA.place).toBe(3);
  });

  it('uses excluded shared scores when breaking a tie', () => {
    setupMockDb(
      {
        boatA: [9, 8, 1, 1, 1, 1, 1, 1],
        boatB: [9, 8, 1, 1, 1, 1, 1, 1],
      },
      {
        boatA: [9, 8, 1, 1, 1, 1, 1, 1],
        boatB: [9, 7, 1, 1, 1, 1, 1, 1],
      },
      {
        boatA: [
          { race_id: 301, race_number: 1, points: 9 },
          { race_id: 302, race_number: 2, points: 8 },
          { race_id: 303, race_number: 3, points: 1 },
          { race_id: 304, race_number: 4, points: 1 },
          { race_id: 305, race_number: 5, points: 1 },
          { race_id: 306, race_number: 6, points: 1 },
          { race_id: 307, race_number: 7, points: 1 },
          { race_id: 308, race_number: 8, points: 1 },
        ],
        boatB: [
          { race_id: 301, race_number: 1, points: 9 },
          { race_id: 302, race_number: 2, points: 7 },
          { race_id: 303, race_number: 3, points: 1 },
          { race_id: 304, race_number: 4, points: 1 },
          { race_id: 305, race_number: 5, points: 1 },
          { race_id: 306, race_number: 6, points: 1 },
          { race_id: 307, race_number: 7, points: 1 },
          { race_id: 308, race_number: 8, points: 1 },
        ],
      },
    );

    const result = run([makeResult('boatA', 8), makeResult('boatB', 8)]);
    expect(result.boatB.place).toBe(1);
    expect(result.boatA.place).toBe(2);
  });

  it('falls back to standard A8 when boats never raced together', () => {
    setupMockDb(
      {
        boatA: [8, 6, 1, 1],
        boatB: [9, 5, 1, 1],
      },
      {
        boatA: [8, 6, 1, 1],
        boatB: [9, 5, 1, 1],
      },
      {
        boatA: [
          { race_id: 401, race_number: 10, points: 8 },
          { race_id: 402, race_number: 9, points: 6 },
          { race_id: 403, race_number: 8, points: 1 },
          { race_id: 404, race_number: 7, points: 1 },
        ],
        boatB: [
          { race_id: 501, race_number: 10, points: 9 },
          { race_id: 502, race_number: 9, points: 5 },
          { race_id: 503, race_number: 8, points: 1 },
          { race_id: 504, race_number: 7, points: 1 },
        ],
      },
    );

    const result = run([makeResult('boatA', 4), makeResult('boatB', 4)]);
    expect(result.boatB.place).toBe(1);
    expect(result.boatA.place).toBe(2);
  });
});

describe('SHRS discard progression', () => {
  it('excludes 5 after 32 races and 6 after 40 races', () => {
    const scores40 = Array.from({ length: 40 }, (_, i) => 40 - i);
    setupMockDb({ boat40: scores40 });
    const result40 = run([makeResult('boat40', 40)]);
    const expected40 = scores40.slice(6).reduce((acc, score) => acc + score, 0);
    expect(result40.boat40.totalPoints).toBe(expected40);

    const scores32 = Array.from({ length: 32 }, (_, i) => 32 - i);
    setupMockDb({ boat32: scores32 });
    const result32 = run([makeResult('boat32', 32)]);
    const expected32 = scores32.slice(5).reduce((acc, score) => acc + score, 0);
    expect(result32.boat32.totalPoints).toBe(expected32);
  });
});

// ─── Mixed Ties and Non-Ties ───────────────────────────────────────────────────

describe('Mixed scenario: some boats tied, some not', () => {
  it('correctly places tied boats among non-tied boats', () => {
    // boatA total 3 – clear winner
    // boatB total 5, sorted ASC [2,3] – beats boatC in tie
    // boatC total 5, sorted ASC [4,1]=[1,4] – loses tie to boatB
    // boatD total 9 – overall last
    setupMockDb({
      boatA: [2, 1], // total 3, sorted [1,2]
      boatB: [3, 2], // total 5, sorted [2,3]
      boatC: [4, 1], // total 5, sorted [1,4]
      boatD: [5, 4], // total 9
    });
    const result = run([
      makeResult('boatA', 2),
      makeResult('boatB', 2),
      makeResult('boatC', 2),
      makeResult('boatD', 2),
    ]);
    expect(result.boatA.place).toBe(1);
    // boatC sorted [1,4] vs boatB sorted [2,3]: 1 < 2 → boatC wins
    expect(result.boatC.place).toBe(2);
    expect(result.boatB.place).toBe(3);
    expect(result.boatD.place).toBe(4);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('handles a single boat', () => {
    setupMockDb({ boatA: [5, 3, 1] });
    const result = run([makeResult('boatA', 3)]);
    expect(result.boatA.place).toBe(1);
    expect(result.boatA.totalPoints).toBe(9);
  });

  it('returns all boats from the results', () => {
    setupMockDb({
      b1: [1],
      b2: [2],
      b3: [3],
      b4: [4],
      b5: [5],
    });
    const results = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id) =>
      makeResult(id, 1),
    );
    const table = (() => {
      const pointsMap = new Map<number, string[]>();
      return calculateBoatScores(results, 1, pointsMap);
    })();
    expect(table).toHaveLength(5);
  });

  it('a boat with zero races has zero exclusions', () => {
    setupMockDb({ boatA: [3, 2, 1] });
    const result = run([makeResult('boatA', 0)]);
    expect(result.boatA.totalPoints).toBe(6);
  });
});

describe('Score exclusion exact boundaries (SHRS 5.4)', () => {
  it('excludes 1 score at exactly races = 7 (one below the 8-race second threshold)', () => {
    // DESC worst-first: [7,6,5,4,3,2,1]
    setupMockDb({ boatA: [7, 6, 5, 4, 3, 2, 1] });
    const result = run([makeResult('boatA', 7)]);
    // 4-7 band => 1 discard: drop worst (7) -> 6+5+4+3+2+1 = 21
    expect(result.boatA.totalPoints).toBe(21);
  });

  it('excludes 2 scores at exactly races = 15 (one below the 16-race +1 threshold)', () => {
    const scores = Array.from({ length: 15 }, (_, i) => 15 - i); // [15,...,1] DESC
    setupMockDb({ boatA: scores });
    const result = run([makeResult('boatA', 15)]);
    // 8-15 band => 2 discards: drop 15,14
    const expected = scores.slice(2).reduce((a, b) => a + b, 0);
    expect(result.boatA.totalPoints).toBe(expected);
  });
});

describe('Unequal per-boat race counts (C1) — series-wide max drives every boat', () => {
  it('applies the series-max discard count to boats with fewer races each, not their own count', () => {
    // Series max = 8 races (boat A sailed all 8). B sailed 4, C sailed 3.
    // SHRS 5.4 keys the discard count off races completed in the SERIES (8 => 2
    // discards) — not each boat's own race count — so B and C must ALSO discard
    // 2 scores, not the 1 (for B, own count 4) or 0 (for C, own count 3) that a
    // per-boat calculation would wrongly give them.
    setupMockDb({
      A: [9, 8, 1, 1, 1, 1, 1, 1], // 8 scores
      B: [9, 8, 1, 1], // 4 scores
      C: [9, 1, 1], // 3 scores
    });
    const result = run([
      makeResult('A', 8),
      makeResult('B', 4),
      makeResult('C', 3),
    ]);
    // A: drop worst 2 (9,8) -> 1*6 = 6
    expect(result.A.totalPoints).toBe(6);
    // B: series-wide excludeCount=2 applied to its 4 scores -> drop 9,8 -> 1+1=2
    expect(result.B.totalPoints).toBe(2);
    // C: series-wide excludeCount=2 applied to its 3 scores -> drop 9 and the
    // earliest of the two tied 1s -> keeps a single 1
    expect(result.C.totalPoints).toBe(1);
  });
});

describe('Fractional scores (RRS A7 shared points) flow through totals and tie-breaks', () => {
  it('sums fractional (x.5) points correctly and can discard a fractional worst score', () => {
    // A7: boats tied for a place share the summed points equally, producing a
    // fractional score (e.g. two boats tied for 4th/5th each score 4.5).
    setupMockDb({ boatA: [4.5, 4.5, 3, 2, 1] });
    const result = run([makeResult('boatA', 5)]);
    // races=5 -> 1 discard; among the tied 4.5s the earliest race is dropped,
    // leaving 4.5+3+2+1 = 10.5
    expect(result.boatA.totalPoints).toBe(10.5);
  });

  it('breaks an A8.1 tie correctly when kept-score arrays contain fractional values', () => {
    // boatA kept ASC [1,2.5,4] vs boatB kept ASC [1,3,3.5]: totals both 7.5,
    // first elements equal (1==1), second elements differ (2.5 < 3) -> boatA
    // wins. Verifies compareScoreArrays does numeric (not lexicographic
    // string) comparison of fractional A7 points.
    setupMockDb({
      boatA: [4, 2.5, 1],
      boatB: [1, 3, 3.5],
    });
    const result = run([makeResult('boatA', 3), makeResult('boatB', 3)]);
    expect(result.boatA.place).toBe(1);
    expect(result.boatB.place).toBe(2);
  });
});

describe('RULE-m6: empty custom threshold list means never discard (SHRS 5.4)', () => {
  it('keeps every score when the event is configured with no thresholds', () => {
    // SHRS 5.4 lets the Race Committee change the discard rule before the
    // first warning signal; an empty threshold list is "no discards at all".
    // This used to fall through to the standard 4/8/8 profile end-to-end, so a
    // never-discard event still dropped its two worst races.
    setupMockDb(
      { boatA: [9, 8, 7, 6, 5, 4, 3, 2] },
      {},
      {},
      { thresholds: [] },
    );
    const result = run([makeResult('boatA', 8)]);
    expect(result.boatA.totalPoints).toBe(9 + 8 + 7 + 6 + 5 + 4 + 3 + 2);
  });
});

describe('A8.1 regression: excluded scores are not used in standard path', () => {
  it('falls through to A8.2 when kept-score vectors are equal', () => {
    setupMockDb(
      {
        boatA: [10, 10, 3, 2, 2, 1, 1, 1],
        boatB: [4, 4, 3, 2, 2, 1, 1, 1],
      },
      {
        boatA: [1, 1, 1, 2, 2, 3, 10, 10],
        boatB: [2, 1, 1, 2, 2, 3, 4, 4],
      },
      {
        boatA: [
          { race_id: 1001, race_number: 8, points: 1 },
          { race_id: 1002, race_number: 7, points: 1 },
          { race_id: 1003, race_number: 6, points: 1 },
          { race_id: 1004, race_number: 5, points: 2 },
          { race_id: 1005, race_number: 4, points: 2 },
          { race_id: 1006, race_number: 3, points: 3 },
          { race_id: 1007, race_number: 2, points: 10 },
          { race_id: 1008, race_number: 1, points: 10 },
        ],
        boatB: [
          { race_id: 2001, race_number: 8, points: 2 },
          { race_id: 2002, race_number: 7, points: 1 },
          { race_id: 2003, race_number: 6, points: 1 },
          { race_id: 2004, race_number: 5, points: 2 },
          { race_id: 2005, race_number: 4, points: 2 },
          { race_id: 2006, race_number: 3, points: 3 },
          { race_id: 2007, race_number: 2, points: 4 },
          { race_id: 2008, race_number: 1, points: 4 },
        ],
      },
    );

    const result = run([makeResult('boatA', 8), makeResult('boatB', 8)]);
    expect(result.boatA.place).toBe(1);
    expect(result.boatB.place).toBe(2);
  });
});
