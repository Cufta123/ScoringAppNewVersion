import {
  assignBoatsToInitialHeatsSerpentine,
  compareByCountryThenSail,
  findLatestHeatsBySuffix,
  checkRaceCountForLatestHeats,
  generateNextHeatNames,
  getNextHeatIndexByMovementTable,
} from '../main/functions/creatingNewHeatsUtls';
import { compareNationalSail } from '../shared/sailOrder';

// ─── compareByCountryThenSail ─────────────────────────────────────────────────

describe('compareByCountryThenSail', () => {
  it('orders by country first, then numeric-aware sail number', () => {
    const rows = [
      { country: 'GBR', sail_number: '2' },
      { country: 'CRO', sail_number: '10' },
      { country: 'CRO', sail_number: '9' },
    ];
    rows.sort(compareByCountryThenSail);
    expect(rows).toEqual([
      // "9" before "10": numeric-aware, not lexicographic.
      { country: 'CRO', sail_number: '9' },
      { country: 'CRO', sail_number: '10' },
      { country: 'GBR', sail_number: '2' },
    ]);
  });

  it('tolerates missing values', () => {
    expect(
      compareByCountryThenSail(
        { country: null, sail_number: null },
        { country: 'CRO', sail_number: 1 },
      ),
    ).toBeLessThan(0);
  });

  it('is case-insensitive on the national letter, matching compareNationalSail', () => {
    const rows = [
      { country: 'cro', sail_number: 1 },
      { country: 'CRO', sail_number: 2 },
      { country: 'GER', sail_number: 1 },
    ];
    const byCountryThenSail = [...rows].sort(compareByCountryThenSail);
    const byNationalSail = [...rows].sort(compareNationalSail);
    // 'cro' and 'CRO' are the same nation, so they sort as a tie — not apart.
    expect(byCountryThenSail).toEqual(byNationalSail);
    expect(byCountryThenSail[0].country).toBe('cro');
    expect(byCountryThenSail[1].country).toBe('CRO');
  });
});

// ─── assignBoatsToInitialHeatsSerpentine ─────────────────────────────────────

describe('assignBoatsToInitialHeatsSerpentine', () => {
  it('throws when no heats are provided', () => {
    expect(() => assignBoatsToInitialHeatsSerpentine(3, 0)).toThrow(
      'Number of heats must be greater than 0.',
    );
  });

  it('walks A,B,C,C,B,A,A,B,… doubling the boundary heats (SHRS 3.1)', () => {
    expect(assignBoatsToInitialHeatsSerpentine(8, 3)).toEqual([
      0, 1, 2, 2, 1, 0, 0, 1,
    ]);
  });

  it('keeps heat sizes within one boat of each other', () => {
    const indices = assignBoatsToInitialHeatsSerpentine(23, 5);
    const sizes = [0, 0, 0, 0, 0];
    indices.forEach((i) => {
      sizes[i] += 1;
    });
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(23);
  });

  it('puts every boat in the single heat when numHeats is 1', () => {
    expect(assignBoatsToInitialHeatsSerpentine(4, 1)).toEqual([0, 0, 0, 0]);
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
    expect(getNextHeatIndexByMovementTable(0, 2, 3)).toBe(2); // A2 -> C
    expect(getNextHeatIndexByMovementTable(0, 3, 3)).toBe(1); // A3 -> B
    expect(getNextHeatIndexByMovementTable(1, 2, 3)).toBe(0); // B2 -> A
    expect(getNextHeatIndexByMovementTable(2, 2, 3)).toBe(1); // C2 -> B
    expect(getNextHeatIndexByMovementTable(2, 3, 3)).toBe(0); // C3 -> A
  });

  it('matches SHRS table for 4 heats', () => {
    expect(getNextHeatIndexByMovementTable(0, 1, 4)).toBe(0); // A1 -> A
    expect(getNextHeatIndexByMovementTable(0, 2, 4)).toBe(3); // A2 -> D
    expect(getNextHeatIndexByMovementTable(0, 3, 4)).toBe(2); // A3 -> C
    expect(getNextHeatIndexByMovementTable(0, 4, 4)).toBe(1); // A4 -> B
    expect(getNextHeatIndexByMovementTable(3, 2, 4)).toBe(2); // D2 -> C
    expect(getNextHeatIndexByMovementTable(2, 4, 4)).toBe(3); // C4 -> D
  });
});
