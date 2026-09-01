export {};

// BK-5: the remaining un-wrapped write paths (insertRace, insertScore,
// updateRaceResult) must run their writes — and, where applicable, the
// leaderboard recompute — inside ONE db.transaction(), so a mid-write failure
// rolls back instead of leaving an orphan race / double-INSERT / stale
// leaderboard. This file uses the same op-log mock style as
// leaderboardRecompute.test.ts: `transaction` pushes TX_START/TX_END markers
// and every prepared write pushes an op, so the exact ordering is asserted.

type PrepareStatement = {
  get?: (...args: any[]) => any;
  all?: (...args: any[]) => any[];
  run?: (...args: any[]) => any;
};

const handlerRegistry: Record<string, (...args: any[]) => any> = {};
const ops: string[] = [];

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
  },
}));

// Spy on the recompute so we can assert it runs INSIDE the transaction.
jest.mock('../main/functions/leaderboardRecompute', () => ({
  recomputeEventLeaderboard: () => {
    ops.push('RECOMPUTE');
  },
  recomputeFinalLeaderboard: () => {
    ops.push('RECOMPUTE FINAL');
  },
}));

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const contains = (sql: string, fragment: string) =>
  norm(sql).includes(fragment);

// 0 = generic UPDATE changes 0 (so insertScore takes the INSERT branch);
// tests flip this to 1 for updateRaceResult's UPDATE.
let updateChanges = 0;

const dbMock = {
  transaction: jest.fn((fn: (...args: any[]) => any) => (...args: any[]) => {
    ops.push('TX_START');
    const result = fn(...args);
    ops.push('TX_END');
    return result;
  }),
  prepare: jest.fn((sql: string): PrepareStatement => {
    // insertRace: create the race row.
    if (contains(sql, 'INSERT INTO Races')) {
      return {
        run: () => {
          ops.push('INSERT Races');
          return { lastInsertRowid: 777, changes: 1 };
        },
      };
    }

    // seedRaceWithDefaultDnsScores: heat meta (event_id, heat_type).
    if (
      contains(sql, 'SELECT event_id, heat_type FROM Heats WHERE heat_id = ?')
    ) {
      return { get: () => ({ event_id: 99, heat_type: 'Qualifying' }) };
    }
    // insertRace: heat existence check.
    if (contains(sql, 'SELECT event_id FROM Heats WHERE heat_id = ?')) {
      return { get: () => ({ event_id: 99 }) };
    }

    // updateRaceResult: heat row for the race being edited.
    if (contains(sql, 'SELECT h.heat_id, h.heat_type FROM Heats h')) {
      return { get: () => ({ heat_id: 77, heat_type: 'Qualifying' }) };
    }

    // lockDiscardProfileForRace: race -> event/heat_type.
    if (
      contains(sql, 'SELECT h.event_id, h.heat_type') &&
      contains(sql, 'FROM Races r')
    ) {
      return { get: () => ({ event_id: 99, heat_type: 'Qualifying' }) };
    }
    // insertScore: race existence check (event_id only).
    if (contains(sql, 'SELECT h.event_id') && contains(sql, 'FROM Races r')) {
      return { get: () => ({ event_id: 99 }) };
    }

    if (contains(sql, 'SELECT MAX(boat_count)')) {
      return { get: () => ({ max_boats: 10 }) };
    }
    if (contains(sql, 'SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')) {
      return { all: () => [{ boat_id: 1 }, { boat_id: 2 }, { boat_id: 3 }] };
    }
    if (contains(sql, 'SELECT position, COALESCE(status')) {
      return { get: () => ({ position: 3, status: 'FINISHED' }) };
    }

    // seed DNS write (status literal 'DNS').
    if (
      contains(sql, 'UPDATE Scores SET position = ?, points = ?, status =') &&
      contains(sql, "'DNS'")
    ) {
      return {
        run: () => {
          ops.push('UPDATE DNS');
          return { changes: 0 };
        },
      };
    }
    if (contains(sql, "VALUES (?, ?, ?, ?, 'DNS')")) {
      return {
        run: () => {
          ops.push('INSERT DNS');
          return { changes: 1 };
        },
      };
    }

    // Generic per-boat score write (insertScore / updateRaceResult).
    if (
      contains(
        sql,
        'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
      )
    ) {
      return {
        run: () => {
          ops.push('UPDATE Scores');
          return { changes: updateChanges };
        },
      };
    }
    if (
      contains(
        sql,
        'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
      )
    ) {
      return {
        run: () => {
          ops.push('INSERT Scores');
          return { lastInsertRowid: 333, changes: 1 };
        },
      };
    }

    if (contains(sql, 'UPDATE Events SET shrs_discard_locked_qualifying')) {
      return {
        run: () => {
          ops.push('LOCK Discard');
          return { changes: 1 };
        },
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${norm(sql)}`);
  }),
};

jest.mock('../../public/Database/DBManager', () => ({ db: dbMock }));

describe('HeatRaceHandler transaction boundaries (BK-5)', () => {
  beforeAll(() => {
    // eslint-disable-next-line global-require
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    ops.length = 0;
    updateChanges = 0;
    dbMock.prepare.mockClear();
    dbMock.transaction.mockClear();
  });

  it('insertRace commits the race INSERT and its DNS seed inside one transaction', async () => {
    await handlerRegistry.insertRace({}, 55, 3);

    expect(ops[0]).toBe('TX_START');
    expect(ops[ops.length - 1]).toBe('TX_END');

    const outerEnd = ops.lastIndexOf('TX_END');
    const insertRaceIdx = ops.indexOf('INSERT Races');
    // The race INSERT happens inside the outer transaction.
    expect(insertRaceIdx).toBeGreaterThan(0);
    expect(insertRaceIdx).toBeLessThan(outerEnd);

    // Every DNS score write also happens inside the same outer transaction.
    const dnsWrites = ops.filter((op) => op === 'INSERT DNS');
    expect(dnsWrites).toHaveLength(3);
    ops.forEach((op, i) => {
      if (op === 'INSERT DNS') {
        expect(i).toBeGreaterThan(insertRaceIdx);
        expect(i).toBeLessThan(outerEnd);
      }
    });
  });

  it('insertScore commits the UPDATE-or-INSERT and discard lock inside one transaction', async () => {
    await handlerRegistry.insertScore({}, 500, 42, 2, 2, 'DNS');

    expect(ops).toEqual([
      'TX_START',
      'UPDATE Scores',
      'INSERT Scores',
      'LOCK Discard',
      'TX_END',
    ]);
  });

  it('updateRaceResult commits the position UPDATEs, discard lock and recompute inside one transaction', async () => {
    updateChanges = 1;
    await handlerRegistry.updateRaceResult(
      {},
      99,
      500,
      'B1',
      3,
      false,
      'FINISHED',
    );

    expect(ops).toEqual([
      'TX_START',
      'UPDATE Scores',
      'LOCK Discard',
      'RECOMPUTE',
      'TX_END',
    ]);
  });
});
