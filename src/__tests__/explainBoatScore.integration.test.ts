/** @jest-environment node */
export {};

/**
 * The score explanation through the real IPC handler and a real SQLite engine,
 * on the same 150 seeded random events as the scoring characterisation: for
 * every boat, the explained series totals must equal the stored leaderboard.
 */

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
  dialog: { showSaveDialog: jest.fn(), showOpenDialog: jest.fn() },
  app: { getPath: jest.fn(() => '/tmp') },
}));

const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

// eslint-disable-next-line import/first, import/order
import { buildRandomEvent, EVENT_ID } from './fixtures/randomEvents';
// eslint-disable-next-line import/first, import/order
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../main/functions/leaderboardRecompute';

describe('explainBoatScore agrees with the stored leaderboard', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  afterAll(() => jest.restoreAllMocks());

  it('for every boat of 150 random events', async () => {
    let boatsChecked = 0;
    let tiesExplained = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
      const { db, hasFinal } = buildRandomEvent(seed);
      mockDbHolder.current = db;
      try {
        // Reading the leaderboard backfills missed-round DNCs, as the app does.
        await handlerRegistry.readLeaderboard({}, EVENT_ID);
        recomputeEventLeaderboard(EVENT_ID);
        if (hasFinal) recomputeFinalLeaderboard(EVENT_ID);

        const qualifying = db
          .prepare(
            'SELECT boat_id, total_points_event FROM Leaderboard WHERE event_id = ?',
          )
          .all(EVENT_ID);
        const finals = new Map(
          db
            .prepare(
              'SELECT boat_id, total_points_final FROM FinalLeaderboard WHERE event_id = ?',
            )
            .all(EVENT_ID)
            .map((row: any) => [row.boat_id, row.total_points_final]),
        );

        for (const row of qualifying) {
          const explanation = await handlerRegistry.explainBoatScore(
            {},
            EVENT_ID,
            row.boat_id,
          );
          expect({
            seed,
            boat: row.boat_id,
            total: explanation.qualifying.total,
          }).toEqual({
            seed,
            boat: row.boat_id,
            total: row.total_points_event,
          });
          if (hasFinal) {
            expect({
              seed,
              boat: row.boat_id,
              total: explanation.final.total,
            }).toEqual({
              seed,
              boat: row.boat_id,
              total: finals.get(row.boat_id),
            });
            expect(explanation.overall.points).toBeCloseTo(
              row.total_points_event + finals.get(row.boat_id),
              6,
            );
          } else {
            expect(explanation.final).toBeNull();
          }
          const series = explanation.final ?? explanation.qualifying;
          series.races.forEach((r: any) => expect(r.reason.text).not.toBe(''));
          tiesExplained += series.ties.length;
          boatsChecked += 1;
        }
      } finally {
        db.close();
      }
    }
    // The random events must actually exercise ties, or the tie path above
    // proves nothing.
    expect(boatsChecked).toBeGreaterThan(1000);
    expect(tiesExplained).toBeGreaterThan(50);
  });
});
