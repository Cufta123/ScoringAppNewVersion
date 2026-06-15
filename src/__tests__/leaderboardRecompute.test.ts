/* eslint-disable camelcase */
/**
 * Tests for leaderboardRecompute.ts — the glue that rebuilds the Qualifying
 * (Leaderboard) and Final (FinalLeaderboard) tables from the raw Scores rows.
 *
 * The scoring rules themselves live in calculateBoatScores / calculateFinalBoatScores
 * (covered by their own suites), so those are mocked here. What this file pins
 * down is everything leaderboardRecompute is solely responsible for:
 *   - reading the right Scores (heat_type Qualifying vs Final),
 *   - feeding them to the right calculator with the right arguments,
 *   - persisting every returned boat with the correct place / placement_group,
 *   - clearing the previous leaderboard first (delete-before-insert),
 *   - doing all writes inside a single transaction,
 *   - leaving a clean, empty board when there are no scores (SHRS 1.5 / a
 *     reset event), without crashing.
 */
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../main/functions/leaderboardRecompute';
import calculateBoatScores from '../main/functions/calculateBoatScores';
import calculateFinalBoatScores from '../main/functions/calculateFinalBoatScores';
import { db } from '../../public/Database/DBManager';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn(), transaction: jest.fn() },
}));
jest.mock('../main/functions/calculateBoatScores', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../main/functions/calculateFinalBoatScores', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockPrepare = (db as unknown as { prepare: jest.Mock }).prepare;
const mockTransaction = (db as unknown as { transaction: jest.Mock })
  .transaction;
const mockCalcBoat = calculateBoatScores as unknown as jest.Mock;
const mockCalcFinal = calculateFinalBoatScores as unknown as jest.Mock;

type LeaderboardRow = {
  boat_id: any;
  total_points_event: number;
  event_id: any;
  place: number;
};
type FinalRow = {
  boat_id: any;
  total_points_final: number;
  event_id: any;
  placement_group: string;
  place: number;
};

type Harness = {
  ops: string[];
  preparedSql: string[];
  leaderboard: LeaderboardRow[];
  finalLeaderboard: FinalRow[];
};

/**
 * Wire up the db mock from an ordered op-log so tests can assert both the
 * persisted rows and the exact delete/insert/transaction ordering.
 * `qualifyingRows` / `finalRows` are what the recompute SELECT returns.
 */
function installDb(qualifyingRows: any[], finalRows: any[] = []): Harness {
  const h: Harness = {
    ops: [],
    preparedSql: [],
    leaderboard: [],
    finalLeaderboard: [],
  };

  // Mirror better-sqlite3: transaction(fn) returns a function that runs fn.
  mockTransaction.mockImplementation((fn: (...a: any[]) => any) => {
    return (...args: any[]) => {
      h.ops.push('TX_START');
      const result = fn(...args);
      h.ops.push('TX_END');
      return result;
    };
  });

  mockPrepare.mockImplementation((sql: string) => {
    h.preparedSql.push(sql);

    if (sql.includes('DELETE FROM Leaderboard')) {
      return {
        run: () => {
          h.ops.push('DELETE Leaderboard');
          h.leaderboard.length = 0;
        },
      };
    }
    if (sql.includes('DELETE FROM FinalLeaderboard')) {
      return {
        run: () => {
          h.ops.push('DELETE FinalLeaderboard');
          h.finalLeaderboard.length = 0;
        },
      };
    }
    if (sql.includes('INSERT INTO Leaderboard')) {
      return {
        run: (
          boat_id: any,
          total_points_event: number,
          event_id: any,
          place: number,
        ) => {
          h.ops.push('INSERT Leaderboard');
          h.leaderboard.push({ boat_id, total_points_event, event_id, place });
        },
      };
    }
    if (sql.includes('INSERT INTO FinalLeaderboard')) {
      return {
        run: (
          boat_id: any,
          total_points_final: number,
          event_id: any,
          placement_group: string,
          place: number,
        ) => {
          h.ops.push('INSERT FinalLeaderboard');
          h.finalLeaderboard.push({
            boat_id,
            total_points_final,
            event_id,
            placement_group,
            place,
          });
        },
      };
    }
    if (sql.includes("heat_type = 'Qualifying'")) {
      return { all: () => qualifyingRows };
    }
    if (sql.includes("heat_type = 'Final'")) {
      return { all: () => finalRows };
    }
    throw new Error(`Unexpected SQL prepared: ${sql}`);
  });

  return h;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recomputeEventLeaderboard (Qualifying)', () => {
  it('persists one row per boat with totals and places from the calculator', () => {
    const h = installDb([
      { boat_id: 'A', total_points_event: 5, number_of_races: 3 },
      { boat_id: 'B', total_points_event: 8, number_of_races: 3 },
    ]);
    mockCalcBoat.mockReturnValue([
      { boat_id: 'A', totalPoints: 5, place: 1 },
      { boat_id: 'B', totalPoints: 8, place: 2 },
    ]);

    recomputeEventLeaderboard(1);

    expect(h.leaderboard).toEqual([
      { boat_id: 'A', total_points_event: 5, event_id: 1, place: 1 },
      { boat_id: 'B', total_points_event: 8, event_id: 1, place: 2 },
    ]);
  });

  it('reads Qualifying scores and forwards results, event_id and a Map to the calculator', () => {
    const rows = [{ boat_id: 'A', total_points_event: 5, number_of_races: 3 }];
    installDb(rows);
    mockCalcBoat.mockReturnValue([{ boat_id: 'A', totalPoints: 5, place: 1 }]);

    recomputeEventLeaderboard(42);

    expect(mockCalcBoat).toHaveBeenCalledTimes(1);
    const [passedResults, passedEventId, passedMap] =
      mockCalcBoat.mock.calls[0];
    expect(passedResults).toEqual(rows);
    expect(passedEventId).toBe(42);
    expect(passedMap).toBeInstanceOf(Map);
  });

  it('clears the existing leaderboard before inserting, all inside one transaction', () => {
    const h = installDb([
      { boat_id: 'A', total_points_event: 5, number_of_races: 3 },
    ]);
    mockCalcBoat.mockReturnValue([{ boat_id: 'A', totalPoints: 5, place: 1 }]);

    recomputeEventLeaderboard(1);

    expect(h.ops).toEqual([
      'TX_START',
      'DELETE Leaderboard',
      'INSERT Leaderboard',
      'TX_END',
    ]);
  });

  it('clears the board and skips the calculator when there are no qualifying scores (SHRS 1.5 / reset)', () => {
    const h = installDb([]);

    recomputeEventLeaderboard(1);

    expect(mockCalcBoat).not.toHaveBeenCalled();
    expect(h.leaderboard).toEqual([]);
    // The stale board must still be wiped even though nothing is reinserted.
    expect(h.ops).toEqual(['TX_START', 'DELETE Leaderboard', 'TX_END']);
  });

  it('persists every boat the calculator returns, including a single-boat event', () => {
    const h = installDb([
      { boat_id: 'SOLO', total_points_event: 1, number_of_races: 1 },
    ]);
    mockCalcBoat.mockReturnValue([
      { boat_id: 'SOLO', totalPoints: 1, place: 1 },
    ]);

    recomputeEventLeaderboard(7);

    expect(h.leaderboard).toEqual([
      { boat_id: 'SOLO', total_points_event: 1, event_id: 7, place: 1 },
    ]);
  });

  it('does not write to the Final table', () => {
    const h = installDb([
      { boat_id: 'A', total_points_event: 5, number_of_races: 3 },
    ]);
    mockCalcBoat.mockReturnValue([{ boat_id: 'A', totalPoints: 5, place: 1 }]);

    recomputeEventLeaderboard(1);

    expect(h.finalLeaderboard).toEqual([]);
    expect(mockCalcFinal).not.toHaveBeenCalled();
  });
});

