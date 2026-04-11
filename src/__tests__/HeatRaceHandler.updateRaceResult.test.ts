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

type Scenario = {
  eventId: number;
  isLocked: number;
  heatType: string;
  maxBoats: number;
  currentPosition: number;
  currentStatus: string;
  finishedRows: Array<{ score_id: number; position: number }>;
};

let currentScenario: Scenario;
const runCalls: Array<{ sql: string; args: any[] }> = [];

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
        get: jest.fn(() => ({ event_id: currentScenario.eventId, heat_type: currentScenario.heatType })),
      };
    }

    if (
      sqlContains(sql, 'SELECT h.heat_id, h.heat_type FROM Heats h') &&
      sqlContains(sql, 'JOIN Races r ON r.heat_id = h.heat_id')
    ) {
      return {
        get: jest.fn(() => ({ heat_id: 77, heat_type: currentScenario.heatType })),
      };
    }

    if (sqlContains(sql, 'SELECT h.heat_type FROM Heats h')) {
      return {
        get: jest.fn(() => ({
          heat_type: currentScenario.heatType,
          event_id: currentScenario.eventId,
        })),
      };
    }

    if (sqlContains(sql, 'SELECT MAX(boat_count) AS max_boats')) {
      return {
        get: jest.fn(() => ({ max_boats: currentScenario.maxBoats })),
      };
    }

    if (sqlContains(sql, 'SELECT position, COALESCE(status')) {
      return {
        get: jest.fn(() => ({
          position: currentScenario.currentPosition,
          status: currentScenario.currentStatus,
        })),
      };
    }

    if (
      sqlContains(sql, 'SELECT score_id, position') &&
      sqlContains(sql, "WHERE race_id = ? AND status = 'FINISHED'")
    ) {
      return {
        all: jest.fn(() => currentScenario.finishedRows),
      };
    }

    if (
      sqlContains(sql, 'FROM Heat_Boat hb') &&
      sqlContains(sql, 'LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id')
    ) {
      return {
        all: jest.fn(() => []),
      };
    }

    if (sqlContains(sql, 'UPDATE Events SET shrs_discard_locked_qualifying = 1 WHERE event_id = ?')) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (sqlContains(sql, 'UPDATE Events SET shrs_discard_locked_final = 1 WHERE event_id = ?')) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (sqlContains(sql, 'DELETE FROM Leaderboard WHERE event_id = ?')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { changes: 1 };
        }),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place)')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { changes: 1 };
        }),
      };
    }

    if (sqlContains(sql, 'SELECT boat_id, SUM(points) as total_points_event')) {
      return {
        all: jest.fn(() => []),
      };
    }

    if (sql.toUpperCase().includes('UPDATE SCORES SET')) {
      return {
        run: jest.fn((...args: any[]) => {
          runCalls.push({ sql, args });
          return { changes: 1 };
        }),
      };
    }

    if (sqlContains(sql, 'SELECT is_locked FROM Events WHERE event_id = ?')) {
      return {
        get: jest.fn(() => ({ is_locked: currentScenario.isLocked })),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
  transaction: jest.fn((cb: (...args: any[]) => any) => (...args: any[]) => cb(...args)),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

function baseScenario(): Scenario {
  return {
    eventId: 99,
    isLocked: 0,
    heatType: 'Qualifying',
    maxBoats: 10,
    currentPosition: 3,
    currentStatus: 'FINISHED',
    finishedRows: [],
  };
}

describe('HeatRaceHandler updateRaceResult scoring edge cases', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    currentScenario = baseScenario();
    runCalls.length = 0;
    dbMock.prepare.mockClear();
  });

  it('scores ZFP as finishingPosition + max(20%,2) with cap at maxBoats+1', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 3, false, 'ZFP');

    const updateMain = runCalls.find((call) =>
      sqlContains(call.sql, 'UPDATE Scores SET position = ?, points = ?, status = ?'),
    );
    expect(updateMain).toBeDefined();
    // maxBoats=10 -> penalty places = 2, ZFP points = 3 + 2 = 5
    expect(updateMain?.args.slice(0, 3)).toEqual([3, 5, 'ZFP']);
  });

  it('caps SCP score at maxBoats+1', async () => {
    currentScenario.maxBoats = 5;
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 5, false, 'SCP');

    const updateMain = runCalls.find((call) =>
      sqlContains(call.sql, 'UPDATE Scores SET position = ?, points = ?, status = ?'),
    );
    // penalty places = max(round(1),2)=2 => 5+2=7, capped to 6
    expect(updateMain?.args.slice(0, 3)).toEqual([5, 6, 'SCP']);
  });

  it('scores T1 as finishingPosition + max(20%,2) with cap at maxBoats+1', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 4, false, 'T1');

    const updateMain = runCalls.find((call) =>
      sqlContains(call.sql, 'UPDATE Scores SET position = ?, points = ?, status = ?'),
    );
    // maxBoats=10 -> penalty places = 2, T1 points = 4 + 2 = 6
    expect(updateMain?.args.slice(0, 3)).toEqual([4, 6, 'T1']);
  });

  it('normalizes RAF to RET penalty scoring', async () => {
    currentScenario.maxBoats = 10;
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 2, false, 'RAF');

    const updateMain = runCalls.find((call) =>
      sqlContains(call.sql, 'UPDATE Scores SET position = ?, points = ?, status = ?'),
    );
    expect(updateMain?.args.slice(0, 3)).toEqual([11, 11, 'RET']);
  });

  it('applies mandatory A6.1 shift when FINISHED -> DSQ', async () => {
    currentScenario.currentPosition = 4;
    currentScenario.currentStatus = 'FINISHED';

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 4, false, 'DSQ');

    const shiftCall = runCalls.find((call) =>
      sqlContains(call.sql, 'WHERE race_id = ? AND status = \'FINISHED\' AND position > ?'),
    );
    expect(shiftCall).toBeDefined();
    expect(shiftCall?.args).toEqual([500, 4]);
  });

  it('applies mandatory A6.1 shift when FINISHED -> RET', async () => {
    currentScenario.currentPosition = 2;
    currentScenario.currentStatus = 'FINISHED';

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 2, false, 'RET');

    const shiftCall = runCalls.find((call) =>
      sqlContains(call.sql, 'WHERE race_id = ? AND status = \'FINISHED\' AND position > ?'),
    );
    expect(shiftCall).toBeDefined();
    expect(shiftCall?.args).toEqual([500, 2]);
  });

  it('does not apply mandatory A6.1 shift when previous status was not FINISHED', async () => {
    currentScenario.currentPosition = 3;
    currentScenario.currentStatus = 'DNS';

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 3, false, 'DSQ');

    const shiftCall = runCalls.find((call) =>
      sqlContains(call.sql, 'WHERE race_id = ? AND status = \'FINISHED\' AND position > ?'),
    );
    expect(shiftCall).toBeUndefined();
  });

  it('applies A7 tie points by averaging tied places', async () => {
    currentScenario.currentPosition = 1;
    currentScenario.currentStatus = 'FINISHED';
    currentScenario.finishedRows = [
      { score_id: 11, position: 1 },
      { score_id: 12, position: 1 },
      { score_id: 13, position: 3 },
    ];

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 1, false, 'FINISHED');

    const tieUpdateCalls = runCalls.filter((call) =>
      sqlContains(call.sql, 'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?'),
    );

    expect(tieUpdateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ args: [1, 1.5, 11] }),
        expect.objectContaining({ args: [1, 1.5, 12] }),
        expect.objectContaining({ args: [3, 3, 13] }),
      ]),
    );
  });

  it('reads latest score row deterministically when duplicate race/boat rows exist', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 2, false, 'FINISHED');

    const selectSql = dbMock.prepare.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sqlContains(sql, 'SELECT position, COALESCE(status'));

    expect(selectSql).toContain('ORDER BY score_id DESC');
    expect(selectSql).toContain('LIMIT 1');
  });

});
