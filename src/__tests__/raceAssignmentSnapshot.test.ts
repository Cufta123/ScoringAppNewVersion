/* eslint-disable camelcase */
/**
 * Tests for raceAssignmentSnapshot.ts — the SHRS 3.1.5 per-boat protest shield
 * and its persistence. The focus here is the migration boundary: a database
 * written before the frozen_position/frozen_status columns existed must still
 * load with a usable finishing order, because `getAssignmentRowsForHeatRace`
 * applies any non-empty snapshot it gets back.
 */
import {
  loadPersistedAssignmentSnapshot,
  raceAssignmentSnapshots,
  unshieldBoatFromAssignmentSnapshot,
} from '../main/functions/raceAssignmentSnapshot';
import { db } from '../../public/Database/DBManager';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

const mockPrepare = (db as unknown as { prepare: jest.Mock }).prepare;

type SnapshotRow = {
  boat_id: string;
  rank: number;
  frozen_position: number | null;
  frozen_status: string | null;
};

function setupRows(rows: SnapshotRow[]) {
  mockPrepare.mockImplementation((sql: string) => {
    const flat = sql.replace(/\s+/g, ' ');
    if (flat.includes('SELECT boat_id, rank, frozen_position, frozen_status')) {
      return { all: () => rows };
    }
    return { all: () => [], run: () => ({ changes: 0 }) };
  });
}

beforeEach(() => {
  raceAssignmentSnapshots.clear();
  mockPrepare.mockReset();
});

describe('loadPersistedAssignmentSnapshot legacy rows (RULE-M21)', () => {
  it('rebuilds the frozen place from `rank` when the migrated columns are NULL', () => {
    // A row written before ensureRaceAssignmentSnapshotsColumns ran has both new
    // columns NULL. Those snapshots recorded only the boat ORDER, in the 0-based
    // `rank` column. If they loaded as position null, compareSeededRows (which
    // coalesces null to MAX_SAFE_INTEGER) would find every boat equal and fall
    // through to national letter + sail number — silently replacing the frozen
    // order with sail-number order.
    setupRows([
      { boat_id: 'B7', rank: 0, frozen_position: null, frozen_status: null },
      { boat_id: 'B3', rank: 1, frozen_position: null, frozen_status: null },
      { boat_id: 'B9', rank: 2, frozen_position: null, frozen_status: null },
    ]);

    const frozen = loadPersistedAssignmentSnapshot(500);

    expect(frozen?.get('B7')).toEqual({ position: 1, status: 'FINISHED' });
    expect(frozen?.get('B3')).toEqual({ position: 2, status: 'FINISHED' });
    expect(frozen?.get('B9')).toEqual({ position: 3, status: 'FINISHED' });

    // The rebuilt positions must be distinct, so the rank order survives.
    const positions = [...(frozen?.values() ?? [])].map((row) => row.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('keeps migrated values and only fills in the NULL ones', () => {
    setupRows([
      { boat_id: 'B1', rank: 0, frozen_position: 1, frozen_status: 'FINISHED' },
      { boat_id: 'B2', rank: 1, frozen_position: 4, frozen_status: 'ZFP' },
      { boat_id: 'B3', rank: 2, frozen_position: null, frozen_status: null },
    ]);

    const frozen = loadPersistedAssignmentSnapshot(500);

    expect(frozen?.get('B1')).toEqual({ position: 1, status: 'FINISHED' });
    expect(frozen?.get('B2')).toEqual({ position: 4, status: 'ZFP' });
    expect(frozen?.get('B3')).toEqual({ position: 3, status: 'FINISHED' });
  });

  it('returns null when the race has no persisted rows', () => {
    setupRows([]);
    expect(loadPersistedAssignmentSnapshot(500)).toBeNull();
  });
});

describe('unshieldBoatFromAssignmentSnapshot', () => {
  it('drops only the named boat and leaves the rest shielded', () => {
    setupRows([]);
    raceAssignmentSnapshots.set(
      500,
      new Map([
        ['B1', { position: 1, status: 'FINISHED' }],
        ['B2', { position: 2, status: 'FINISHED' }],
      ]),
    );

    unshieldBoatFromAssignmentSnapshot(500, 'B1');

    expect(raceAssignmentSnapshots.get(500)?.has('B1')).toBe(false);
    expect(raceAssignmentSnapshots.get(500)?.get('B2')).toEqual({
      position: 2,
      status: 'FINISHED',
    });
  });

  it('is a no-op for a boat that is not shielded', () => {
    setupRows([]);
    raceAssignmentSnapshots.set(
      500,
      new Map([['B1', { position: 1, status: 'FINISHED' }]]),
    );

    unshieldBoatFromAssignmentSnapshot(500, 'B2');

    expect(raceAssignmentSnapshots.get(500)?.has('B1')).toBe(true);
  });
});
