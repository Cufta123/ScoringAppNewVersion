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
        return (scoresA81[boatId] ?? []).map((points) => ({ points }));
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
    const places = Object.values(result).map((r) => r.place).sort((a, b) => a - b);
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
    const result = run([
      makeResult('boatA', 2),
      makeResult('boatB', 2),
      makeResult('boatC', 2),
    ]);
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
      boatA: [2, 1],  // total 3, sorted [1,2]
      boatB: [3, 2],  // total 5, sorted [2,3]
      boatC: [4, 1],  // total 5, sorted [1,4]
      boatD: [5, 4],  // total 9
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
