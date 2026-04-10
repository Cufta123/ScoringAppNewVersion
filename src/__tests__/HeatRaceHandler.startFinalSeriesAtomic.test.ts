export {};

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
  },
}));

const insertedHeats: Array<{ eventId: number; name: string; type: string; newId: number }> = [];
const insertedHeatBoats: Array<{ heatId: number; boatId: number }> = [];

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (sqlContains(sql, 'SELECT is_locked FROM Events WHERE event_id = ?')) {
      return { get: jest.fn(() => ({ is_locked: 0 })) };
    }

    if (
      sqlContains(sql, 'SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?')
    ) {
      return {
        all: jest.fn(() => [
          { heat_id: 11, heat_name: 'Heat A1', heat_type: 'Qualifying' },
          { heat_id: 12, heat_name: 'Heat B1', heat_type: 'Qualifying' },
        ]),
      };
    }

    if (sqlContains(sql, 'SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?')) {
      return { get: jest.fn(() => ({ race_count: 1 })) };
    }

    if (
      sqlContains(sql, 'FROM Leaderboard lb') &&
      sqlContains(sql, 'GROUP_CONCAT(sc.points ORDER BY r.race_number) AS race_points')
    ) {
      return {
        all: jest.fn(() => [
          { boat_id: 1, race_points: '2,3', race_statuses: 'FINISHED,FINISHED' },
          { boat_id: 2, race_points: '4,4', race_statuses: 'FINISHED,FINISHED' },
          { boat_id: 3, race_points: '1,4', race_statuses: 'FINISHED,FINISHED' },
          { boat_id: 4, race_points: '1,1', race_statuses: 'WTH,FINISHED' },
        ]),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)')) {
      return {
        run: jest.fn((eventId: number, name: string, type: string) => {
          const newId = 901 + insertedHeats.length;
          insertedHeats.push({ eventId, name, type, newId });
          return { lastInsertRowid: newId, changes: 1 };
        }),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')) {
      return {
        run: jest.fn((heatId: number, boatId: number) => {
          insertedHeatBoats.push({ heatId, boatId });
          return { changes: 1 };
        }),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
  transaction: jest.fn((fn: () => any) => fn),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

describe('HeatRaceHandler startFinalSeriesAtomic', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;
    dbMock.prepare.mockClear();
    dbMock.transaction.mockClear();
  });

  it('creates all final fleets and assignments inside one DB transaction', async () => {
    const handler = handlerRegistry.startFinalSeriesAtomic;
    const result = await handler({}, 77);

    expect(result).toEqual({ success: true, createdHeats: 2, assignedBoats: 4 });
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);

    expect(insertedHeats).toEqual([
      { eventId: 77, name: 'Final Gold', type: 'Final', newId: 901 },
      { eventId: 77, name: 'Final Silver', type: 'Final', newId: 902 },
    ]);

    // B4 is WTH and must be pushed to the last fleet.
    expect(insertedHeatBoats).toEqual([
      { heatId: 901, boatId: 1 },
      { heatId: 901, boatId: 3 },
      { heatId: 902, boatId: 2 },
      { heatId: 902, boatId: 4 },
    ]);
  });
});
