/* eslint-disable camelcase */
/**
 * Tests for calculateFinalBoatScores.ts
 *
 * In the final series boats are grouped by heat_name (e.g. "Final Gold",
 * "Final Silver", "Final Bronze").  Within each group the lowest total
 * points wins, with A81/A82 tie-breaking identical to the qualifying series.
 */
import calculateFinalBoatScores from '../main/functions/calculateFinalBoatScores';
import { db } from '../../public/Database/DBManager';

// ─── Mock DB ──────────────────────────────────────────────────────────────────

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

const mockPrepare = (db as unknown as { prepare: jest.Mock }).prepare;

function setupMockDb(
  scoresA81: Record<string, number[]>,
  scoresA82: Record<string, number[]> = {},
) {
  mockPrepare.mockImplementation((sql: string) => ({
    all: (_eventId: unknown, boatId: string) => {
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

/** Build a result row matching the Result interface in calculateFinalBoatScores */
const makeResult = (boat_id: string, heat_name: string, total = 0) => ({
  boat_id,
  heat_name,
  total_points_final: total,
});

// ─── Group Separation ─────────────────────────────────────────────────────────

describe('Group separation', () => {
  it('creates separate groups for Gold and Silver', () => {
    setupMockDb({
      boatA: [3, 1],
      boatB: [2, 2],
      boatC: [4, 4],
      boatD: [5, 3],
    });
    const groupTables = calculateFinalBoatScores(
      [
        makeResult('boatA', 'Final Gold'),
        makeResult('boatB', 'Final Gold'),
        makeResult('boatC', 'Final Silver'),
        makeResult('boatD', 'Final Silver'),
      ],
      1,
    );
    expect(groupTables.has('Gold')).toBe(true);
    expect(groupTables.has('Silver')).toBe(true);
    expect(groupTables.get('Gold')).toHaveLength(2);
    expect(groupTables.get('Silver')).toHaveLength(2);
  });

  it('groups contain only the boats assigned to them', () => {
    setupMockDb({ g1: [1], g2: [2], s1: [3], s2: [4] });
    const groupTables = calculateFinalBoatScores(
      [
        makeResult('g1', 'Final Gold'),
        makeResult('g2', 'Final Gold'),
        makeResult('s1', 'Final Silver'),
        makeResult('s2', 'Final Silver'),
      ],
      1,
    );
    const goldIds = groupTables.get('Gold')!.map((b) => b.boat_id).sort();
    const silverIds = groupTables.get('Silver')!.map((b) => b.boat_id).sort();
    expect(goldIds).toEqual(['g1', 'g2']);
    expect(silverIds).toEqual(['s1', 's2']);
  });

  it('handles Gold, Silver, and Bronze simultaneously', () => {
    setupMockDb({ g: [1], s: [2], b: [3] });
    const groupTables = calculateFinalBoatScores(
      [
        makeResult('g', 'Final Gold'),
        makeResult('s', 'Final Silver'),
        makeResult('b', 'Final Bronze'),
      ],
      1,
    );
    expect([...groupTables.keys()].sort()).toEqual(['Bronze', 'Gold', 'Silver']);
  });
});

// ─── Ranking Within a Group ───────────────────────────────────────────────────

describe('Ranking within a group', () => {
  it('ranks Gold boats by ascending total points', () => {
    setupMockDb({
      g1: [5, 4, 3], // total 12
      g2: [2, 1, 1], // total 4
      g3: [3, 3, 3], // total 9
    });
    const groupTables = calculateFinalBoatScores(
      [
        makeResult('g1', 'Final Gold'),
        makeResult('g2', 'Final Gold'),
        makeResult('g3', 'Final Gold'),
      ],
      1,
    );
    const gold = groupTables.get('Gold')!;
    const byBoat = Object.fromEntries(gold.map((b) => [b.boat_id, b.place]));
    expect(byBoat.g2).toBe(1);
    expect(byBoat.g3).toBe(2);
    expect(byBoat.g1).toBe(3);
  });

  it('assigns consecutive places starting from 1 within each group', () => {
    setupMockDb({ a: [1], b: [2], c: [3], d: [4] });
    const groupTables = calculateFinalBoatScores(
      [
        makeResult('a', 'Final Gold'),
        makeResult('b', 'Final Gold'),
        makeResult('c', 'Final Silver'),
        makeResult('d', 'Final Silver'),
      ],
      1,
    );
    const goldPlaces = groupTables.get('Gold')!.map((b) => b.place).sort((x, y) => x! - y!);
    const silverPlaces = groupTables.get('Silver')!.map((b) => b.place).sort((x, y) => x! - y!);
    expect(goldPlaces).toEqual([1, 2]);
    expect(silverPlaces).toEqual([1, 2]);
  });
});

// ─── Tie-Breaking Within Group (A81) ─────────────────────────────────────────

describe('Tie-breaking A81 within final group', () => {
  it('resolves tied Gold boats via sorted-score comparison', () => {
    // boatA ASC sorted [1,4] vs boatB ASC sorted [2,3] – both total 5
    setupMockDb({
      boatA: [4, 1], // total 5, sorted ASC [1,4]
      boatB: [3, 2], // total 5, sorted ASC [2,3]
    });
    const groupTables = calculateFinalBoatScores(
      [
        makeResult('boatA', 'Final Gold'),
        makeResult('boatB', 'Final Gold'),
      ],
      1,
    );
    const gold = groupTables.get('Gold')!;
    const byBoat = Object.fromEntries(gold.map((b) => [b.boat_id, b.place]));
    expect(byBoat.boatA).toBe(1);
    expect(byBoat.boatB).toBe(2);
  });
});

// ─── Tie-Breaking Within Group (A82) ─────────────────────────────────────────

describe('Tie-breaking A82 within final group', () => {
  it('falls back to A82 when A81 scores are identical', () => {
    // Both boats: total 4, sorted [1,3] – A81 tie
    // A82 compares latest race backward: boatA 3 vs boatB 1 → boatB wins
    setupMockDb(
      { boatA: [3, 1], boatB: [3, 1] },
      { boatA: [3, 1], boatB: [1, 3] },
    );
    const groupTables = calculateFinalBoatScores(
      [
        makeResult('boatA', 'Final Silver'),
        makeResult('boatB', 'Final Silver'),
      ],
      1,
    );
    const silver = groupTables.get('Silver')!;
    const byBoat = Object.fromEntries(silver.map((b) => [b.boat_id, b.place]));
    expect(byBoat.boatB).toBe(1);
    expect(byBoat.boatA).toBe(2);
  });
});

// ─── Total Points Stored ─────────────────────────────────────────────────────

describe('totalPoints stored in group table', () => {
  it('stores the sum of all kept scores as totalPoints', () => {
    setupMockDb({ boatA: [5, 3, 1] }); // sum = 9, excludeCount = 0 (3 races)
    const groupTables = calculateFinalBoatScores(
      [makeResult('boatA', 'Final Gold')],
      1,
    );
    const entry = groupTables.get('Gold')![0];
    expect(entry.totalPoints).toBe(9);
  });
});

// ─── Single Group / Single Boat Edge Cases ────────────────────────────────────

describe('Edge cases', () => {
  it('handles a single boat in a group', () => {
    setupMockDb({ solo: [2, 2] });
    const groupTables = calculateFinalBoatScores(
      [makeResult('solo', 'Final Gold')],
      1,
    );
    const gold = groupTables.get('Gold')!;
    expect(gold).toHaveLength(1);
    expect(gold[0].place).toBe(1);
  });

  it('returns an empty map when results array is empty', () => {
    setupMockDb({});
    const groupTables = calculateFinalBoatScores([], 1);
    expect(groupTables.size).toBe(0);
  });
});

// ─── Large Groups (20+ participants) ─────────────────────────────────────────

describe('Large final groups', () => {
  it('handles 25 participants in each of Gold/Silver/Bronze with valid places', () => {
    const scoresA81: Record<string, number[]> = {};
    const results: Array<ReturnType<typeof makeResult>> = [];
    const groups = ['Gold', 'Silver', 'Bronze'];

    groups.forEach((group, groupIndex) => {
      for (let i = 1; i <= 25; i += 1) {
        const boatId = `${group.toLowerCase()}_${i}`;
        results.push(makeResult(boatId, `Final ${group}`));
        // Unique totals inside each group to keep ranking deterministic.
        // Example Gold: [26, 1], [27, 1], ...
        scoresA81[boatId] = [25 + i + groupIndex, 1];
      }
    });

    setupMockDb(scoresA81);
    const groupTables = calculateFinalBoatScores(results, 1);

    groups.forEach((group) => {
      const table = groupTables.get(group)!;
      expect(table).toHaveLength(25);

      const places = table
        .map((boat) => boat.place)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(places).toEqual(Array.from({ length: 25 }, (_, idx) => idx + 1));

      for (let i = 1; i < table.length; i += 1) {
        expect(table[i - 1].totalPoints).toBeLessThanOrEqual(table[i].totalPoints);
      }
    });
  });

  it('applies tie-breakers correctly in a 24-boat Gold group', () => {
    const scoresA81: Record<string, number[]> = {};
    const scoresA82: Record<string, number[]> = {};
    const results: Array<ReturnType<typeof makeResult>> = [];

    for (let i = 1; i <= 22; i += 1) {
      const boatId = `gold_${i}`;
      results.push(makeResult(boatId, 'Final Gold'));
      // Clearly separated totals for baseline boats.
      scoresA81[boatId] = [30 + i, 5];
      scoresA82[boatId] = [30 + i, 5];
    }

    // Two tied boats on A81 totals and score arrays; A82 must decide.
    // Both A81: [10, 4] -> sorted [4, 10], total 14.
    results.push(makeResult('gold_tie_a', 'Final Gold'));
    results.push(makeResult('gold_tie_b', 'Final Gold'));
    scoresA81.gold_tie_a = [10, 4];
    scoresA81.gold_tie_b = [10, 4];
    // A82 compares from oldest race (last element): 1 vs 3 -> tie_a wins.
    scoresA82.gold_tie_a = [10, 1];
    scoresA82.gold_tie_b = [10, 3];

    setupMockDb(scoresA81, scoresA82);
    const groupTables = calculateFinalBoatScores(results, 1);
    const gold = groupTables.get('Gold')!;

    expect(gold).toHaveLength(24);
    const byBoat = Object.fromEntries(gold.map((boat) => [boat.boat_id, boat.place]));
    const tieAPlace = byBoat.gold_tie_a as number;
    const tieBPlace = byBoat.gold_tie_b as number;
    expect(tieAPlace).toBeLessThan(tieBPlace);

    const places = gold
      .map((boat) => boat.place)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(places).toEqual(Array.from({ length: 24 }, (_, idx) => idx + 1));
  });
});
