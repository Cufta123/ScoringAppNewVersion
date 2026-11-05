/** @jest-environment node */
export {};

// `saveLeaderboardRaceResultsAtomic` through the real handler against a real
// SQLite engine with foreign keys enforced. It is the only way a stored result
// is corrected, and it replaced the per-boat `updateRaceResult`, `updateScore`,
// `insertScore` and `deleteScore` channels, so it carries what their suites
// pinned:
//
// - SHRS 3.1.5: a protest decision must not change next-round assignments, an
//   ordinary correction may, and one boat's correction keeps the others'
//   shields (RULE-M14, RULE-M21);
// - the in-memory shield cache is put back when the save fails;
// - the write, the A7 re-average and the standings rebuild commit together
//   (BK-5, BK-7);
// - values that cannot be stored are refused before anything is written (BK-6).

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

// Lets a test make the standings rebuild (or, on the regatta-core write
// path, writing the worked-out event into the tables) fail, to prove the
// write rolls back.
const mockRecompute = { failEvent: false };
jest.mock('../main/functions/projectEvent', () => {
  const actual = jest.requireActual('../main/functions/projectEvent');
  return {
    __esModule: true,
    default: (...args: any[]) => {
      if (mockRecompute.failEvent) throw new Error('recompute exploded');
      return actual.default(...args);
    },
  };
});
jest.mock('../main/functions/leaderboardRecompute', () => {
  const actual = jest.requireActual('../main/functions/leaderboardRecompute');
  return {
    ...actual,
    recomputeEventLeaderboard: (...args: any[]) => {
      if (mockRecompute.failEvent) throw new Error('recompute exploded');
      return actual.recomputeEventLeaderboard(...args);
    },
  };
});

/* eslint-disable import/first, import/order */
import { EVENT_LIFECYCLE_SCHEMA } from './fixtures/eventLifecycleSchema';
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';
import applyRaceColumnEdit from '../shared/raceColumnEdit';
/* eslint-enable import/first, import/order */

const EVENT_ID = 1;

function seed(boatCount: number) {
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
  for (let i = 1; i <= boatCount; i += 1) {
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
      'SELECT hb.boat_id FROM Heat_Boat hb WHERE hb.heat_id = ? ORDER BY hb.boat_id',
    )
    .all(heatId(db, name))
    .map((row: { boat_id: number }) => row.boat_id);

/** Score a heat with its boats finishing in boat order. */
async function scoreHeat(db: any, name: string) {
  const result = await handlerRegistry.submitHeatRaceScoresAtomic(
    {},
    {
      heat_id: heatId(db, name),
      placeNumbers: boatsIn(db, name).map((boat, index) => ({
        boatNumber: boat,
        place: index + 1,
        status: 'FINISHED',
      })),
    },
  );
  expect(result.ok).toBe(true);
  return result.raceId as number;
}

const raceRows = (db: any, raceId: number) =>
  db
    .prepare(
      `SELECT boat_id, position, points, COALESCE(status, 'FINISHED') AS status
       FROM Scores WHERE race_id = ? ORDER BY score_id`,
    )
    .all(raceId)
    .map((row: any) => ({ ...row }));

/**
 * The operation the leaderboard's Save sends for one corrected boat: the
 * whole race, built with the edit screen's rules (shared/raceColumnEdit).
 */
function operationFor(
  db: any,
  raceId: number,
  boatId: number,
  position: number,
  status: string,
) {
  const rows = raceRows(db, raceId);
  const index = rows.findIndex((row: any) => row.boat_id === boatId);
  const maxBoats = rows.length;
  const cells = applyRaceColumnEdit(
    rows.map((row: any) => ({
      position: row.position,
      points: row.points,
      status: row.status,
    })),
    {
      index,
      previousPosition: rows[index].position,
      previousStatus: rows[index].status,
      newPosition: position,
      newPoints: position,
      newStatus: status,
      maxBoats,
    },
  );
  return {
    raceId,
    // Like the real screen: only the cell the user typed in is flagged edited;
    // the boats that merely moved as a consequence (A6.1 promotion, ripple)
    // are not.
    cells: cells.map((cell, i) => ({
      boatId: rows[i].boat_id,
      position: cell.position,
      status: cell.status,
      edited: rows[i].boat_id === boatId,
    })),
  };
}

/** The same payload as an older client would send it: no `edited` flags. */
function withoutEditedFlags(operation: ReturnType<typeof operationFor>) {
  return {
    ...operation,
    cells: operation.cells.map(({ edited: _edited, ...cell }) => cell),
  };
}

const save = (
  db: any,
  raceId: number,
  boatId: number,
  position: number,
  status: string,
) =>
  handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
    operationFor(db, raceId, boatId, position, status),
  ]);

