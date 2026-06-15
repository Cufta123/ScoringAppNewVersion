export {};

// Regression tests for undoLatestHeatRedistribution. The "Undo Heat
// Redistribution" button is shown whenever an event has >= 2 heat groups, even
// before any redistribution has happened, so the handler must refuse to delete
// the first round of heats (data-loss guard) and must also refuse once the
// latest round already has scored races.

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

type Heat = { heat_id: number; heat_name: string };
const state = {
  heats: [] as Heat[],
  raceCountByHeat: {} as Record<number, number>,
  deletedHeatIds: [] as number[],
  deletedHeatBoatHeatIds: [] as number[],
};

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const dbMock = {
  transaction: (fn: (...args: any[]) => any) => fn,
  prepare: (rawSql: string): PrepareStatement => {
    const sql = norm(rawSql);

    if (
      sql.startsWith('SELECT heat_name, heat_id FROM Heats') &&
      sql.includes("heat_type = 'Qualifying'")
    ) {
      return { all: () => state.heats };
    }
    if (sql.includes('COUNT(*) as race_count FROM Races')) {
      return {
        get: (heatId: number) => ({
          race_count: state.raceCountByHeat[heatId] || 0,
        }),
      };
    }
    if (sql.startsWith('DELETE FROM Heat_Boat')) {
      return {
        run: (heatId: number) => {
          state.deletedHeatBoatHeatIds.push(heatId);
          return { changes: 1 };
        },
      };
    }
    if (sql.startsWith('DELETE FROM Heats')) {
      return {
        run: (heatId: number) => {
          state.deletedHeatIds.push(heatId);
          return { changes: 1 };
        },
      };
    }
    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  },
};

jest.mock('../../public/Database/DBManager', () => ({ db: dbMock }));

describe('undoLatestHeatRedistribution data-loss guard', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    state.heats = [];
    state.raceCountByHeat = {};
    state.deletedHeatIds = [];
    state.deletedHeatBoatHeatIds = [];
  });

  it('refuses to delete the first round when no redistribution exists', async () => {
    state.heats = [
      { heat_id: 1, heat_name: 'Heat A1' },
      { heat_id: 2, heat_name: 'Heat B1' },
    ];

    await expect(
      handlerRegistry.undoLatestHeatRedistribution({}, 5),
    ).rejects.toThrow(/no heat redistribution to undo/i);

    // Critically, nothing was deleted.
    expect(state.deletedHeatIds).toEqual([]);
    expect(state.deletedHeatBoatHeatIds).toEqual([]);
  });

  it('removes only the latest round when a redistribution exists', async () => {
    state.heats = [
      { heat_id: 1, heat_name: 'Heat A1' },
      { heat_id: 2, heat_name: 'Heat B1' },
      { heat_id: 3, heat_name: 'Heat A2' },
      { heat_id: 4, heat_name: 'Heat B2' },
    ];

    const result = await handlerRegistry.undoLatestHeatRedistribution({}, 5);

    expect(result).toMatchObject({ success: true, removedHeats: 2 });
    // Only the second-round heats are deleted; the first round is untouched.
    expect(state.deletedHeatIds.sort()).toEqual([3, 4]);
    expect(state.deletedHeatIds).not.toContain(1);
    expect(state.deletedHeatIds).not.toContain(2);
  });

  it('refuses to undo when the latest round already has scored races', async () => {
    state.heats = [
      { heat_id: 1, heat_name: 'Heat A1' },
      { heat_id: 2, heat_name: 'Heat B1' },
      { heat_id: 3, heat_name: 'Heat A2' },
      { heat_id: 4, heat_name: 'Heat B2' },
    ];
    state.raceCountByHeat = { 3: 1 };

    await expect(
      handlerRegistry.undoLatestHeatRedistribution({}, 5),
    ).rejects.toThrow(/already contain races/i);
    expect(state.deletedHeatIds).toEqual([]);
  });
});
