/** @jest-environment node */
export {};

/**
 * The score explanation through the real IPC handler and a real SQLite engine,
 * on 150 seeded random events: for every boat, the explained series totals
 * must equal the leaderboard the screen reads (readLeaderboard /
 * readFinalLeaderboard / readOverallLeaderboard). Both come from regatta-core
 * (switch phase 2); before it, this compared the explanation with the stored
 * Leaderboard tables, which the old recompute filled from the stored points.
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

describe('explainBoatScore agrees with the leaderboard', () => {
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
        const qualifying = await handlerRegistry.readLeaderboard({}, EVENT_ID);
        const finals = new Map(
          (await handlerRegistry.readFinalLeaderboard({}, EVENT_ID)).map(
            (row: any) => [row.boat_id, row.total_points_final],
          ),
        );
        const overall = new Map(
          (await handlerRegistry.readOverallLeaderboard({}, EVENT_ID)).map(
            (row: any) => [row.boat_id, row.overall_points],
          ),
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
            expect(explanation.overall.points).toBe(overall.get(row.boat_id));
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
