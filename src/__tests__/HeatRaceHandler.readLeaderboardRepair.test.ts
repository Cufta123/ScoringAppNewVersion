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
let missingScoreRows: Array<{ race_id: number; boat_id: number }> = [];

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (
      sqlContains(sql, 'FROM Races r') &&
      sqlContains(
        sql,
        'LEFT JOIN Scores s ON s.race_id = r.race_id AND s.boat_id = hb.boat_id',
      )
    ) {
      return {
        all: jest.fn(() => missingScoreRows),
      };
    }

    if (sqlContains(sql, 'SELECT MAX(boat_count) AS max_boats')) {
      return {
        get: jest.fn(() => ({ max_boats: 4 })),
      };
    }

    if (
      sqlContains(
        sql,
        'INSERT INTO Scores (race_id, boat_id, position, points, status)',
      )
    ) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { changes: 1 };
        }),
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

    if (
      sqlContains(
        sql,
        'INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place)',
      ) &&
      sqlContains(sql, 'ON CONFLICT(boat_id, event_id) DO UPDATE SET')
    ) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
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

    if (sqlContains(sql, "COALESCE(s.status, 'FINISHED') AS status")) {
      return { all: jest.fn(() => []) };
    }

    // Results of a round still being sailed (none here).
    if (sqlContains(sql, 'cr.race_id IS NULL')) {
      return { all: jest.fn(() => []) };
    }

    // RRS A5.1 / SHRS 5.3 DNC backfill: answering "no qualifying heats" makes
    // it a no-op. Present only so the repair path can run; the DNS repair is
    // what this file asserts (dncBackfill.integration covers the backfill).
    if (
      sqlContains(
        sql,
        "SELECT heat_id, heat_name FROM Heats WHERE event_id = ? AND heat_type = 'Qualifying'",
      )
    ) {
      return { all: jest.fn(() => []) };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
  transaction: jest.fn((fn: (...args: any[]) => any) => fn),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

describe('HeatRaceHandler readLeaderboard DNS repair', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    runCalls.length = 0;
    missingScoreRows = [];
    dbMock.prepare.mockClear();
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

    const preparedSql = dbMock.prepare.mock.calls.map((call) =>
      String(call[0]),
    );
    expect(
      preparedSql.some((sql) =>
        sqlContains(sql, 'DELETE FROM Leaderboard WHERE event_id = ?'),
      ),
    ).toBe(true);
  });
});
