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

const runCalls: Array<{ sql: string; args: any[] }> = [];
let updateChanges = 1;
let isLocked = 0;

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (
      sqlContains(sql, 'SELECT h.event_id') &&
      sqlContains(sql, 'FROM Races r')
    ) {
      return {
        get: jest.fn(() => ({ event_id: 99 })),
      };
    }

    if (sqlContains(sql, 'SELECT is_locked FROM Events WHERE event_id = ?')) {
      return {
        get: jest.fn(() => ({ is_locked: isLocked })),
      };
    }

    if (sqlContains(sql, 'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { changes: updateChanges };
        }),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { lastInsertRowid: 333, changes: 1 };
        }),
      };
    }

    if (
      sqlContains(sql, 'SELECT score_id, position') &&
      sqlContains(sql, "WHERE race_id = ? AND status = 'FINISHED'")
    ) {
      return {
        all: jest.fn(() => []),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

describe('HeatRaceHandler insertScore upsert behavior', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    runCalls.length = 0;
    updateChanges = 1;
    isLocked = 0;
    dbMock.prepare.mockClear();
  });

  it('updates existing race/boat score row without inserting duplicate', async () => {
    const handler = handlerRegistry.insertScore;

    await handler({}, 500, 42, 2, 2, 'FINISHED');

    const insertCalls = runCalls.filter((call) =>
      sqlContains(call.sql, 'INSERT INTO Scores (race_id, boat_id, position, points, status)'),
    );

    expect(insertCalls).toHaveLength(0);
  });

  it('inserts a row when no existing race/boat score row exists', async () => {
    updateChanges = 0;
    const handler = handlerRegistry.insertScore;

    await handler({}, 500, 42, 3, 7, 'DNS');

    const insertCalls = runCalls.filter((call) =>
      sqlContains(call.sql, 'INSERT INTO Scores (race_id, boat_id, position, points, status)'),
    );

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].args).toEqual([500, 42, 3, 7, 'DNS']);
  });

  it('rejects insertScore when event is locked', async () => {
    isLocked = 1;
    const handler = handlerRegistry.insertScore;

    await expect(
      handler({}, 500, 42, 2, 2, 'FINISHED'),
    ).rejects.toThrow('Cannot insert score for locked event.');
  });
});
