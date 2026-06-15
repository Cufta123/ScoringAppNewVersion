export {};

// Verifies the atomic scoring handler's penalty math and all-or-nothing write
// against an in-memory SQLite stand-in (no native better-sqlite3 dependency, so
// it runs deterministically alongside the jsdom suites).

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
    on: jest.fn(),
  },
}));

type ScoreRow = {
  score_id: number;
  race_id: number;
  boat_id: number;
  position: number;
  points: number;
  status: string;
};

const MAX_HEAT_SIZE = 10;
const HEAT_ID = 10;

const state = {
  races: [] as Array<{ race_id: number; heat_id: number; race_number: number }>,
  scores: new Map<string, ScoreRow>(),
  eventLocked: 0,
  raceSeq: 900,
  scoreSeq: 0,
  // Heat 10 has the boats we score; heat 20 has no races so the latest heats
  // have unequal race counts and the leaderboard recompute branch is skipped.
  boatsByHeat: {
    10: Array.from({ length: 10 }, (_, i) => ({
      boat_id: i + 1,
      sail_number: String(101 + i),
    })),
    20: [{ boat_id: 11, sail_number: '201' }],
  } as Record<number, Array<{ boat_id: number; sail_number: string }>>,
};

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const scoreKey = (raceId: number, boatId: number) => `${raceId}:${boatId}`;