describe('recomputeFinalLeaderboard (Final)', () => {
  it('persists each boat in each fleet with its placement_group and place', () => {
    const h = installDb(
      [],
      [
        { boat_id: 'A', heat_name: 'Final Gold', total_points_final: 3 },
        { boat_id: 'B', heat_name: 'Final Silver', total_points_final: 4 },
      ],
    );
    mockCalcFinal.mockReturnValue(
      new Map<string, any[]>([
        ['Gold', [{ boat_id: 'A', totalPoints: 3, place: 1 }]],
        ['Silver', [{ boat_id: 'B', totalPoints: 4, place: 1 }]],
      ]),
    );

    recomputeFinalLeaderboard(1);

    expect(h.finalLeaderboard).toEqual([
      {
        boat_id: 'A',
        total_points_final: 3,
        event_id: 1,
        placement_group: 'Gold',
        place: 1,
      },
      {
        boat_id: 'B',
        total_points_final: 4,
        event_id: 1,
        placement_group: 'Silver',
        place: 1,
      },
    ]);
  });

  it('preserves within-fleet ordering for multiple boats in one fleet', () => {
    const h = installDb(
      [],
      [
        { boat_id: 'A', heat_name: 'Final Gold', total_points_final: 2 },
        { boat_id: 'B', heat_name: 'Final Gold', total_points_final: 5 },
      ],
    );
    mockCalcFinal.mockReturnValue(
      new Map<string, any[]>([
        [
          'Gold',
          [
            { boat_id: 'A', totalPoints: 2, place: 1 },
            { boat_id: 'B', totalPoints: 5, place: 2 },
          ],
        ],
      ]),
    );

    recomputeFinalLeaderboard(9);

    expect(h.finalLeaderboard.map((r) => [r.boat_id, r.place])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });

  it('reads Final scores and forwards results and event_id to the final calculator', () => {
    const finalRows = [
      { boat_id: 'A', heat_name: 'Final Gold', total_points_final: 3 },
    ];
    installDb([], finalRows);
    mockCalcFinal.mockReturnValue(new Map());

    recomputeFinalLeaderboard(13);

    expect(mockCalcFinal).toHaveBeenCalledWith(finalRows, 13);
  });

  it('clears the final board before inserting, all inside one transaction', () => {
    const h = installDb(
      [],
      [{ boat_id: 'A', heat_name: 'Final Gold', total_points_final: 3 }],
    );
    mockCalcFinal.mockReturnValue(
      new Map<string, any[]>([
        ['Gold', [{ boat_id: 'A', totalPoints: 3, place: 1 }]],
      ]),
    );

    recomputeFinalLeaderboard(1);

    expect(h.ops).toEqual([
      'TX_START',
      'DELETE FinalLeaderboard',
      'INSERT FinalLeaderboard',
      'TX_END',
    ]);
  });

  it('clears the final board and inserts nothing when the calculator returns no fleets', () => {
    const h = installDb([], []);
    mockCalcFinal.mockReturnValue(new Map());

    recomputeFinalLeaderboard(1);

    expect(h.finalLeaderboard).toEqual([]);
    expect(h.ops).toEqual(['TX_START', 'DELETE FinalLeaderboard', 'TX_END']);
  });

  it('does not write to the Qualifying table', () => {
    const h = installDb(
      [],
      [{ boat_id: 'A', heat_name: 'Final Gold', total_points_final: 3 }],
    );
    mockCalcFinal.mockReturnValue(
      new Map<string, any[]>([
        ['Gold', [{ boat_id: 'A', totalPoints: 3, place: 1 }]],
      ]),
    );

    recomputeFinalLeaderboard(1);

    expect(h.leaderboard).toEqual([]);
    expect(mockCalcBoat).not.toHaveBeenCalled();
  });
});
