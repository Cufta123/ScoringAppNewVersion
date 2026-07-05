export {};

// Regression test for transferBoatBetweenHeats: the DELETE (from source heat)
// and INSERT (into target heat) must run in a single transaction, so a failing
// insert can never leave the boat removed from both heats.

type PrepareStatement = {
  get?: (...args: any[]) => any;
  all?: (...args: any[]) => any[];
  run?: (...args: any[]) => any;
};

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
}));

// In-memory Heat_Boat rows; the transaction mock only commits the inner writes
// if the callback completes without throwing.
const state = {
  rows: [] as Array<{ heat_id: number; boat_id: number }>,
  heats: {} as Record<number, { event_id: number }>,
  failInsert: false,
};

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const dbMock = {
  // Mimic better-sqlite3: run the callback against a snapshot and roll back on throw.
  transaction: (fn: (...args: any[]) => any) => {
    return (...args: any[]) => {
      const snapshot = state.rows.map((r) => ({ ...r }));
      try {
        return fn(...args);
      } catch (error) {
        state.rows = snapshot;
        throw error;
      }
    };
  },
  prepare: (rawSql: string): PrepareStatement => {
    const sql = norm(rawSql);
    if (sql.startsWith('SELECT event_id FROM Heats')) {
      return {
        get: (heatId: number) => state.heats[heatId],
      };
    }
    if (sql.includes('COUNT(*) as count FROM Heat_Boat')) {
      return {
        get: (heatId: number) => ({
          count: state.rows.filter((r) => r.heat_id === heatId).length,
        }),
      };
    }
    if (sql.startsWith('DELETE FROM Heat_Boat')) {
      return {
        run: (heatId: number, boatId: number) => {
          const before = state.rows.length;
          state.rows = state.rows.filter(
            (r) => !(r.heat_id === heatId && r.boat_id === boatId),
          );
          return { changes: before - state.rows.length };
        },
      };
    }
    if (sql.startsWith('INSERT INTO Heat_Boat')) {
      return {
        run: (heatId: number, boatId: number) => {
          if (state.failInsert) {
            throw new Error('Simulated insert failure');
          }
          state.rows.push({ heat_id: heatId, boat_id: boatId });
          return { changes: 1, lastInsertRowid: state.rows.length };
        },
      };
    }
    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  },
};

jest.mock('../../public/Database/DBManager', () => ({ db: dbMock }));

describe('transferBoatBetweenHeats atomicity', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    state.rows = [{ heat_id: 1, boat_id: 42 }];
    state.heats = { 1: { event_id: 5 }, 2: { event_id: 5 } };
    state.failInsert = false;
  });

  it('moves the boat from the source heat to the target heat', async () => {
    const result = await handlerRegistry.transferBoatBetweenHeats({}, 1, 2, 42);

    expect(result).toEqual({ success: true });
    expect(state.rows).toEqual([{ heat_id: 2, boat_id: 42 }]);
  });

  it('keeps the boat in the source heat when the insert fails', async () => {
    state.failInsert = true;

    await expect(
      handlerRegistry.transferBoatBetweenHeats({}, 1, 2, 42),
    ).rejects.toThrow(/insert failure/i);

    // Rolled back: the boat is still in its original heat, not lost.
    expect(state.rows).toEqual([{ heat_id: 1, boat_id: 42 }]);
  });

  it('is a no-op when the target heat is the source heat', async () => {
    const result = await handlerRegistry.transferBoatBetweenHeats({}, 1, 1, 42);

    expect(result).toEqual({ success: true });
    // No delete+insert churn: the row is untouched.
    expect(state.rows).toEqual([{ heat_id: 1, boat_id: 42 }]);
  });

  it('refuses to transfer into a heat that already has 20 boats (SHRS cap)', async () => {
    state.rows = [
      { heat_id: 1, boat_id: 42 },
      ...Array.from({ length: 20 }, (_v, i) => ({
        heat_id: 2,
        boat_id: 100 + i,
      })),
    ];

    await expect(
      handlerRegistry.transferBoatBetweenHeats({}, 1, 2, 42),
    ).rejects.toThrow(/more than 20 boats/i);
    // The boat stays where it was.
    expect(state.rows).toContainEqual({ heat_id: 1, boat_id: 42 });
  });

  it('refuses to transfer between heats of different events', async () => {
    state.heats = { 1: { event_id: 5 }, 2: { event_id: 6 } };

    await expect(
      handlerRegistry.transferBoatBetweenHeats({}, 1, 2, 42),
    ).rejects.toThrow(/different events/i);
    expect(state.rows).toEqual([{ heat_id: 1, boat_id: 42 }]);
  });
});