const dbMock = {
  transaction: (fn: (...args: any[]) => any) => fn,
  prepare: (rawSql: string): PrepareStatement => {
    const sql = norm(rawSql);

    if (sql.includes('FROM Heat_Boat hb') && sql.includes('JOIN Boats b')) {
      return { all: (heatId: number) => state.boatsByHeat[heatId] || [] };
    }
    if (sql.includes('MAX(boat_count) AS max_boats')) {
      return { get: () => ({ max_boats: MAX_HEAT_SIZE }) };
    }
    if (sql.includes('SELECT COUNT(*) AS count FROM Races')) {
      return {
        get: (heatId: number) => ({
          count: state.races.filter((r) => r.heat_id === heatId).length,
        }),
      };
    }
    if (sql.startsWith('INSERT INTO Races')) {
      return {
        run: (heatId: number, raceNumber: number) => {
          state.raceSeq += 1;
          state.races.push({
            race_id: state.raceSeq,
            heat_id: heatId,
            race_number: raceNumber,
          });
          return { lastInsertRowid: state.raceSeq };
        },
      };
    }
    if (sql.startsWith('SELECT event_id, heat_type FROM Heats')) {
      return { get: () => ({ event_id: 1, heat_type: 'Qualifying' }) };
    }
    if (sql.startsWith('SELECT boat_id FROM Heat_Boat WHERE heat_id')) {
      return {
        all: (heatId: number) =>
          (state.boatsByHeat[heatId] || []).map((b) => ({
            boat_id: b.boat_id,
          })),
      };
    }
    // Seed default DNS write (status literal 'DNS').
    if (
      sql.startsWith('UPDATE Scores SET position = ?, points = ?, status =') &&
      sql.includes("'DNS'")
    ) {
      return {
        run: (
          position: number,
          points: number,
          raceId: number,
          boatId: number,
        ) => upsertScore(raceId, boatId, position, points, 'DNS', true),
      };
    }
    if (sql.includes("VALUES (?, ?, ?, ?, 'DNS')")) {
      return {
        run: (
          raceId: number,
          boatId: number,
          position: number,
          points: number,
        ) => upsertScore(raceId, boatId, position, points, 'DNS', false),
      };
    }
    // Per-boat scored write (status bound).
    if (
      sql.startsWith(
        'UPDATE Scores SET position = ?, points = ?, status = ?',
      ) &&
      sql.includes('WHERE race_id = ? AND boat_id = ?')
    ) {
      return {
        run: (
          position: number,
          points: number,
          status: string,
          raceId: number,
          boatId: number,
        ) => upsertScore(raceId, boatId, position, points, status, true),
      };
    }
    if (sql.includes('VALUES (?, ?, ?, ?, ?)') && sql.includes('INTO Scores')) {
      return {
        run: (
          raceId: number,
          boatId: number,
          position: number,
          points: number,
          status: string,
        ) => upsertScore(raceId, boatId, position, points, status, false),
      };
    }
    // Tie-scoring read of finishers + position-keeping penalties (which keep
    // their place slot). Mirrors the handler's status filter.
    if (
      sql.includes("status = 'FINISHED'") &&
      sql.includes('ORDER BY position')
    ) {
      const placeKeeping = new Set(['FINISHED', 'ZFP', 'SCP', 'T1']);
      return {
        all: (raceId: number) =>
          [...state.scores.values()]
            .filter((s) => s.race_id === raceId && placeKeeping.has(s.status))
            .sort((a, b) => a.position - b.position || a.score_id - b.score_id)
            .map((s) => ({
              score_id: s.score_id,
              position: s.position,
              status: s.status,
            })),
      };
    }
    if (
      sql.startsWith(
        'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
      )
    ) {
      return {
        run: (position: number, points: number, scoreId: number) => {
          const row = [...state.scores.values()].find(
            (s) => s.score_id === scoreId,
          );
          if (row) {
            row.position = position;
            row.points = points;
          }
          return { changes: row ? 1 : 0 };
        },
      };
    }
    if (
      sql.includes('SELECT h.event_id, h.heat_type') &&
      sql.includes('FROM Races r')
    ) {
      return { get: () => ({ event_id: 1, heat_type: 'Qualifying' }) };
    }
    if (sql.includes('UPDATE Events SET shrs_discard_locked_qualifying')) {
      return {
        run: () => {
          state.eventLocked = 1;
          return { changes: 1 };
        },
      };
    }
    if (sql.startsWith('SELECT heat_name, heat_id FROM Heats')) {
      return {
        all: () => [
          { heat_name: 'Heat A1', heat_id: 10 },
          { heat_name: 'Heat B1', heat_id: 20 },
        ],
      };
    }
    if (sql.includes('COUNT(*) as race_count FROM Races')) {
      return {
        get: (heatId: number) => ({
          race_count: state.races.filter((r) => r.heat_id === heatId).length,
        }),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  },
};

function upsertScore(
  raceId: number,
  boatId: number,
  position: number,
  points: number,
  status: string,
  updateOnly: boolean,
) {
  const key = scoreKey(raceId, boatId);
  const existing = state.scores.get(key);
  if (existing) {
    existing.position = position;
    existing.points = points;
    existing.status = status;
    return { changes: 1 };
  }
  if (updateOnly) {
    return { changes: 0 };
  }
  state.scoreSeq += 1;
  state.scores.set(key, {
    score_id: state.scoreSeq,
    race_id: raceId,
    boat_id: boatId,
    position,
    points,
    status,
  });
  return { lastInsertRowid: state.scoreSeq, changes: 1 };
}

jest.mock('../../public/Database/DBManager', () => ({ db: dbMock }));

describe('submitHeatRaceScoresAtomic handler', () => {
  beforeAll(() => {
    // eslint-disable-next-line global-require
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    state.races = [];
    state.scores = new Map();
    state.eventLocked = 0;
    state.raceSeq = 900;
    state.scoreSeq = 0;
  });

  const scoresForRace = (raceId: number) =>
    [...state.scores.values()].filter((s) => s.race_id === raceId);
  const scoreForBoat = (raceId: number, boatId: number) =>
    scoresForRace(raceId).find((s) => s.boat_id === boatId);

  it('writes a full race atomically with correct T1 / SHRS 5.2 penalty points', async () => {
    const result = await handlerRegistry.submitHeatRaceScoresAtomic(
      {},
      {
        event_id: 1,
        heat_id: HEAT_ID,
        placeNumbers: [
          { boatNumber: 101, place: 1, status: 'FINISHED' },
          { boatNumber: 102, place: 2, status: 'T1' },
        ],
        isFinalSeries: false,
      },
    );

    expect(result).toMatchObject({ ok: true, raceNumber: 1 });
    const { raceId } = result;

    // FINISHED winner keeps place 1 / 1 point (after tie scoring).
    expect(scoreForBoat(raceId, 1)).toMatchObject({
      position: 1,
      points: 1,
      status: 'FINISHED',
    });
    // T1 with maxHeatSize 10 => 30% rounded half-up = 3 places; place 2 => 5.
    expect(scoreForBoat(raceId, 2)).toMatchObject({
      position: 2,
      points: 5,
      status: 'T1',
    });
    // Boats not in the submission are seeded DNS at maxHeatSize + 1 = 11.
    expect(scoreForBoat(raceId, 3)).toMatchObject({
      position: 11,
      points: 11,
      status: 'DNS',
    });

    // Every boat in the heat has exactly one score row (full-race write).
    expect(scoresForRace(raceId)).toHaveLength(10);
    // Scoring locks the qualifying discard profile.
    expect(state.eventLocked).toBe(1);
  });

  it('does not shift finishers behind a position-keeping penalty (RRS A7 / 44.3c)', async () => {
    // Regression: a ZFP boat keeps its place, so finishers behind it must keep
    // their own places/points instead of being compacted up the order.
    const result = await handlerRegistry.submitHeatRaceScoresAtomic(
      {},
      {
        event_id: 1,
        heat_id: HEAT_ID,
        placeNumbers: [
          { boatNumber: 101, place: 1, status: 'FINISHED' },
          { boatNumber: 102, place: 2, status: 'ZFP' },
          { boatNumber: 103, place: 3, status: 'FINISHED' },
        ],
        isFinalSeries: false,
      },
    );

    expect(result).toMatchObject({ ok: true });
    const { raceId } = result;

    // Winner unchanged.
    expect(scoreForBoat(raceId, 1)).toMatchObject({ position: 1, points: 1 });
    // ZFP keeps place 2; 20% of 10 = 2 places => place 2 scores 4.
    expect(scoreForBoat(raceId, 2)).toMatchObject({
      position: 2,
      points: 4,
      status: 'ZFP',
    });
    // The finisher behind the ZFP boat must stay 3rd with 3 points (was being
    // compacted to position 2 / 2 points before the fix).
    expect(scoreForBoat(raceId, 3)).toMatchObject({
      position: 3,
      points: 3,
      status: 'FINISHED',
    });
  });

  it('averages A7 ties while keeping a position-keeping penalty in the place walk', async () => {
    // Two finishers tied at place 1, a ZFP at place 3, then a finisher at 4.
    const result = await handlerRegistry.submitHeatRaceScoresAtomic(
      {},
      {
        event_id: 1,
        heat_id: HEAT_ID,
        placeNumbers: [
          { boatNumber: 101, place: 1, status: 'FINISHED' },
          { boatNumber: 102, place: 1, status: 'FINISHED' },
          { boatNumber: 103, place: 3, status: 'ZFP' },
          { boatNumber: 104, place: 4, status: 'FINISHED' },
        ],
        isFinalSeries: false,
      },
    );

    const { raceId } = result;

    // RRS A7: the two boats tied for 1st share places 1 and 2 => 1.5 each.
    expect(scoreForBoat(raceId, 1)).toMatchObject({ position: 1, points: 1.5 });
    expect(scoreForBoat(raceId, 2)).toMatchObject({ position: 1, points: 1.5 });
    // ZFP keeps place 3 (20% of 10 = 2 places => 3 + 2 = 5).
    expect(scoreForBoat(raceId, 3)).toMatchObject({
      position: 3,
      points: 5,
      status: 'ZFP',
    });
    // The 4th-place finisher keeps place 4 / 4 points (ZFP still holds slot 3).
    expect(scoreForBoat(raceId, 4)).toMatchObject({ position: 4, points: 4 });
  });

  it('writes nothing when a sail number is not in the heat', async () => {
    const result = await handlerRegistry.submitHeatRaceScoresAtomic(
      {},
      {
        event_id: 1,
        heat_id: HEAT_ID,
        placeNumbers: [{ boatNumber: 999, place: 1, status: 'FINISHED' }],
        isFinalSeries: false,
      },
    );

    expect(result).toMatchObject({ ok: false, reason: 'UNMATCHED_SAILS' });
    expect(result.unmatched).toContain(999);
    expect(state.races).toHaveLength(0);
    expect(state.scores.size).toBe(0);
  });
});
