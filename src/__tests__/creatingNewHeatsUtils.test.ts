/* eslint-disable camelcase */
import {
  assignBoatsToNewHeatsZigZag,
  findLatestHeatsBySuffix,
  checkRaceCountForLatestHeats,
  generateNextHeatNames,
  getNextHeatIndexByMovementTable,
} from '../main/functions/creatingNewHeatsUtls';

// ─── assignBoatsToNewHeatsZigZag ───────────────────────────────────────────────

describe('assignBoatsToNewHeatsZigZag', () => {
  const boats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ boat_id: `boat${i + 1}` }));

  describe('raceNumber = 1 (round-robin distribution)', () => {
    it('throws when no heats are provided', () => {
      expect(() => assignBoatsToNewHeatsZigZag(boats(3), [], 1)).toThrow(
        'Cannot assign boats when no heats are provided.',
      );
    });

    it('distributes boats evenly across 2 heats', () => {
      const result = assignBoatsToNewHeatsZigZag(
        boats(4),
        ['Heat A1', 'Heat B1'],
        1,
      );
      // SHRS snake pattern for 2 heats: A, B, B, A
      expect(result.map((a) => a.heatId)).toEqual([0, 1, 1, 0]);
      expect(result.map((a) => a.boatId)).toEqual([
        'boat1', 'boat2', 'boat3', 'boat4',
      ]);
    });

    it('distributes boats evenly across 3 heats', () => {
      const result = assignBoatsToNewHeatsZigZag(
        boats(6),
        ['Heat A1', 'Heat B1', 'Heat C1'],
        1,
      );
      // SHRS snake pattern: A, B, C, C, B, A
      expect(result.map((a) => a.heatId)).toEqual([0, 1, 2, 2, 1, 0]);
    });

    it('handles uneven distribution (5 boats, 2 heats)', () => {
      const result = assignBoatsToNewHeatsZigZag(
        boats(5),
        ['Heat A1', 'Heat B1'],
        1,
      );
      // SHRS snake pattern with capacity: 0,1,1,0,0
      expect(result.map((a) => a.heatId)).toEqual([0, 1, 1, 0, 0]);
    });
  });

  describe('raceNumber = 2 (zig-zag distribution)', () => {
    it('assigns 4 boats to 2 heats in zig-zag pattern', () => {
      const result = assignBoatsToNewHeatsZigZag(
        boats(4),
        ['Heat A2', 'Heat B2'],
        2,
      );
      // With 2 heats and 4 boats: 0,1,1,0 (zig-zag: go right, repeat boundary, go left)
      const heatIds = result.map((a) => a.heatId);
      // First boat always goes to heat 0, all boats should be assigned
      expect(result).toHaveLength(4);
      // Each boat should be present
      expect(result.map((a) => a.boatId)).toEqual([
        'boat1', 'boat2', 'boat3', 'boat4',
      ]);
    });

    it('assigns all boats regardless of heat count', () => {
      const result = assignBoatsToNewHeatsZigZag(
        boats(9),
        ['Heat A2', 'Heat B2', 'Heat C2'],
        2,
      );
      expect(result).toHaveLength(9);
      // All boat IDs must appear exactly once
      const boatIds = result.map((a) => a.boatId);
      expect(new Set(boatIds).size).toBe(9);
    });

    it('every boat gets assigned to an existing heat index', () => {
      const numHeats = 3;
      const result = assignBoatsToNewHeatsZigZag(
        boats(10),
        ['Heat A2', 'Heat B2', 'Heat C2'],
        2,
      );
      result.forEach(({ heatId }) => {
        expect(heatId).toBeGreaterThanOrEqual(0);
        expect(heatId).toBeLessThan(numHeats);
      });
    });

    it('respects capacity – no heat gets more than ceil(n/heats) boats', () => {
      const n = 7;
      const numHeats = 3;
      const result = assignBoatsToNewHeatsZigZag(
        boats(n),
        ['Heat A2', 'Heat B2', 'Heat C2'],
        2,
      );
      const countPerHeat = [0, 0, 0];
      result.forEach(({ heatId }) => {
        countPerHeat[heatId] += 1;
      });
      const maxAllowed = Math.ceil(n / numHeats);
      countPerHeat.forEach((count) => {
        expect(count).toBeLessThanOrEqual(maxAllowed);
      });
    });

    it('handles single heat – all boats go to heat 0', () => {
      const result = assignBoatsToNewHeatsZigZag(boats(5), ['Heat A2'], 2);
      result.forEach(({ heatId }) => expect(heatId).toBe(0));
    });

    it('handles single boat', () => {
      const result = assignBoatsToNewHeatsZigZag(
        boats(1),
        ['Heat A2', 'Heat B2'],
        2,
      );
      expect(result).toHaveLength(1);
      expect(result[0].heatId).toBe(0);
    });
  });
});

// ─── findLatestHeatsBySuffix ───────────────────────────────────────────────────

