/** @jest-environment node */
export {};

// Undo, series guards and the DNC backfill, driven through the real IPC
// handlers against a real SQLite engine with foreign keys ENFORCED.
//
// - Undoing a race that carries a protest decision used to fail with
//   "FOREIGN KEY constraint failed": the SHRS 3.1.5 snapshot rows reference
//   the race and were only cleared after the race delete.
// - Scoring or undoing a qualifying heat after its round has been built on,
//   or after the Final Series started, must be refused by the main process.
// - A boat entered but placed in no heat is scored DNC once per COMPLETED
//   round (RRS A5.1 / SHRS 5.3) — every qualifying race is race 1 of its heat,
//   which the old backfill collapsed into a single round.

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

const EVENT_ID = 1;
const LATE_ENTRY = 5;

function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);
  db.exec(`
    INSERT INTO Events (event_id, event_name, event_location, start_date, end_date,
      shrs_version, shrs_qualifying_assignment_mode, shrs_discard_profile_qualifying,
      shrs_discard_profile_final, shrs_discard_locked_qualifying,
      shrs_discard_locked_final, shrs_heat_overflow_policy)
      VALUES (${EVENT_ID}, 'Kup', 'Split', '2026-05-01', '2026-05-03',
        '2026-1', 'progressive', 'standard', 'standard', 0, 0, 'auto-increase');
  `);
  for (let i = 1; i <= 4; i += 1) {
    db.exec(
      `INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (${i}, ${i}, 'CRO', 'IOM');
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

/** Score a heat with its boats finishing in sail-number order. */
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

const snapshotRows = (db: any) =>
  db.prepare('SELECT COUNT(*) AS c FROM RaceAssignmentSnapshots').get().c;

describe('undo, series guards and missed-round DNCs (real SQLite, FKs on)', () => {
  let db: any;

  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(async () => {
    invalidateAssignmentSnapshotCache();
    db = seed();
    await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 2);
  });

  afterEach(() => {
    db.close();
  });

  describe('undo a race carrying a protest decision', () => {
    it('undoes one heat’s race and clears its SHRS 3.1.5 snapshot', async () => {
      const raceId = await scoreHeat(db, 'Heat A1');
      const [firstBoat] = boatsIn(db, 'Heat A1');
      await handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
        { raceId, cells: [{ boatId: firstBoat, position: 1, status: 'DSQ' }] },
      ]);
      expect(snapshotRows(db)).toBeGreaterThan(0);

      await expect(
        handlerRegistry.undoLastScoredRaceForHeat({}, heatId(db, 'Heat A1')),
      ).resolves.toMatchObject({ success: true });

      expect(snapshotRows(db)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM Races').get().c).toBe(0);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });

    it('undoes a whole round that carries a protest decision', async () => {
      const raceId = await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
      await handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
        {
          raceId,
          cells: [
            { boatId: boatsIn(db, 'Heat A1')[0], position: 1, status: 'DSQ' },
          ],
        },
      ]);

      // The scoring page undoes a round heat by heat.
      await expect(
        handlerRegistry.undoLastScoredRaceForHeat({}, heatId(db, 'Heat A1')),
      ).resolves.toMatchObject({ success: true });
      await expect(
        handlerRegistry.undoLastScoredRaceForHeat({}, heatId(db, 'Heat B1')),
      ).resolves.toMatchObject({ success: true });
      expect(db.prepare('SELECT COUNT(*) AS c FROM Races').get().c).toBe(0);
      expect(snapshotRows(db)).toBe(0);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  });

  describe('qualifying heats that are already built on', () => {
    beforeEach(async () => {
      await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
    });

    it('refuses to undo a race whose round seeded the next round', async () => {
      await expect(
        handlerRegistry.undoLastScoredRaceForHeat({}, heatId(db, 'Heat A1')),
      ).rejects.toThrow(/Undo the heat redistribution first/);
      expect(db.prepare('SELECT COUNT(*) AS c FROM Races').get().c).toBe(2);
    });

    it('refuses to score a second race into a superseded round', async () => {
      await expect(
        handlerRegistry.submitHeatRaceScoresAtomic(
          {},
          {
            heat_id: heatId(db, 'Heat A1'),
            placeNumbers: boatsIn(db, 'Heat A1').map((sail, i) => ({
              boatNumber: sail,
              place: i + 1,
              status: 'FINISHED',
            })),
          },
        ),
      ).rejects.toThrow(/next round/);
    });

    it('refuses qualifying writes once the Final Series has started', async () => {
      await scoreHeat(db, 'Heat A2');
      await scoreHeat(db, 'Heat B2');
      await handlerRegistry.startFinalSeriesAtomic({}, EVENT_ID);

      await expect(
        handlerRegistry.undoLastScoredRaceForHeat({}, heatId(db, 'Heat A2')),
      ).rejects.toThrow(/Final Series has already started/);
    });
  });

  describe('adding a late entry to a heat (insertHeatBoat)', () => {
    beforeEach(() => {
      db.exec(
        `INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (${LATE_ENTRY}, ${LATE_ENTRY}, 'CRO', 'IOM');
         INSERT INTO Boat_Event (boat_id, event_id) VALUES (${LATE_ENTRY}, ${EVENT_ID});
         INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (6, 6, 'CRO', 'IOM');`,
      );
    });

    it('adds her to a heat of the current round that has not raced', async () => {
      await scoreHeat(db, 'Heat A1');
      await handlerRegistry.insertHeatBoat(
        {},
        heatId(db, 'Heat B1'),
        LATE_ENTRY,
      );
      expect(boatsIn(db, 'Heat B1')).toContain(LATE_ENTRY);
    });

    it('refuses a heat that has already raced', async () => {
      await scoreHeat(db, 'Heat A1');
      await expect(
        handlerRegistry.insertHeatBoat({}, heatId(db, 'Heat A1'), LATE_ENTRY),
      ).rejects.toThrow(/already raced/);
    });

    it('refuses a second heat in the same round', async () => {
      await handlerRegistry.insertHeatBoat(
        {},
        heatId(db, 'Heat A1'),
        LATE_ENTRY,
      );
      await expect(
        handlerRegistry.insertHeatBoat({}, heatId(db, 'Heat B1'), LATE_ENTRY),
      ).rejects.toThrow(/already in Heat A1/);
    });

    it('refuses a boat that is not entered in the event', async () => {
      await expect(
        handlerRegistry.insertHeatBoat({}, heatId(db, 'Heat A1'), 6),
      ).rejects.toThrow(/not entered/);
    });

    it('refuses a superseded round', async () => {
      await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
      await expect(
        handlerRegistry.insertHeatBoat({}, heatId(db, 'Heat A1'), LATE_ENTRY),
      ).rejects.toThrow(/next round/);
    });
  });

  describe('a boat entered after the heats were built', () => {
    beforeEach(() => {
      db.exec(
        `INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (${LATE_ENTRY}, ${LATE_ENTRY}, 'CRO', 'IOM');
         INSERT INTO Boat_Event (boat_id, event_id) VALUES (${LATE_ENTRY}, ${EVENT_ID});`,
      );
    });

    const lateEntryStatuses = () =>
      db
        .prepare('SELECT status FROM Scores WHERE boat_id = ? ORDER BY race_id')
        .all(LATE_ENTRY)
        .map((row: { status: string }) => row.status);

    it('is scored DNC once per completed round, as each round completes', async () => {
      await scoreHeat(db, 'Heat A1');
      // Round 1 is not complete until Heat B1 is in.
      expect(lateEntryStatuses()).toEqual([]);
      await scoreHeat(db, 'Heat B1');
      expect(lateEntryStatuses()).toEqual(['DNC']);

      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
      await scoreHeat(db, 'Heat A2');
      await scoreHeat(db, 'Heat B2');
      expect(lateEntryStatuses()).toEqual(['DNC', 'DNC']);
    });

    it('ranks last on the qualifying leaderboard, not near the top', async () => {
      await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
      await scoreHeat(db, 'Heat A2');
      await scoreHeat(db, 'Heat B2');

      const rows = await handlerRegistry.readLeaderboard({}, EVENT_ID);
      expect(rows[rows.length - 1].boat_id).toBe(LATE_ENTRY);
    });
  });
});
