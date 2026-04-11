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
let isLocked = 0;
let missingScoreRows: Array<{ race_id: number; boat_id: number }> = [];

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (
      sqlContains(sql, 'FROM Races r') &&
      sqlContains(sql, 'LEFT JOIN Scores s ON s.race_id = r.race_id AND s.boat_id = hb.boat_id')
    ) {
      return {
        all: jest.fn(() => missingScoreRows),
      };
    }

    if (sqlContains(sql, 'SELECT event_id FROM Heats WHERE heat_id = ?')) {
      return {
        get: jest.fn(() => ({ event_id: 99 })),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { lastInsertRowid: 777, changes: 1 };
        }),
      };
    }

    if (sqlContains(sql, 'SELECT event_id, heat_type FROM Heats WHERE heat_id = ?')) {
      return {
        get: jest.fn(() => ({ event_id: 99, heat_type: 'Qualifying' })),
      };
    }

    if (sqlContains(sql, 'SELECT MAX(boat_count) AS max_boats')) {
      return {
        get: jest.fn(() => ({ max_boats: 4 })),
      };
    }

    if (sqlContains(sql, 'SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')) {
      return {
        all: jest.fn(() => [{ boat_id: 1 }, { boat_id: 2 }, { boat_id: 3 }]),
      };
    }

    if (sqlContains(sql, 'UPDATE Scores') && sqlContains(sql, 'WHERE race_id = ? AND boat_id = ?')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { changes: 0 };
        }),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Scores (race_id, boat_id, position, points, status)')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { changes: 1 };
        }),
      };
    }

    if (sqlContains(sql, 'SELECT is_locked FROM Events WHERE event_id = ?')) {
      return {
        get: jest.fn(() => ({ is_locked: isLocked })),
      };
    }

    if (sqlContains(sql, 'DELETE FROM Leaderboard WHERE event_id = ?')) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (sqlContains(sql, 'SELECT boat_id, SUM(points) as total_points_event')) {
      return {
        all: jest.fn(() => []),
      };
    }

    if (sqlContains(sql, 'SELECT') && sqlContains(sql, 'FROM Leaderboard lb')) {
      return {
        all: jest.fn(() => [
          {
            boat_id: 123,
            total_points_event: 20,
            place: 1,
            boat_number: '185',
            boat_type: 'Kantun 2',
            name: 'Grant',
            surname: 'Larry',
            country: 'USA',
            race_positions: '10,10',
            race_points: '10,10',
            race_ids: '501,502',
            race_statuses: 'RDG1,NSC',
          },
        ]),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
  transaction: jest.fn((fn: (...args: any[]) => any) => fn),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

describe('HeatRaceHandler insertRace default DNS scoring', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    runCalls.length = 0;
    isLocked = 0;
    missingScoreRows = [];
    dbMock.prepare.mockClear();
  });

  it('creates default DNS scores for all boats in the heat (A2.2 safety)', async () => {
    const handler = handlerRegistry.insertRace;
    const result = await handler({}, 55, 3);

    expect(result.lastInsertRowid).toBe(777);

    const dnsInserts = runCalls.filter((call) =>
      sqlContains(call.sql, 'INSERT INTO Scores (race_id, boat_id, position, points, status)'),
    );

    expect(dnsInserts).toHaveLength(3);
    expect(dnsInserts.map((c) => c.args)).toEqual(
      expect.arrayContaining([
        [777, 1, 5, 5],
        [777, 2, 5, 5],
        [777, 3, 5, 5],
      ]),
    );
  });

  it('rejects insertRace when event is locked', async () => {
    isLocked = 1;
    const handler = handlerRegistry.insertRace;

    await expect(handler({}, 55, 3)).rejects.toThrow(
      'Cannot insert race for locked event.',
    );
  });

  it('repairs missing qualifying score rows as DNS before readLeaderboard response', async () => {
    missingScoreRows = [{ race_id: 502, boat_id: 123 }];

    const handler = handlerRegistry.readLeaderboard;
    const rows = await handler({}, 42);

    expect(rows).toHaveLength(1);

    const dnsInserts = runCalls.filter((call) =>
      sqlContains(
        call.sql,
        'INSERT INTO Scores (race_id, boat_id, position, points, status)',
      ),
    );
    expect(dnsInserts).toHaveLength(1);
    expect(dnsInserts[0].args).toEqual([502, 123, 5, 5]);

    const preparedSql = dbMock.prepare.mock.calls.map((call) => String(call[0]));
    expect(
      preparedSql.some((sql) => sqlContains(sql, 'DELETE FROM Leaderboard WHERE event_id = ?')),
    ).toBe(true);
  });
});