describe('saveLeaderboardRaceResultsAtomic (real SQLite, FKs on)', () => {
  let db: any;

  beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    invalidateAssignmentSnapshotCache();
    mockRecompute.failEvent = false;
  });

  afterEach(() => db.close());

  describe('SHRS 3.1(5): the next round reads the race office sheet, not the committee', () => {
    let raceB: number;
    let b1: number;
    let b2: number;
    let b3: number;

    beforeEach(async () => {
      db = seed(9);
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 3);
      await scoreHeat(db, 'Heat A1');
      raceB = await scoreHeat(db, 'Heat B1'); // b1, b2, b3 finish in order
      await scoreHeat(db, 'Heat C1');
      [b1, b2, b3] = boatsIn(db, 'Heat B1');
    });

    /**
     * Where each boat of Heat B1 went in the next round. Table 1, 3 heats,
     * from heat B: 1st stays in B, 2nd goes to A, 3rd to C.
     */
    async function nextRound() {
      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
      const next = (boat: number) =>
        db
          .prepare(
            `SELECT h.heat_name FROM Heat_Boat hb JOIN Heats h ON h.heat_id = hb.heat_id
             WHERE hb.boat_id = ? AND h.heat_name LIKE '%2'`,
          )
          .get(boat).heat_name;
      return { b1: next(b1), b2: next(b2), b3: next(b3) };
    }
    const asSailed = () => ({
      b1: 'Heat B2',
      b2: 'Heat A2',
      b3: 'Heat C2',
    });

    it('a committee DSQ of the winner moves nobody', async () => {
      await save(db, raceB, b1, 1, 'DSQ');
      expect(await nextRound()).toEqual(asSailed());
    });

    it('a race office correction moves the boats by the corrected sheet', async () => {
      await save(db, raceB, b2, 1, 'FINISHED'); // b2 finished ahead of b1
      expect(await nextRound()).toEqual({
        b1: 'Heat A2',
        b2: 'Heat B2',
        b3: 'Heat C2',
      });
    });

    it('a correction after a decision: the corrected sheet, the decided boat at her place', async () => {
      await save(db, raceB, b1, 1, 'DSQ');
      // In the results b2 is 1st and b3 2nd; the office corrects b3 to 1st.
      await save(db, raceB, b3, 1, 'FINISHED');
      // Sheet: b1 (decided, at her place), b3, b2.
      expect(await nextRound()).toEqual({
        b1: 'Heat B2',
        b2: 'Heat C2',
        b3: 'Heat A2',
      });
    });

    it('a decision taken back (DSQ to FINISHED) leaves the sheet as sailed', async () => {
      await save(db, raceB, b1, 1, 'DSQ');
      await save(db, raceB, b1, 1, 'FINISHED');
      expect(await nextRound()).toEqual(asSailed());
    });

    describe('a payload without `edited` flags (an older client)', () => {
      const saveOld = (boat: number, position: number, status: string) =>
        handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          withoutEditedFlags(operationFor(db, raceB, boat, position, status)),
        ]);

      it('reads a changed status to DSQ as the committee', async () => {
        await saveOld(b1, 1, 'DSQ');
        expect(await nextRound()).toEqual(asSailed());
      });

      it('reads changed places as a correction', async () => {
        await saveOld(b2, 1, 'FINISHED');
        expect(await nextRound()).toEqual({
          b1: 'Heat A2',
          b2: 'Heat B2',
          b3: 'Heat C2',
        });
      });
    });
  });

  describe('one transaction for the write, the A7 average and the standings', () => {
    let raceA: number;

    beforeEach(async () => {
      db = seed(4);
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 2);
      raceA = await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
    });

    it('rebuilds the standings with the saved result', async () => {
      const [first, second] = boatsIn(db, 'Heat A1');
      // The standings as the leaderboard reads them (regatta-core).
      const total = async (boat: number) =>
        (await handlerRegistry.readLeaderboard({}, EVENT_ID)).find(
          (row: any) => row.boat_id === boat,
        ).total_points_event;
      expect(await total(first)).toBe(1);

      await save(db, raceA, first, 2, 'FINISHED');

      expect(await total(first)).toBe(2);
      expect(await total(second)).toBe(1);
    });

    it('a failing standings rebuild rolls the whole save back', async () => {
      const [first] = boatsIn(db, 'Heat A1');
      const before = raceRows(db, raceA);
      mockRecompute.failEvent = true;

      await expect(save(db, raceA, first, 2, 'FINISHED')).rejects.toThrow(
        /recompute exploded/,
      );

      expect(raceRows(db, raceA)).toEqual(before);
    });

    it('re-averages boats given the same place (RRS A7)', async () => {
      const [first, second] = boatsIn(db, 'Heat A1');
      await handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
        {
          raceId: raceA,
          cells: [
            { boatId: first, position: 1, status: 'FINISHED' },
            { boatId: second, position: 1, status: 'FINISHED' },
          ],
        },
      ]);
      const rows = raceRows(db, raceA);
      expect(rows.map((row: any) => row.points)).toEqual([1.5, 1.5]);
    });

    it('stores fractional redress points and refuses a fractional place', async () => {
      const [first, second] = boatsIn(db, 'Heat A1');
      await handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
        {
          raceId: raceA,
          cells: [{ boatId: first, position: 1.5, status: 'RDG3' }],
        },
      ]);
      expect(
        raceRows(db, raceA).find((row: any) => row.boat_id === first),
      ).toMatchObject({ position: 1.5, points: 1.5, status: 'RDG3' });

      await expect(
        handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          {
            raceId: raceA,
            cells: [{ boatId: second, position: 1.5, status: 'FINISHED' }],
          },
        ]),
      ).rejects.toThrow(/must be a whole number of 1 or more/);
    });

    it('locks the discard profile once a result is saved', async () => {
      const [first] = boatsIn(db, 'Heat A1');
      await save(db, raceA, first, 2, 'FINISHED');
      expect(
        db
          .prepare(
            'SELECT shrs_discard_locked_qualifying AS l FROM Events WHERE event_id = ?',
          )
          .get(EVENT_ID).l,
      ).toBe(1);
    });

    it('refuses a change that does not carry the whole race, writing nothing', async () => {
      const [first] = boatsIn(db, 'Heat A1');
      const before = raceRows(db, raceA);
      await expect(
        handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          { raceId: raceA, boatId: first, newPosition: 2 },
        ]),
      ).rejects.toThrow(/did not include the whole race/);
      expect(raceRows(db, raceA)).toEqual(before);
    });
  });

  describe('scoring a race is all-or-nothing too (BK-2, BK-5)', () => {
    it('a failing standings rebuild leaves no race and no default DNS scores behind', async () => {
      db = seed(4);
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 2);
      mockRecompute.failEvent = true;

      await expect(scoreHeat(db, 'Heat A1')).rejects.toThrow(
        /recompute exploded/,
      );

      expect(db.prepare('SELECT COUNT(*) AS c FROM Races').get().c).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM Scores').get().c).toBe(0);
    });
  });

  describe('a Final Series race', () => {
    it('rebuilds the final standings when asked to', async () => {
      db = seed(4);
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 2);
      await scoreHeat(db, 'Heat A1');
      await scoreHeat(db, 'Heat B1');
      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
      await scoreHeat(db, 'Heat A2');
      await scoreHeat(db, 'Heat B2');
      await handlerRegistry.startFinalSeriesAtomic({}, EVENT_ID);
      const finalRace = await scoreHeat(db, 'Final Gold');
      const [first] = boatsIn(db, 'Final Gold');
      const total = async () =>
        (await handlerRegistry.readFinalLeaderboard({}, EVENT_ID)).find(
          (row: any) => row.boat_id === first,
        ).total_points_final;
      expect(await total()).toBe(1);

      await handlerRegistry.saveLeaderboardRaceResultsAtomic(
        {},
        EVENT_ID,
        [operationFor(db, finalRace, first, 2, 'FINISHED')],
        true,
      );

      expect(await total()).toBe(2);
    });
  });
});
