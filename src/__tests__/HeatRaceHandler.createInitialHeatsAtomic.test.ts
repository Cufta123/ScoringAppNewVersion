export {};

// BK-4: createInitialHeatsAtomic must reject a heat-creation request whose boats
// share a sail number (or have empty sail numbers) instead of silently dropping
// one of them from the serpentine assignment.

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

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

type BoatRow = {
  boat_id: number;
  sail_number: string | number;
  country: string;
};
let boats: BoatRow[];
const insertedHeats: Array<{
  event_id: number;
  heat_name: string;
  heat_type: string;
}> = [];
const insertedHeatBoats: Array<{ heat_id: number; boat_id: number }> = [];

const dbMock = {
  transaction: jest.fn((fn: (...args: any[]) => any) => fn),
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (
      sqlContains(sql, 'SELECT COUNT(*) AS count FROM Heats WHERE event_id = ?')
    ) {
      return { get: jest.fn(() => ({ count: 0 })) };
    }
    if (sqlContains(sql, 'SELECT b.boat_id, b.sail_number, b.country')) {
      return { all: jest.fn(() => boats.map((b) => ({ ...b }))) };
    }
    if (
      sqlContains(
        sql,
        'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
      )
    ) {
      return {
        run: jest.fn(
          (event_id: number, heat_name: string, heat_type: string) => {
            insertedHeats.push({ event_id, heat_name, heat_type });
            return { lastInsertRowid: 100 + insertedHeats.length, changes: 1 };
          },
        ),
      };
    }
    if (
      sqlContains(sql, 'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')
    ) {
      return {
        run: jest.fn((heat_id: number, boat_id: number) => {
          insertedHeatBoats.push({ heat_id, boat_id });
          return { changes: 1 };
        }),
      };
    }
    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
};

jest.mock('../../public/Database/DBManager', () => ({ db: dbMock }));

describe('createInitialHeatsAtomic duplicate-sail guard (BK-4)', () => {
  beforeAll(() => {
    // eslint-disable-next-line global-require
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    boats = [
      { boat_id: 1, sail_number: '101', country: 'CRO' },
      { boat_id: 2, sail_number: '102', country: 'CRO' },
      { boat_id: 3, sail_number: '103', country: 'CRO' },
    ];
    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;
    dbMock.prepare.mockClear();
    dbMock.transaction.mockClear();
  });

  it('rejects heat creation when two boats share a sail number', async () => {
    boats = [
      { boat_id: 1, sail_number: '101', country: 'CRO' },
      { boat_id: 2, sail_number: '101', country: 'AUS' },
    ];

    await expect(
      handlerRegistry.createInitialHeatsAtomic({}, 1, 2),
    ).rejects.toThrow(/duplicate sail number/i);

    expect(insertedHeats).toHaveLength(0);
    expect(insertedHeatBoats).toHaveLength(0);
  });

  it('rejects heat creation when two boats have an empty sail number', async () => {
    boats = [
      { boat_id: 1, sail_number: '', country: 'CRO' },
      { boat_id: 2, sail_number: '', country: 'AUS' },
    ];

    await expect(
      handlerRegistry.createInitialHeatsAtomic({}, 1, 2),
    ).rejects.toThrow(/duplicate sail number/i);
  });

  it('still creates heats for boats with distinct sail numbers', async () => {
    const result = await handlerRegistry.createInitialHeatsAtomic({}, 1, 2);

    expect(result).toMatchObject({
      success: true,
      createdHeats: 2,
      assignedBoats: 3,
    });
    expect(insertedHeats).toHaveLength(2);
    expect(insertedHeatBoats).toHaveLength(3);
  });
});