describe('findLatestHeatsBySuffix', () => {
  it('returns the latest heat for each base letter', () => {
    const heats = [
      { heat_name: 'Heat A1', heat_id: 1 },
      { heat_name: 'Heat A2', heat_id: 2 },
      { heat_name: 'Heat B1', heat_id: 3 },
      { heat_name: 'Heat B2', heat_id: 4 },
    ];
    const result = findLatestHeatsBySuffix(heats);
    const names = result.map((h) => h.heat_name).sort();
    expect(names).toEqual(['Heat A2', 'Heat B2']);
  });

  it('handles heats without numeric suffix (counts as 0)', () => {
    const heats = [
      { heat_name: 'Heat A', heat_id: 1 },
      { heat_name: 'Heat A1', heat_id: 2 },
    ];
    const result = findLatestHeatsBySuffix(heats);
    expect(result.map((h) => h.heat_name)).toContain('Heat A1');
  });

  it('returns single heat when only one exists per base', () => {
    const heats = [
      { heat_name: 'Heat A1', heat_id: 1 },
      { heat_name: 'Heat B1', heat_id: 2 },
      { heat_name: 'Heat C1', heat_id: 3 },
    ];
    const result = findLatestHeatsBySuffix(heats);
    expect(result).toHaveLength(3);
  });

  it('ignores heat names that do not match the pattern', () => {
    const heats = [
      { heat_name: 'Heat A1', heat_id: 1 },
      { heat_name: 'Final Gold', heat_id: 2 },
    ];
    const result = findLatestHeatsBySuffix(heats);
    expect(result).toHaveLength(1);
    expect(result[0].heat_name).toBe('Heat A1');
  });
});

// ─── generateNextHeatNames ────────────────────────────────────────────────────

describe('generateNextHeatNames', () => {
  it('increments the numeric suffix by 1', () => {
    const latestHeats = [
      { heat_name: 'Heat A1', heat_id: 1 },
      { heat_name: 'Heat B1', heat_id: 2 },
    ];
    const result = generateNextHeatNames(latestHeats);
    expect(result.sort()).toEqual(['Heat A2', 'Heat B2']);
  });

  it('handles heats without a suffix (treats as 0, generates 1)', () => {
    const latestHeats = [{ heat_name: 'Heat A', heat_id: 1 }];
    const result = generateNextHeatNames(latestHeats);
    expect(result).toEqual(['Heat A1']);
  });

  it('generates correct names for higher round numbers', () => {
    const latestHeats = [
      { heat_name: 'Heat A3', heat_id: 10 },
      { heat_name: 'Heat B3', heat_id: 11 },
      { heat_name: 'Heat C3', heat_id: 12 },
    ];
    const result = generateNextHeatNames(latestHeats);
    expect(result.sort()).toEqual(['Heat A4', 'Heat B4', 'Heat C4']);
  });
});

// ─── checkRaceCountForLatestHeats ─────────────────────────────────────────────

describe('checkRaceCountForLatestHeats', () => {
  const makeDb = (countsByHeatId: Record<number, number>) => ({
    prepare: () => ({
      get: (heat_id: number) => ({ race_count: countsByHeatId[heat_id] }),
    }),
  });

  it('does not throw when all heats have the same race count', () => {
    const heats = [
      { heat_name: 'Heat A1', heat_id: 1 },
      { heat_name: 'Heat B1', heat_id: 2 },
    ];
    const db = makeDb({ 1: 5, 2: 5 });
    expect(() => checkRaceCountForLatestHeats(heats, db)).not.toThrow();
  });

  it('throws when heats have different race counts', () => {
    const heats = [
      { heat_name: 'Heat A1', heat_id: 1 },
      { heat_name: 'Heat B1', heat_id: 2 },
    ];
    const db = makeDb({ 1: 5, 2: 6 });
    expect(() => checkRaceCountForLatestHeats(heats, db)).toThrow(
      'Not all heats have the same number of races yet',
    );
  });

  it('does not throw for a single heat', () => {
    const heats = [{ heat_name: 'Heat A1', heat_id: 1 }];
    const db = makeDb({ 1: 3 });
    expect(() => checkRaceCountForLatestHeats(heats, db)).not.toThrow();
  });
});

describe('getNextHeatIndexByMovementTable', () => {
  it('matches SHRS table for 2 heats', () => {
    expect(getNextHeatIndexByMovementTable(0, 1, 2)).toBe(0); // A1 -> A
    expect(getNextHeatIndexByMovementTable(1, 1, 2)).toBe(1); // B1 -> B
    expect(getNextHeatIndexByMovementTable(0, 2, 2)).toBe(1); // A2 -> B
    expect(getNextHeatIndexByMovementTable(1, 2, 2)).toBe(0); // B2 -> A
    expect(getNextHeatIndexByMovementTable(0, 3, 2)).toBe(0); // A3 -> A
    expect(getNextHeatIndexByMovementTable(1, 4, 2)).toBe(0); // B4 -> A
  });

  it('matches SHRS table for 3 heats', () => {
    expect(getNextHeatIndexByMovementTable(0, 1, 3)).toBe(0); // A1 -> A
    expect(getNextHeatIndexByMovementTable(0, 2, 3)).toBe(1); // A2 -> B
    expect(getNextHeatIndexByMovementTable(0, 3, 3)).toBe(2); // A3 -> C
    expect(getNextHeatIndexByMovementTable(1, 2, 3)).toBe(2); // B2 -> C
    expect(getNextHeatIndexByMovementTable(2, 2, 3)).toBe(0); // C2 -> A
    expect(getNextHeatIndexByMovementTable(2, 3, 3)).toBe(1); // C3 -> B
  });

  it('matches SHRS table for 4 heats', () => {
    expect(getNextHeatIndexByMovementTable(0, 1, 4)).toBe(0); // A1 -> A
    expect(getNextHeatIndexByMovementTable(0, 2, 4)).toBe(1); // A2 -> B
    expect(getNextHeatIndexByMovementTable(0, 3, 4)).toBe(2); // A3 -> C
    expect(getNextHeatIndexByMovementTable(0, 4, 4)).toBe(3); // A4 -> D
    expect(getNextHeatIndexByMovementTable(3, 2, 4)).toBe(0); // D2 -> A
    expect(getNextHeatIndexByMovementTable(2, 4, 4)).toBe(1); // C4 -> B
  });
});
