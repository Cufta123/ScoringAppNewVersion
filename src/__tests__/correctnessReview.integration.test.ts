/** @jest-environment node */
export {};

// Correctness review: bugs found by reading the business logic, each pinned by
// a test that failed before its fix. Real SQLite engine, foreign keys on, the
// real IPC handlers (same harness as HeatRaceHandler.undoAndGuards.integration).

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');

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
import { EVENT_LIFECYCLE_SCHEMA } from './fixtures/eventLifecycleSchema';
// eslint-disable-next-line import/first, import/order
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';

// eslint-disable-next-line import/first, import/order
import {
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../main/functions/eventSnapshot';

const EVENT_ID = 1;

function seed(boatCount: number) {
  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);
  db.exec(`
    CREATE TABLE Categories (category_id INTEGER PRIMARY KEY, category_name TEXT);
    ALTER TABLE Sailors ADD COLUMN category_id INTEGER;
    INSERT INTO Events (event_id, event_name, event_location, start_date, end_date,
      shrs_version, shrs_qualifying_assignment_mode, shrs_discard_profile_qualifying,
      shrs_discard_profile_final, shrs_discard_locked_qualifying,
      shrs_discard_locked_final, shrs_heat_overflow_policy)
      VALUES (${EVENT_ID}, 'Kup', 'Split', '2026-05-01', '2026-05-03',
        '2026-1', 'progressive', 'standard', 'standard', 0, 0, 'auto-increase');
  `);
  for (let i = 1; i <= boatCount; i += 1) {
    db.exec(
      `INSERT INTO Sailors (sailor_id, name, surname) VALUES (${i}, 'S${i}', 'X${i}');
       INSERT INTO Boats (boat_id, sail_number, country, model, sailor_id) VALUES (${i}, ${i}, 'CRO', 'IOM', ${i});
       INSERT INTO Boat_Event (boat_id, event_id) VALUES (${i}, ${EVENT_ID});`,
    );
  }
  mockDbHolder.current = db;
  return db;
}

const heatId = (db: any, name: string): number =>
  db
    .prepare('SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?')
    .get(EVENT_ID, name).heat_id;

const boatsIn = (db: any, name: string): number[] =>
  db
    .prepare(
      'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ? ORDER BY b.sail_number',
    )
    .all(heatId(db, name))
    .map((row: { sail_number: number }) => row.sail_number);

async function scoreHeat(db: any, name: string) {
  const result = await handlerRegistry.submitHeatRaceScoresAtomic(
    {},
    {
      heat_id: heatId(db, name),
      placeNumbers: boatsIn(db, name).map((sail, index) => ({
        boatNumber: sail,
        place: index + 1,
        status: 'FINISHED',
      })),
    },
  );
  expect(result.ok).toBe(true);
  return result.raceId as number;
}

describe('correctness review (real SQLite, FKs on)', () => {
  let db: any;

  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    invalidateAssignmentSnapshotCache();
  });

  afterEach(() => {
    db.close();
  });

  describe('a boat whose sailor row is missing', () => {
    it('still appears among the boats of her heat (scoring screen, starting list)', async () => {
      db = seed(4);
      // Boats.sailor_id is nullable (older imports, restored backups); every
      // other read LEFT JOINs the sailor and keeps such a boat.
      db.exec('UPDATE Boats SET sailor_id = NULL WHERE boat_id = 3');
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 1);

      const inHeat = db.prepare('SELECT COUNT(*) AS c FROM Heat_Boat').get()
        .c as number;
      const listed = await handlerRegistry.readBoatsByHeat(
        {},
        heatId(db, 'Heat A1'),
      );

      expect(inHeat).toBe(4);
      expect(listed.map((b: any) => b.boat_id).sort()).toEqual([1, 2, 3, 4]);
    });
  });

  describe('the Final Series has started', () => {
    it('refuses to build another qualifying round', async () => {
      db = seed(4);
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 2);
      await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
      await handlerRegistry.startFinalSeriesAtomic({}, EVENT_ID);

      await expect(
        handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID),
      ).rejects.toThrow(/Final Series/);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM Heats WHERE heat_type = 'Qualifying'",
          )
          .get().c,
      ).toBe(2);
    });
  });

  describe('RRS A8.2 with a heat that sails two races before the next round', () => {
    it('ranks the tied boats on the race sailed last (race numbers restart every round)', async () => {
      db = seed(4);
      const [P, Q, X, Y] = [1, 2, 3, 4];
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 1);
      const sail = async (name: string, order: number[]) => {
        const result = await handlerRegistry.submitHeatRaceScoresAtomic(
          {},
          {
            heat_id: heatId(db, name),
            placeNumbers: order.map((boatNumber, i) => ({
              boatNumber,
              place: i + 1,
              status: 'FINISHED',
            })),
          },
        );
        expect(result.ok).toBe(true);
      };
      // Round 1: two races in Heat A1 (race numbers 1 and 2), then round 2:
      // one race in Heat A2 (race number 1, but the last race sailed).
      await sail('Heat A1', [P, X, Y, Q]);
      await sail('Heat A1', [Q, P, X, Y]);
      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
      await sail('Heat A2', [P, Y, Q, X]);
      const lastRaceId = db
        .prepare('SELECT MAX(race_id) AS id FROM Races')
        .get().id as number;

      // X and Y both total 9 with scores {2, 3, 4}; in the last race sailed Y
      // was 2nd and X 4th, so Y is ahead (RRS A8.2).
      const rows = await handlerRegistry.readLeaderboard({}, EVENT_ID);
      const byBoat = new Map<number, { total: number; place: number }>(
        rows.map((r: any) => [
          r.boat_id,
          { total: r.total_points_event, place: r.place },
        ]),
      );
      expect(byBoat.get(X)?.total).toBe(9);
      expect(byBoat.get(Y)?.total).toBe(9);
      expect(byBoat.get(Y)!.place).toBeLessThan(byBoat.get(X)!.place);

      // The compare panel names the same winner and the same deciding race.
      const explained = await handlerRegistry.explainTieBreak(
        {},
        EVENT_ID,
        X,
        Y,
        false,
      );
      expect(explained.winnerBoatId).toBe(String(Y));
      const decisive = explained.steps.find((step: any) => step.resolved);
      expect(decisive.comparison).toMatchObject({
        mode: 'A8.2',
        raceId: lastRaceId,
        scoreA: 4,
        scoreB: 2,
      });
    });
  });

  describe('the Final Series screen reads the qualifying standings', () => {
    it('never shows qualifying points older than the scores (restored backup)', async () => {
      db = seed(4);
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 2);
      await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
      await handlerRegistry.startFinalSeriesAtomic({}, EVENT_ID);

      // A backup file carries the standings cache it was exported with. One
      // made by an older build (or edited by hand) can disagree with the
      // scores it carries.
      const snapshot = buildEventSnapshot(EVENT_ID) as any;
      snapshot.tables.Leaderboard.forEach((row: any) => {
        // eslint-disable-next-line no-param-reassign
        row.total_points_event += 40;
      });
      restoreEventSnapshot(EVENT_ID, snapshot);

      const rows = await handlerRegistry.readFinalLeaderboard({}, EVENT_ID);
      const qualifying = await handlerRegistry.readLeaderboard({}, EVENT_ID);
      const expected = new Map<number, number>(
        qualifying.map((r: any) => [r.boat_id, r.total_points_event]),
      );
      rows.forEach((row: any) => {
        expect(row.qualifying_points).toBe(expected.get(row.boat_id));
      });
    });
  });
});
