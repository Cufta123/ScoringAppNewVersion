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
  renormalizeNonFinisherScores,
} from '../main/functions/leaderboardRecompute';
import {
  getLatestQualifyingHeats,
  getRaceCountForHeat,
  getMaxHeatSizeForEvent,
} from '../main/functions/heatQueries';
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
    if (sql.includes('MAX(boat_count)')) {
      // Default: no heats -> renormalizeNonFinisherScores is a no-op, so the
      // existing recompute op-logs stay unchanged. (Renormalization has its own
      // dedicated tests below.)
      return { get: () => ({ max_boats: null }) };
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

  it('clears the board and skips the calculator when there are no qualifying scores yet (empty event / reset)', () => {
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

  it('reads fleet membership from Heat_Boat so unraced fleets keep their boats (SHRS 4.5)', () => {
    const h = installDb([], []);
    mockCalcFinal.mockReturnValue(new Map());

    recomputeFinalLeaderboard(1);

    const readSql = h.preparedSql.find((sql) =>
      sql.includes("heat_type = 'Final'"),
    )!;
    // Boats must come from fleet assignment (Heat_Boat), with scores only
    // LEFT-joined in — a boat with no final scores still gets a 0-point row.
    expect(readSql).toContain('FROM Heat_Boat');
    expect(readSql).toContain('LEFT JOIN Scores');
    expect(readSql).toContain('COALESCE(SUM(s.points), 0)');
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

describe('renormalizeNonFinisherScores (SHRS 5.2 stale-points fix)', () => {
  it('re-derives frozen DNF/DNS and penalty points to the current largest heat', () => {
    // A series whose largest heat grew to 21. Race 1 was scored when the max
    // was 20, so its DNS is frozen at 21 and a ZFP is frozen at its old value.
    // Renormalization must rewrite both against the current max (21).
    const scoreRows = [
      { score_id: 1, position: 5, status: 'FINISHED' }, // untouched
      { score_id: 2, position: 21, status: 'DNS' }, // stale 21 -> 22
      { score_id: 3, position: 3, status: 'ZFP' }, // 3 + roundHalfUp(0.2*22)=3+4=7
      { score_id: 4, position: 8, status: 'RDG2' }, // redress -> untouched
    ];
    const updates: Array<{ points: number; score_id: number }> = [];

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('MAX(boat_count)')) {
        return { get: () => ({ max_boats: 21 }) };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        return { all: () => scoreRows };
      }
      if (sql.includes('UPDATE Scores SET points = ?')) {
        return {
          run: (points: number, score_id: number) => {
            updates.push({ points, score_id });
          },
        };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    renormalizeNonFinisherScores(7, 'Qualifying');

    // FINISHED (score 1) and RDG2 (score 4) are left alone; DNS and ZFP rewritten.
    expect(updates).toEqual([
      { points: 22, score_id: 2 }, // largest heat 21 + 1
      { points: 7, score_id: 3 }, // 3 + 20% of DNF score (22) = 3 + 4
    ]);
  });

  it('is a no-op when the event has no heats yet', () => {
    const prepared: string[] = [];
    mockPrepare.mockImplementation((sql: string) => {
      prepared.push(sql);
      if (sql.includes('MAX(boat_count)')) {
        return { get: () => ({ max_boats: null }) };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    expect(() => renormalizeNonFinisherScores(7, 'Qualifying')).not.toThrow();
    // Only the max-heat query is prepared; no score SELECT/UPDATE.
    expect(prepared).toHaveLength(1);
  });
});

describe('renormalizeNonFinisherScores — additional edge cases', () => {
  it('re-derives every plain penalty status (not just DNS) to maxBoats + 1', () => {
    // SHRS 5.2 applies the same "largest heat + 1" substitution to every
    // non-finisher status that is not a position-keeping scoring penalty
    // (ZFP/SCP/T1) and not a redress (RDG1-3). Exercise the rest of the
    // penalty vocabulary (scoreStatus.ts penaltyStatuses) so a future status
    // added to that list without wiring into deriveNonFinisherPoints would
    // show up here as a mismatch.
    const statuses = [
      'DNF',
      'DSQ',
      'RET',
      'OCS',
      'BFD',
      'UFD',
      'DNC',
      'NSC',
      'WTH',
      'DNE',
      'DGM',
    ];
    const scoreRows = statuses.map((status, i) => ({
      score_id: i + 1,
      position: i + 1,
      status,
    }));
    const updates: Array<{ points: number; score_id: number }> = [];

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('MAX(boat_count)')) {
        return { get: () => ({ max_boats: 9 }) };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        return { all: () => scoreRows };
      }
      if (sql.includes('UPDATE Scores SET points = ?')) {
        return {
          run: (points: number, score_id: number) => {
            updates.push({ points, score_id });
          },
        };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    renormalizeNonFinisherScores(1, 'Qualifying');

    expect(updates).toEqual(
      statuses.map((_s, i) => ({ points: 10, score_id: i + 1 })),
    );
  });

  it('applies the RRS 44.3(c)/T1 scoring-penalty formula to SCP and T1, not only ZFP', () => {
    const scoreRows = [
      { score_id: 1, position: 5, status: 'ZFP' },
      { score_id: 2, position: 5, status: 'SCP' },
      { score_id: 3, position: 5, status: 'T1' },
    ];
    const updates: Array<{ points: number; score_id: number }> = [];

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('MAX(boat_count)')) {
        // maxBoats 19 -> dnfScore 20
        return { get: () => ({ max_boats: 19 }) };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        return { all: () => scoreRows };
      }
      if (sql.includes('UPDATE Scores SET points = ?')) {
        return {
          run: (points: number, score_id: number) => {
            updates.push({ points, score_id });
          },
        };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    renormalizeNonFinisherScores(1, 'Qualifying');

    // dnfScore = 20. ZFP/SCP: 20% -> roundHalfUp(4.0)=4 -> 5+4=9.
    // T1: 30% -> roundHalfUp(6.0)=6 -> 5+6=11.
    expect(updates).toEqual([
      { points: 9, score_id: 1 },
      { points: 9, score_id: 2 },
      { points: 11, score_id: 3 },
    ]);
  });

  it('threads the Final heat_type through to both the max-heat query and the score read', () => {
    const captured: { maxArgs?: any[]; rowsArgs?: any[] } = {};

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('MAX(boat_count)')) {
        expect(sql).toContain('h.heat_type = ?');
        return {
          get: (...args: any[]) => {
            captured.maxArgs = args;
            return { max_boats: 8 };
          },
        };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        expect(sql).toContain('h.heat_type = ?');
        return {
          all: (...args: any[]) => {
            captured.rowsArgs = args;
            return [];
          },
        };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    renormalizeNonFinisherScores(4, 'Final');

    expect(captured.maxArgs).toEqual([4, 'Final']);
    expect(captured.rowsArgs).toEqual([4, 'Final']);
  });

  it('is a no-op when heats exist (maxBoats > 0) but no Scores rows have been recorded yet', () => {
    const prepared: string[] = [];
    mockPrepare.mockImplementation((sql: string) => {
      prepared.push(sql);
      if (sql.includes('MAX(boat_count)')) {
        return { get: () => ({ max_boats: 6 }) };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        return { all: () => [] };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    expect(() => renormalizeNonFinisherScores(1, 'Qualifying')).not.toThrow();
    expect(prepared.some((sql) => sql.includes('UPDATE Scores'))).toBe(false);
  });

  it('re-derives the SAME frozen DNF to a DIFFERENT value once the series-wide largest heat grows across rounds (M1 regression)', () => {
    // This is the exact symptom from docs/SCORING_AUDIT.md M1: an identical
    // DNF scored 8 in an earlier round must not stay frozen at 8 once a later
    // round (or a late entry via insertHeatBoat) grows the series-wide
    // largest heat. Both calls below re-derive the identical score row —
    // proving the value tracks the CURRENT largest heat, not whatever it was
    // when the row was first written.
    const scoreRow = { score_id: 42, position: 7, status: 'DNF' };
    let currentMax = 7; // round 1: largest heat so far is 7 boats -> DNF scores 8
    const updates: Array<{ points: number; score_id: number }> = [];

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('MAX(boat_count)')) {
        return { get: () => ({ max_boats: currentMax }) };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        return { all: () => [scoreRow] };
      }
      if (sql.includes('UPDATE Scores SET points = ?')) {
        return {
          run: (points: number, score_id: number) => {
            updates.push({ points, score_id });
          },
        };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    renormalizeNonFinisherScores(1, 'Qualifying');
    expect(updates.pop()).toEqual({ points: 8, score_id: 42 });

    currentMax = 21; // round 3: a late entry grows the largest heat to 21 boats
    renormalizeNonFinisherScores(1, 'Qualifying');
    expect(updates.pop()).toEqual({ points: 22, score_id: 42 });
  });
});

describe('recomputeEventLeaderboard invokes renormalization inside its transaction (M1 glue)', () => {
  it('re-derives stale non-finisher points BEFORE the delete/aggregate/insert steps, all inside one transaction', () => {
    const ops: string[] = [];
    const scoreRows = [{ score_id: 9, position: 5, status: 'DNS' }];
    const qualifyingRows = [
      { boat_id: 'A', total_points_event: 5, number_of_races: 3 },
    ];

    mockTransaction.mockImplementation((fn: (...a: any[]) => any) => {
      return (...args: any[]) => {
        ops.push('TX_START');
        const result = fn(...args);
        ops.push('TX_END');
        return result;
      };
    });

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('MAX(boat_count)')) {
        return { get: () => ({ max_boats: 12 }) };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        return { all: () => scoreRows };
      }
      if (sql.includes('UPDATE Scores SET points = ?')) {
        return {
          run: (points: number, score_id: number) => {
            ops.push(`UPDATE Scores(${score_id}->${points})`);
          },
        };
      }
      if (sql.includes('DELETE FROM Leaderboard')) {
        return { run: () => ops.push('DELETE Leaderboard') };
      }
      if (sql.includes("heat_type = 'Qualifying'")) {
        return { all: () => qualifyingRows };
      }
      if (sql.includes('INSERT INTO Leaderboard')) {
        return { run: () => ops.push('INSERT Leaderboard') };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    mockCalcBoat.mockReturnValue([{ boat_id: 'A', totalPoints: 5, place: 1 }]);

    recomputeEventLeaderboard(1);

    // DNS at maxBoats=12 -> 13. Must land before DELETE/read/INSERT so the
    // real SUM(points) aggregate (mocked away here, but real in prod SQL)
    // reflects the fresh value, and everything shares one transaction so a
    // failure never leaves stale points alongside a wiped leaderboard.
    expect(ops).toEqual([
      'TX_START',
      'UPDATE Scores(9->13)',
      'DELETE Leaderboard',
      'INSERT Leaderboard',
      'TX_END',
    ]);
  });
});

describe('recomputeFinalLeaderboard renormalization — SHRS 5.2 / M1 vs the Final series (M2 withdrawn)', () => {
  // TODO(source-bug): leaderboardRecompute.ts's recomputeFinalLeaderboard never
  // calls renormalizeNonFinisherScores(event_id, 'Final'). docs/SCORING_AUDIT.md
  // M2 ("final-series non-finishers need the per-fleet largest heat") was
  // WITHDRAWN as a rule misreading: SHRS 5.2 substitutes ONE series-wide
  // "largest heat" value regardless of fleet, and getMaxHeatSizeForEvent(event,
  // 'Final') already computes exactly that (MAX boat_count across all Final
  // heats). That means the M1 fix — re-deriving frozen non-finisher points
  // against the CURRENT largest heat at recompute time, because points are
  // frozen into Scores.points at write time and Final heats/Heat_Boat also
  // grow across rounds / via insertHeatBoat late entries — applies to the
  // Final series exactly as it does to Qualifying. recomputeEventLeaderboard
  // calls renormalizeNonFinisherScores(event_id, 'Qualifying') at the top of
  // its transaction (see the passing test above); recomputeFinalLeaderboard
  // has no equivalent call for 'Final', so an identical Final-series DNF can
  // still score differently across rounds. Fix: call
  // renormalizeNonFinisherScores(event_id, 'Final') inside
  // recomputeFinalLeaderboard's transaction, before its read query, mirroring
  // the Qualifying path.
  it('re-derives stale Final non-finisher points against the current largest FINAL heat before aggregating', () => {
    const ops: string[] = [];
    const scoreRows = [{ score_id: 55, position: 3, status: 'DNS' }];

    mockTransaction.mockImplementation((fn: (...a: any[]) => any) => {
      return (...args: any[]) => {
        ops.push('TX_START');
        const result = fn(...args);
        ops.push('TX_END');
        return result;
      };
    });

    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('MAX(boat_count)')) {
        return { get: () => ({ max_boats: 15 }) };
      }
      if (sql.includes('SELECT s.score_id, s.position')) {
        return { all: () => scoreRows };
      }
      if (sql.includes('UPDATE Scores SET points = ?')) {
        return {
          run: (points: number, score_id: number) => {
            ops.push(`UPDATE Scores(${score_id}->${points})`);
          },
        };
      }
      if (sql.includes('DELETE FROM FinalLeaderboard')) {
        return { run: () => ops.push('DELETE FinalLeaderboard') };
      }
      if (sql.includes("heat_type = 'Final'")) {
        return { all: () => [] };
      }
      if (sql.includes('INSERT INTO FinalLeaderboard')) {
        return { run: () => ops.push('INSERT FinalLeaderboard') };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });
    mockCalcFinal.mockReturnValue(new Map());

    recomputeFinalLeaderboard(1);

    // Rule-correct: the stale DNS (frozen at an earlier, smaller final heat
    // size) must be rewritten to 15 + 1 = 16 before the leaderboard is
    // aggregated, exactly like the Qualifying path.
    expect(ops).toContain('UPDATE Scores(55->16)');
  });
});

describe('recomputeFinalLeaderboard boundary at SHRS 1.5 (no Final Series races completed)', () => {
  it('produces no rows when the Final Series has not been started yet (no Final heats/Heat_Boat) — qualifying Leaderboard stands untouched', () => {
    const h = installDb([], []);
    mockCalcFinal.mockReturnValue(new Map());

    recomputeFinalLeaderboard(1);

    expect(h.finalLeaderboard).toEqual([]);
    // The Qualifying Leaderboard table must never be touched by a Final
    // recompute, so a pre-existing qualifying standing is left standing.
    expect(
      h.preparedSql.some((sql) => sql.includes('DELETE FROM Leaderboard')),
    ).toBe(false);
  });

  it('documents current behaviour once Final heats/Heat_Boat exist (fleets assigned) but zero races have been scored anywhere: the glue forwards zero-point rows to the calculator as-is', () => {
    // Whether an all-zero Final series should rank boats at all (vs. leaving
    // the Final tab keyed off the Qualifying score per SHRS 1.5) is decided by
    // calculateFinalBoatScores (out of this module's scope) and by which
    // caller chooses to invoke recomputeFinalLeaderboard before any race
    // exists. leaderboardRecompute.ts itself does not special-case this state
    // — it is pure glue that reads Heat_Boat-sourced rows and forwards
    // whatever it gets to the calculator, then persists whatever comes back.
    const finalRows = [
      { boat_id: 'A', heat_name: 'Final Gold', total_points_final: 0 },
      { boat_id: 'B', heat_name: 'Final Silver', total_points_final: 0 },
    ];
    installDb([], finalRows);
    mockCalcFinal.mockReturnValue(new Map());

    recomputeFinalLeaderboard(1);

    expect(mockCalcFinal).toHaveBeenCalledWith(finalRows, 1);
  });
});

describe('heatQueries — getLatestQualifyingHeats / getRaceCountForHeat / getMaxHeatSizeForEvent', () => {
  it('getRaceCountForHeat returns the race count for the given heat_id', () => {
    let capturedHeatId: number | undefined;
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('FROM Races WHERE heat_id')) {
        return {
          get: (heat_id: number) => {
            capturedHeatId = heat_id;
            return { race_count: 4 };
          },
        };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    expect(getRaceCountForHeat(17)).toBe(4);
    expect(capturedHeatId).toBe(17);
  });

  it('getLatestQualifyingHeats keeps only the highest-suffix heat per base letter', () => {
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes("heat_type = 'Qualifying'")) {
        return {
          all: () => [
            { heat_name: 'Heat A1', heat_id: 1 },
            { heat_name: 'Heat A2', heat_id: 2 },
            { heat_name: 'Heat B1', heat_id: 3 },
          ],
        };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    const latest = getLatestQualifyingHeats(5) as { heat_name: string }[];
    expect(latest.map((h) => h.heat_name).sort()).toEqual([
      'Heat A2',
      'Heat B1',
    ]);
  });

  it('getLatestQualifyingHeats throws when the event has no qualifying heats yet', () => {
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes("heat_type = 'Qualifying'")) {
        return { all: () => [] };
      }
      throw new Error(`Unexpected SQL prepared: ${sql}`);
    });

    expect(() => getLatestQualifyingHeats(5)).toThrow(
      'No qualifying heats found for this event.',
    );
  });

  it('getMaxHeatSizeForEvent filters by heat_type and passes it as a bind param when given', () => {
    let capturedArgs: any[] = [];
    mockPrepare.mockImplementation((sql: string) => {
      expect(sql).toContain('h.heat_type = ?');
      return {
        get: (...args: any[]) => {
          capturedArgs = args;
          return { max_boats: 15 };
        },
      };
    });

    expect(getMaxHeatSizeForEvent(3, 'Final')).toBe(15);
    expect(capturedArgs).toEqual([3, 'Final']);
  });

  it('getMaxHeatSizeForEvent omits the heat_type filter and bind param when not given', () => {
    let capturedArgs: any[] = [];
    mockPrepare.mockImplementation((sql: string) => {
      expect(sql).not.toContain('h.heat_type = ?');
      return {
        get: (...args: any[]) => {
          capturedArgs = args;
          return { max_boats: 10 };
        },
      };
    });

    expect(getMaxHeatSizeForEvent(3)).toBe(10);
    expect(capturedArgs).toEqual([3]);
  });

  it('getMaxHeatSizeForEvent returns 0, not null/undefined, when there are no heats yet', () => {
    mockPrepare.mockImplementation(() => ({
      get: () => ({ max_boats: null }),
    }));
    expect(getMaxHeatSizeForEvent(3, 'Qualifying')).toBe(0);

    mockPrepare.mockImplementation(() => ({
      get: () => undefined,
    }));
    expect(getMaxHeatSizeForEvent(3, 'Qualifying')).toBe(0);
  });

  it('reflects a late entry (insertHeatBoat growing Heat_Boat) on the very next call — no caching / staleness', () => {
    // M1's root cause was a frozen value; getMaxHeatSizeForEvent must instead
    // compute live from Heat_Boat on every call, so a late entry into any heat
    // (via insertHeatBoat) immediately changes "the largest heat" that the
    // NEXT renormalization / write-time score uses.
    let currentMax = 20;
    mockPrepare.mockImplementation(() => ({
      get: () => ({ max_boats: currentMax }),
    }));

    expect(getMaxHeatSizeForEvent(3, 'Qualifying')).toBe(20);
    currentMax = 21; // simulates insertHeatBoat adding a late entry
    expect(getMaxHeatSizeForEvent(3, 'Qualifying')).toBe(21);
  });
});
