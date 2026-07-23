export {};

// BK-7: the updateScore and deleteScore IPC handlers must re-run RRS A7 tie
// scoring for the affected race AND recompute the leaderboard afterwards,
// otherwise a single-score edit/delete leaves stale averaged points on the
// remaining tied boats and a stale stored leaderboard. A Final-heat race must
// also recompute the FinalLeaderboard.

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

// Spy on the recompute functions so we can assert they run after an edit.
const recomputeEventLeaderboard = jest.fn();
const recomputeFinalLeaderboard = jest.fn();
jest.mock('../main/functions/leaderboardRecompute', () => ({
  recomputeEventLeaderboard: (...args: any[]) =>
    recomputeEventLeaderboard(...args),
  recomputeFinalLeaderboard: (...args: any[]) =>
    recomputeFinalLeaderboard(...args),
}));

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const contains = (sql: string, fragment: string) =>
  norm(sql).includes(fragment);

// Test-controlled state: which race the score belongs to and its heat type.
const state = {
  raceId: 700 as number | null,
  heatType: 'Qualifying' as 'Qualifying' | 'Final',
  eventId: 42,
  writeChanges: 1,
  // Two FINISHED finishers sharing position 1 → a tie that A7 scoring resolves.
  finishers: [
    { score_id: 1, position: 1, status: 'FINISHED' },
    { score_id: 2, position: 1, status: 'FINISHED' },
  ] as Array<{ score_id: number; position: number; status: string }>,
};

const tieScoringUpdates: Array<any[]> = [];

const dbMock = {
  transaction: (fn: (...args: any[]) => any) => fn,
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (contains(sql, 'SELECT race_id FROM Scores WHERE score_id = ?')) {
      return {
        get: () =>
          state.raceId == null ? undefined : { race_id: state.raceId },
      };
    }
    if (
      contains(sql, 'SELECT h.event_id, h.heat_type') &&
      contains(sql, 'FROM Races r')
    ) {
      return {
        get: () => ({ event_id: state.eventId, heat_type: state.heatType }),
      };
    }
    if (
      contains(
        sql,
        'UPDATE Scores SET position = ?, points = ?, status = ? WHERE score_id = ?',
      )
    ) {
      return { run: () => ({ changes: state.writeChanges }) };
    }
    if (contains(sql, 'DELETE FROM Scores WHERE score_id = ?')) {
      return { run: () => ({ changes: state.writeChanges }) };
    }
    if (contains(sql, 'UPDATE Events SET shrs_discard_locked_qualifying')) {
      return { run: () => ({ changes: 1 }) };
    }
    if (contains(sql, 'UPDATE Events SET shrs_discard_locked_final')) {
      return { run: () => ({ changes: 1 }) };
    }
    // applyRaceTieScoring: read finishers, then update their tie points.
    if (
      contains(sql, 'SELECT score_id, position, status') &&
      contains(sql, "status = 'FINISHED'")
    ) {
      return { all: () => state.finishers };
    }
    if (
      contains(
        sql,
        'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
      )
    ) {
      return {
        run: (...args: any[]) => {
          tieScoringUpdates.push(args);
          return { changes: 1 };
        },
      };
    }
    throw new Error(`Unhandled SQL in test mock: ${norm(sql)}`);
  }),
};

jest.mock('../../public/Database/DBManager', () => ({ db: dbMock }));

describe('BK-7 — single-score edit/delete re-scores ties and recomputes', () => {
  beforeAll(() => {
    // eslint-disable-next-line global-require
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    state.raceId = 700;
    state.heatType = 'Qualifying';
    state.eventId = 42;
    state.writeChanges = 1;
    state.finishers = [
      { score_id: 1, position: 1, status: 'FINISHED' },
      { score_id: 2, position: 1, status: 'FINISHED' },
    ];
    tieScoringUpdates.length = 0;
    recomputeEventLeaderboard.mockClear();
    recomputeFinalLeaderboard.mockClear();
  });

  it('updateScore re-runs A7 tie scoring and recomputes the event leaderboard', async () => {
    await handlerRegistry.updateScore({}, 1, 1, 1, 'FINISHED');

    // Two tied finishers → each re-scored to the averaged 1.5 points.
    expect(tieScoringUpdates.length).toBe(2);
    expect(tieScoringUpdates.every(([, points]) => points === 1.5)).toBe(true);
    expect(recomputeEventLeaderboard).toHaveBeenCalledWith(42);
    expect(recomputeFinalLeaderboard).not.toHaveBeenCalled();
  });

  it('deleteScore re-runs A7 tie scoring and recomputes the leaderboard', async () => {
    await handlerRegistry.deleteScore({}, 2);

    expect(tieScoringUpdates.length).toBe(2);
    expect(recomputeEventLeaderboard).toHaveBeenCalledWith(42);
  });

  it('a Final-heat score edit also recomputes the FinalLeaderboard', async () => {
    state.heatType = 'Final';
    await handlerRegistry.updateScore({}, 1, 1, 1, 'FINISHED');

    expect(recomputeEventLeaderboard).toHaveBeenCalledWith(42);
    expect(recomputeFinalLeaderboard).toHaveBeenCalledWith(42);
  });

  it('deleteScore that removes nothing does not recompute', async () => {
    state.writeChanges = 0;
    await handlerRegistry.deleteScore({}, 999);

    expect(tieScoringUpdates.length).toBe(0);
    expect(recomputeEventLeaderboard).not.toHaveBeenCalled();
  });
});
