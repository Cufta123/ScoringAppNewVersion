/**
 * The heat-name helpers the app still uses to find the current round. The
 * seeding and the Heat Movement Tables are regatta-core's
 * (packages/regatta-core/test, ported/creating-new-heats.test.ts).
 */
import {
  checkRaceCountForLatestHeats,
  findLatestHeatsBySuffix,
} from '../main/functions/creatingNewHeatsUtls';

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
