export {};

// Loaded via require in beforeAll (after dbMock is defined) so the module's
// `import { db } from DBManager` resolves the mock, not a TDZ `const`.
let raceAssignmentSnapshots: Map<
  number,
  Map<string, { position: number | null; status: string }>
>;

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
  heatType: string;
  maxBoats: number;
  currentPosition: number;
  currentStatus: string;
  finishedRows: Array<{ score_id: number; position: number; status?: string }>;
  penaltyRowsBehind: Array<{
    score_id: number;
    position: number;
    status: string;
  }>;
  ripplePenaltyRows: Array<{
    score_id: number;
    position: number;
    status: string;
  }>;
  // The race's Scores rows, as applyRaceResultUpdate now loads them before
  // applying the shared raceColumnEdit transformation. Defaults to just the
  // edited boat, which is all the snapshot-shield tests need.
  raceRows?: Array<{
    score_id: number;
    boat_id: string;
    position: number;
    points: number;
    status: string;
  }>;
  // Live ranked rows for the heat/race, as getRankedBoatsInHeatForRace returns
  // them. Used by the SHRS 3.1.5 per-boat freeze tests.
  rankedBoats: Array<{
    boat_id: string;
    position: number | null;
    status: string;
    country?: string;
    sail_number?: string;
  }>;
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
        get: jest.fn(() => ({
          event_id: currentScenario.eventId,
          heat_type: currentScenario.heatType,
        })),
      };
    }

    if (
      sqlContains(sql, 'SELECT h.heat_id, h.heat_type FROM Heats h') &&
      sqlContains(sql, 'JOIN Races r ON r.heat_id = h.heat_id')
    ) {
      return {
        get: jest.fn(() => ({
          heat_id: 77,
          heat_type: currentScenario.heatType,
        })),
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

    if (
      sqlContains(sql, 'SELECT score_id, boat_id, position, points') &&
      sqlContains(sql, 'ORDER BY score_id ASC')
    ) {
      return {
        all: jest.fn(
          () =>
            currentScenario.raceRows ?? [
              {
                score_id: 1,
                boat_id: 'B1',
                position: currentScenario.currentPosition,
                points: currentScenario.currentPosition,
                status: currentScenario.currentStatus,
              },
            ],
        ),
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
      sqlContains(sql, "race_id = ? AND (status = 'FINISHED'")
    ) {
      return {
        all: jest.fn(() => currentScenario.finishedRows),
      };
    }

    if (
      sqlContains(sql, 'SELECT score_id, position, status FROM Scores') &&
      sqlContains(sql, 'AND status IN (') &&
      sqlContains(sql, 'position > ?')
    ) {
      return {
        all: jest.fn(() => currentScenario.penaltyRowsBehind),
      };
    }

    if (
      sqlContains(sql, 'SELECT score_id, position, status FROM Scores') &&
      sqlContains(sql, 'AND status IN (') &&
      sqlContains(sql, 'position BETWEEN ? AND ?')
    ) {
      return {
        all: jest.fn(() => currentScenario.ripplePenaltyRows),
      };
    }

    if (
      sqlContains(sql, 'FROM Heat_Boat hb') &&
      sqlContains(
        sql,
        'LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id',
      )
    ) {
      return {
        all: jest.fn(() => currentScenario.rankedBoats),
      };
    }

    if (
      sqlContains(
        sql,
        'UPDATE Events SET shrs_discard_locked_qualifying = 1 WHERE event_id = ?',
      )
    ) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (
      sqlContains(
        sql,
        'UPDATE Events SET shrs_discard_locked_final = 1 WHERE event_id = ?',
      )
    ) {
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

    if (
      sqlContains(
        sql,
        'INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place)',
      )
    ) {
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

    if (sqlContains(sql, "COALESCE(s.status, 'FINISHED') AS status")) {
      return { all: jest.fn(() => []) };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
  transaction: jest.fn(
    (cb: (...args: any[]) => any) =>
      (...args: any[]) =>
        cb(...args),
  ),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

function baseScenario(): Scenario {
  return {
    eventId: 99,
    heatType: 'Qualifying',
    maxBoats: 10,
    currentPosition: 3,
    currentStatus: 'FINISHED',
    finishedRows: [],
    penaltyRowsBehind: [],
    ripplePenaltyRows: [],
    raceRows: undefined,
    rankedBoats: [],
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

  it('scores ZFP as finishingPosition + 20% (RRS 44.3(c)) with cap at maxBoats+1', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 3, false, 'ZFP');

    const updateMain = runCalls.find((call) =>
      sqlContains(
        call.sql,
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ),
    );
    expect(updateMain).toBeDefined();
    // maxBoats=10 -> 20% = 2 places, ZFP points = 3 + 2 = 5
    expect(updateMain?.args.slice(0, 3)).toEqual([3, 5, 'ZFP']);
  });

  it('caps SCP score at maxBoats+1', async () => {
    currentScenario.maxBoats = 5;
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 5, false, 'SCP');

    const updateMain = runCalls.find((call) =>
      sqlContains(
        call.sql,
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ),
    );
    // maxBoats=5 -> 20% = 1 place => 5+1=6, equals cap maxBoats+1
    expect(updateMain?.args.slice(0, 3)).toEqual([5, 6, 'SCP']);
  });

  it('scores ZFP without artificial minimum in small heats (RRS 44.3(c))', async () => {
    currentScenario.maxBoats = 5;
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 2, false, 'ZFP');

    const updateMain = runCalls.find((call) =>
      sqlContains(
        call.sql,
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ),
    );
    // maxBoats=5 -> 20% = 1 place (no min-2 floor), ZFP points = 2 + 1 = 3
    expect(updateMain?.args.slice(0, 3)).toEqual([2, 3, 'ZFP']);
  });

  it('scores T1 as finishingPosition + 30% (RRS Appendix T1) with cap at maxBoats+1', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 4, false, 'T1');

    const updateMain = runCalls.find((call) =>
      sqlContains(
        call.sql,
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ),
    );
    // maxBoats=10 -> 30% = 3 places, T1 points = 4 + 3 = 7
    expect(updateMain?.args.slice(0, 3)).toEqual([4, 7, 'T1']);
  });

  it('normalizes RAF to RET penalty scoring', async () => {
    currentScenario.maxBoats = 10;
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 2, false, 'RAF');

    const updateMain = runCalls.find((call) =>
      sqlContains(
        call.sql,
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ),
    );
    expect(updateMain?.args.slice(0, 3)).toEqual([11, 11, 'RET']);
  });

  it('does not apply mandatory A6.1 shift when previous status was not FINISHED', async () => {
    currentScenario.currentPosition = 3;
    currentScenario.currentStatus = 'DNS';

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 3, true, 'DSQ');

    const shiftCall = runCalls.find((call) =>
      sqlContains(
        call.sql,
        "WHERE race_id = ? AND status = 'FINISHED' AND position > ?",
      ),
    );
    expect(shiftCall).toBeUndefined();
  });

  it('does not apply mandatory A6.1 shift when status is non-disqualification penalty', async () => {
    currentScenario.currentPosition = 4;
    currentScenario.currentStatus = 'FINISHED';

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 4, true, 'DPI');

    const shiftCall = runCalls.find((call) =>
      sqlContains(
        call.sql,
        "WHERE race_id = ? AND status = 'FINISHED' AND position > ?",
      ),
    );
    expect(shiftCall).toBeUndefined();
  });

  it('keeps RDG position/points as provided without penalty normalization', async () => {
    currentScenario.maxBoats = 5;
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 8, false, 'RDG2');

    const updateMain = runCalls.find((call) =>
      sqlContains(
        call.sql,
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ),
    );
    expect(updateMain?.args.slice(0, 3)).toEqual([8, 8, 'RDG2']);
  });

  it('keeps DPI points as the protest-committee-provided value, not largest-heat+1 (RRS A10 / M9)', async () => {
    // maxBoats=10 => the old bug scored DPI like DSQ at maxBoats+1 = 11.
    // DPI points are set by the PC, so the provided value (2) must stand.
    currentScenario.maxBoats = 10;
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 2, false, 'DPI');

    const updateMain = runCalls.find((call) =>
      sqlContains(
        call.sql,
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ),
    );
    expect(updateMain?.args.slice(0, 3)).toEqual([2, 2, 'DPI']);
  });

  it('rejects unsupported score status', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await expect(handler({}, 99, 500, 'B1', 3, false, 'FOO')).rejects.toThrow(
      'Unsupported score status: FOO',
    );
  });

  it('rejects a 0 / NaN finishing position instead of writing it (BK-6)', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await expect(
      handler({}, 99, 500, 'B1', 0, false, 'FINISHED'),
    ).rejects.toThrow(/must be a positive integer/);
    await expect(
      handler({}, 99, 500, 'B1', Number.NaN, false, 'FINISHED'),
    ).rejects.toThrow(/must be a positive integer/);
  });

  it('rejects a 0 / negative RDG/DPI value (BK-6 / CMP C-23)', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await expect(handler({}, 99, 500, 'B1', 0, false, 'RDG2')).rejects.toThrow(
      /must be a positive number/,
    );
    await expect(handler({}, 99, 500, 'B1', -1, false, 'DPI')).rejects.toThrow(
      /must be a positive number/,
    );
  });

  // RULE-M16 / RRS A6.1: "each boat with a worse finishing place shall be moved
  // up one place." That is mandatory, so it must NOT depend on the leaderboard's
  // "Shift other boats" toggle. This previously asserted the opposite — that a
  // shift-off DSQ left every boat behind it one place too low.
  it('with shifting OFF, a plain place change still edits only the named boat', async () => {
    // The toggle governs the manual place-move ripple, which is a data-entry
    // convenience rather than a rule: moving one finisher must not renumber the
    // rest, even if that leaves a tie or a gap, so the saved result matches the
    // renderer's edit preview exactly.
    currentScenario.currentPosition = 1;
    currentScenario.currentStatus = 'FINISHED';
    currentScenario.finishedRows = [
      { score_id: 11, position: 1, status: 'FINISHED' },
      { score_id: 12, position: 2, status: 'FINISHED' },
      { score_id: 13, position: 3, status: 'FINISHED' },
    ];

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 3, false, 'FINISHED');

    const cascadeCalls = runCalls.filter(
      (call) =>
        sqlContains(
          call.sql,
          "WHERE race_id = ? AND status = 'FINISHED' AND position > ?",
        ) ||
        sqlContains(
          call.sql,
          'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
        ),
    );
    expect(cascadeCalls).toHaveLength(0);
  });

  it('grants RDG without re-ranking other boats even with shifting ON (RRS A6.2)', async () => {
    // Redress adjusts only the redressed boat's score; A6.2 forbids changing
    // any other boat. Even with "shift other boats" ON, an RDG edit must not
    // trigger the displacement or the tie-scoring cascade over the finishers.
    currentScenario.currentPosition = 5;
    currentScenario.currentStatus = 'FINISHED';
    currentScenario.finishedRows = [
      { score_id: 11, position: 1, status: 'FINISHED' },
      { score_id: 12, position: 2, status: 'FINISHED' },
      { score_id: 13, position: 3, status: 'FINISHED' },
    ];

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 4.5, true, 'RDG1');

    const cascadeCalls = runCalls.filter(
      (call) =>
        sqlContains(
          call.sql,
          "WHERE race_id = ? AND status = 'FINISHED' AND position > ?",
        ) ||
        sqlContains(
          call.sql,
          'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
        ),
    );
    expect(cascadeCalls).toHaveLength(0);
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

describe('SHRS 3.1.5 assignment-snapshot invalidation (RULE-M14)', () => {
  beforeAll(() => {
    ({
      raceAssignmentSnapshots,
    } = require('../main/functions/raceAssignmentSnapshot'));
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    currentScenario = baseScenario();
    runCalls.length = 0;
    dbMock.prepare.mockClear();
    raceAssignmentSnapshots.clear();
  });

  it('a protest-committee edit (DSQ) captures the assignment snapshot', async () => {
    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B1', 4, false, 'DSQ');

    // A protest decision is shielded from changing heat assignments (SHRS 3.1.5),
    // so the pre-decision order is snapshotted for the next round.
    expect(raceAssignmentSnapshots.has(500)).toBe(true);
  });

  it('an ordinary correction (FINISHED) unshields only the corrected boat', async () => {
    raceAssignmentSnapshots.set(
      500,
      new Map([
        ['B1', { position: 1, status: 'FINISHED' }],
        ['B2', { position: 2, status: 'FINISHED' }],
      ]),
    );
    const handler = handlerRegistry.updateRaceResult;

    await handler({}, 99, 500, 'B1', 2, false, 'FINISHED');

    // RULE-M21: the corrected boat B1 is un-shielded (its corrected result now
    // drives the next assignment), but B2's protest shield stays intact.
    expect(raceAssignmentSnapshots.has(500)).toBe(true);
    expect(raceAssignmentSnapshots.get(500)?.has('B1')).toBe(false);
    expect(raceAssignmentSnapshots.get(500)?.has('B2')).toBe(true);
  });

  it('an ordinary correction (DNF) also unshields only the corrected boat', async () => {
    raceAssignmentSnapshots.set(
      500,
      new Map([
        ['B1', { position: 1, status: 'FINISHED' }],
        ['B2', { position: 2, status: 'FINISHED' }],
      ]),
    );
    const handler = handlerRegistry.updateRaceResult;

    await handler({}, 99, 500, 'B1', 2, false, 'DNF');

    expect(raceAssignmentSnapshots.has(500)).toBe(true);
    expect(raceAssignmentSnapshots.get(500)?.has('B1')).toBe(false);
    expect(raceAssignmentSnapshots.get(500)?.has('B2')).toBe(true);
  });

  it('clears the snapshot once the last shielded boat is unshielded', async () => {
    raceAssignmentSnapshots.set(
      500,
      new Map([['B1', { position: 1, status: 'FINISHED' }]]),
    );
    const handler = handlerRegistry.updateRaceResult;

    await handler({}, 99, 500, 'B1', 2, false, 'FINISHED');

    expect(raceAssignmentSnapshots.has(500)).toBe(false);
  });

  it('re-freezes a boat that a previous ordinary correction had unshielded', async () => {
    // RULE-M21 regression: the capture guard is per BOAT, not per race. B2 was
    // un-shielded by an earlier race-office correction, so when the protest
    // committee later disqualifies B2 its pre-decision place must be frozen —
    // otherwise the DSQ reorders B2's next-round assignment, which SHRS 3.1.5
    // forbids. A per-race "snapshot already exists" guard skips this.
    raceAssignmentSnapshots.set(
      500,
      new Map([['B1', { position: 1, status: 'FINISHED' }]]),
    );
    currentScenario.rankedBoats = [
      { boat_id: 'B1', position: 1, status: 'FINISHED' },
      { boat_id: 'B2', position: 2, status: 'FINISHED' },
    ];
    currentScenario.raceRows = [
      {
        score_id: 1,
        boat_id: 'B1',
        position: 1,
        points: 1,
        status: 'FINISHED',
      },
      {
        score_id: 2,
        boat_id: 'B2',
        position: 2,
        points: 2,
        status: 'FINISHED',
      },
    ];
    currentScenario.currentPosition = 2;

    const handler = handlerRegistry.updateRaceResult;
    await handler({}, 99, 500, 'B2', 2, false, 'DSQ');

    const frozen = raceAssignmentSnapshots.get(500);
    expect(frozen?.has('B1')).toBe(true);
    // B2's PRE-decision place, not its post-DSQ result.
    expect(frozen?.get('B2')).toEqual({ position: 2, status: 'FINISHED' });
  });

  it('restores the frozen rows of an existing snapshot when the transaction fails', async () => {
    // RULE-M21 regression: the in-memory cache survives a DB rollback, and an
    // unshield MUTATES an existing entry rather than adding one. A guard that
    // only remembers whether the race id was present leaves the un-shielded
    // boat missing from memory while the DB still holds its frozen row.
    raceAssignmentSnapshots.set(
      500,
      new Map([
        ['B1', { position: 1, status: 'FINISHED' }],
        ['B2', { position: 2, status: 'FINISHED' }],
      ]),
    );

    // Run the transaction body (so B1 is actually un-shielded in memory) and
    // only then fail, mirroring a mid-write error that rolls the DB back.
    const failing = jest
      .spyOn(dbMock, 'transaction')
      .mockImplementationOnce((cb: any) => (...args: any[]) => {
        cb(...args);
        throw new Error('forced rollback');
      });

    const handler = handlerRegistry.updateRaceResult;
    await expect(
      handler({}, 99, 500, 'B1', 2, false, 'FINISHED'),
    ).rejects.toThrow(/forced rollback/);
    failing.mockRestore();

    const frozen = raceAssignmentSnapshots.get(500);
    expect(frozen?.has('B1')).toBe(true);
    expect(frozen?.has('B2')).toBe(true);
  });
});
