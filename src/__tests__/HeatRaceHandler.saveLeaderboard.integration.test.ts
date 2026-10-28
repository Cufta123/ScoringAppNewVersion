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

// Lets one test make the standings rebuild fail, to prove the save rolls back.
const mockRecompute = { failEvent: false };
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
import {
  invalidateAssignmentSnapshotCache,
  raceAssignmentSnapshots,
} from '../main/functions/raceAssignmentSnapshot';
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

  describe('SHRS 3.1.5 — the next round is seeded from the shielded order', () => {
    let raceB: number;
    let b1: number;
    let b2: number;
    let b3: number;

    beforeEach(async () => {
      db = seed(9);
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 3);
      await scoreHeat(db, 'Heat A1');
      raceB = await scoreHeat(db, 'Heat B1');
      await scoreHeat(db, 'Heat C1');
      [b1, b2, b3] = boatsIn(db, 'Heat B1');
    });

    /** Where each boat of Heat B1 went in the next round (Table 1, 3 heats). */
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

    const shield = () => raceAssignmentSnapshots.get(raceB);

    it('a protest-committee DSQ freezes the order, so the DSQ does not move her', async () => {
      await save(db, raceB, b1, 1, 'DSQ');
      expect(shield()?.get(String(b1))).toEqual({
        position: 1,
        status: 'FINISHED',
      });
      expect(
        db
          .prepare(
            'SELECT frozen_position AS p, frozen_status AS s FROM RaceAssignmentSnapshots WHERE boat_id = ?',
          )
          .get(b1),
      ).toEqual({ p: 1, s: 'FINISHED' });

      // Rank 1 -> B, rank 2 -> A, rank 3 -> C. b1 keeps rank 1 although she
      // is now disqualified.
      expect(await nextRound()).toEqual({
        b1: 'Heat B2',
        b2: 'Heat A2',
        b3: 'Heat C2',
      });
    });

    it('an ordinary correction changes the next round (nothing is frozen)', async () => {
      // The race office had b1 and b2 the wrong way round.
      await save(db, raceB, b1, 2, 'FINISHED');
      expect(shield()).toBeUndefined();
      expect(await nextRound()).toEqual({
        b1: 'Heat A2',
        b2: 'Heat B2',
        b3: 'Heat C2',
      });
    });

    it('an ordinary correction unshields only the corrected boat', async () => {
      // The last boat is disqualified: nobody moves, so all three are frozen.
      await save(db, raceB, b3, 3, 'DSQ');
      expect(shield()?.size).toBe(3);

      await save(db, raceB, b3, 3, 'DNF');

      expect(shield()?.has(String(b3))).toBe(false);
      expect(shield()?.has(String(b1))).toBe(true);
      expect(shield()?.has(String(b2))).toBe(true);
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM RaceAssignmentSnapshots').get().c,
      ).toBe(2);
    });

    it('keeps a protest-DSQ boat shielded when others are corrected, and gives her the contested place', async () => {
      await save(db, raceB, b1, 1, 'DSQ');
      // Live: b2 1st, b3 2nd. The office corrects b3 to 1st: she is live 1st,
      // the place b1 holds frozen (b2 only moved down as a consequence).
      await save(db, raceB, b3, 1, 'FINISHED');

      expect(shield()?.has(String(b1))).toBe(true);
      expect(shield()?.has(String(b3))).toBe(false);
      expect(await nextRound()).toEqual({
        b1: 'Heat B2',
        b3: 'Heat A2',
        b2: 'Heat C2',
      });
    });

    it('drops the snapshot once the last shielded boat is corrected', async () => {
      // The DSQ froze all three boats; the promoted two stay frozen until the
      // race office corrects them, each on her own.
      await save(db, raceB, b1, 1, 'DSQ');
      await save(db, raceB, b1, 1, 'FINISHED');
      expect(shield()?.size).toBe(2);
      await save(db, raceB, b2, 3, 'FINISHED');
      expect(shield()?.size).toBe(1);
      await save(db, raceB, b3, 3, 'FINISHED');
      expect(shield()).toBeUndefined();
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM RaceAssignmentSnapshots').get().c,
      ).toBe(0);
    });

    it('freezes a boat at her pre-decision place when a later decision names her', async () => {
      await save(db, raceB, b1, 1, 'DSQ');
      // b2 is live 1st now (promoted, frozen at 2nd); the committee then
      // disqualifies her too. She keeps the place she held before ANY decision.
      await save(db, raceB, b2, 1, 'DSQ');

      expect(shield()?.get(String(b2))).toEqual({
        position: 2,
        status: 'FINISHED',
      });
      expect(shield()?.has(String(b1))).toBe(true);
      expect(shield()?.get(String(b3))).toEqual({
        position: 3,
        status: 'FINISHED',
      });
    });

    it('puts the frozen rows back in memory when the save fails', async () => {
      await save(db, raceB, b3, 3, 'DSQ');
      const frozenBefore = new Map(shield()!);
      const scoresBefore = raceRows(db, raceB);

      // The first race is corrected (and b3 unshielded in memory); the second
      // names a race that does not exist, so the whole save fails.
      await expect(
        handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          operationFor(db, raceB, b3, 3, 'DNF'),
          { raceId: 987654, cells: [] },
        ]),
      ).rejects.toThrow(/no longer part of this event/);

      expect(new Map(shield()!)).toEqual(frozenBefore);
      expect(shield()?.size).toBe(3);
      expect(raceRows(db, raceB)).toEqual(scoresBefore);
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM RaceAssignmentSnapshots').get().c,
      ).toBe(3);
    });

    it('removes a snapshot the failed save had created', async () => {
      await expect(
        handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          operationFor(db, raceB, b1, 1, 'DSQ'),
          { raceId: 987654, cells: [] },
        ]),
      ).rejects.toThrow();
      expect(shield()).toBeUndefined();
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM RaceAssignmentSnapshots').get().c,
      ).toBe(0);
    });
  });

  describe('SHRS 3.1.5 — only the cells the user edited decide the shield', () => {
    // Four boats per heat, so a DSQ of the winner promotes THREE boats (RRS
    // A6.1). Those boats' places change because of the protest decision, so
    // they must stay frozen at their pre-protest place; only a cell the user
    // typed in can be a "decision" or a "correction".
    let raceB: number;
    let b1: number;
    let b2: number;
    let b3: number;
    let b4: number;
    let control: Record<number, string>;

    /**
     * b1..b4 are Heat B1's boats in finishing order. Scores are stored in the
     * heat's boat order, so with `winnerLast` the winner has the HIGHEST score_id.
     */
    async function playRoundOne(winnerLast: boolean) {
      await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 3);
      await scoreHeat(db, 'Heat A1');
      const boats = boatsIn(db, 'Heat B1');
      const finishing = winnerLast ? [...boats].reverse() : boats;
      const result = await handlerRegistry.submitHeatRaceScoresAtomic(
        {},
        {
          heat_id: heatId(db, 'Heat B1'),
          placeNumbers: finishing.map((boat, index) => ({
            boatNumber: boat,
            place: index + 1,
            status: 'FINISHED',
          })),
        },
      );
      expect(result.ok).toBe(true);
      raceB = result.raceId;
      await scoreHeat(db, 'Heat C1');
      [b1, b2, b3, b4] = finishing;
    }

    /** Heat of every boat in round 2. */
    async function roundTwo(): Promise<Record<number, string>> {
      await handlerRegistry.createNewHeatsBasedOnLeaderboard({}, EVENT_ID);
      const rows = db
        .prepare(
          `SELECT hb.boat_id, h.heat_name FROM Heat_Boat hb JOIN Heats h ON h.heat_id = hb.heat_id
           WHERE h.event_id = ? AND h.heat_name LIKE '%2'`,
        )
        .all(EVENT_ID);
      return Object.fromEntries(
        rows.map((row: any) => [row.boat_id, row.heat_name]),
      );
    }

    /** Round 2 of an event with no protest at all, then a fresh event after round 1. */
    async function setUp(winnerLast = false) {
      db = seed(12);
      await playRoundOne(winnerLast);
      control = await roundTwo();
      db.close();
      invalidateAssignmentSnapshotCache();
      db = seed(12);
      await playRoundOne(winnerLast);
    }

    const shield = () => raceAssignmentSnapshots.get(raceB);
    const frozenPlaces = () =>
      Object.fromEntries(
        [...(shield() ?? new Map())].map(([boat, row]) => [
          boat,
          [row.position, row.status],
        ]),
      );
    const byId = (boats: number[]) => [...boats].sort((x, y) => x - y);
    const persistedBoats = (): number[] =>
      db
        .prepare(
          'SELECT boat_id FROM RaceAssignmentSnapshots WHERE race_id = ? ORDER BY boat_id',
        )
        .all(raceB)
        .map((row: any) => row.boat_id);

    it.each([
      ['the winner has the lowest score_id', false],
      ['the winner has the highest score_id', true],
    ])(
      'a DSQ of the winner keeps all four boats at their pre-protest place (%s)',
      async (_label, reverse) => {
        await setUp(reverse);
        await save(db, raceB, b1, 1, 'DSQ');

        // The three promoted boats are live 1, 2, 3 now, but were 2, 3, 4.
        const live = raceRows(db, raceB);
        expect(live.find((row: any) => row.boat_id === b2).position).toBe(1);
        expect(frozenPlaces()).toEqual({
          [b1]: [1, 'FINISHED'],
          [b2]: [2, 'FINISHED'],
          [b3]: [3, 'FINISHED'],
          [b4]: [4, 'FINISHED'],
        });
        expect(persistedBoats()).toEqual(byId([b1, b2, b3, b4]));

        // The next round is exactly the round without any protest.
        expect(await roundTwo()).toEqual(control);
      },
    );

    it('an office correction of one boat un-shields only that boat', async () => {
      await setUp();
      await save(db, raceB, b1, 1, 'DSQ');
      // Live b2 1st, b3 2nd, b4 3rd. The race office puts b3 3rd (b4 2nd).
      await save(db, raceB, b3, 3, 'FINISHED');

      expect(Object.keys(frozenPlaces()).map(Number).sort()).toEqual(
        [b1, b2, b4].sort(),
      );
      expect(persistedBoats()).toEqual(byId([b1, b2, b4]));
      // b4 only moved as a consequence of that correction: still frozen at 4.
      expect(frozenPlaces()[b4]).toEqual([4, 'FINISHED']);
    });

    it('a decision reversed to FINISHED by the race office un-shields only the reversed boat', async () => {
      await setUp();
      await save(db, raceB, b1, 1, 'DSQ');
      await save(db, raceB, b1, 1, 'FINISHED');

      expect(Object.keys(frozenPlaces()).map(Number).sort()).toEqual(
        [b2, b3, b4].sort(),
      );
      // Everyone is back where they started, so the round is the control round.
      expect(await roundTwo()).toEqual(control);
    });

    it('a second decision freezes a promoted boat an earlier correction had un-shielded', async () => {
      await setUp();
      await save(db, raceB, b1, 1, 'DSQ');
      // Live b2, b3, b4. The office swaps b3 and b4: b3 is un-shielded, at 3rd.
      await save(db, raceB, b3, 3, 'FINISHED');
      // The committee disqualifies b2 (live 1st): b4 and b3 are promoted. b3
      // has no frozen row, so she must be frozen now at the place she held
      // before THIS decision, or the decision would reorder her.
      await save(db, raceB, b2, 1, 'DSQ');

      expect(frozenPlaces()[b3]).toEqual([3, 'FINISHED']);
      expect(frozenPlaces()[b2]).toEqual([2, 'FINISHED']);
    });

    describe('a payload without `edited` flags (an older client)', () => {
      // Safest reading: a cell counts as edited when its STATUS changed. A
      // protest code is then never missed (the freeze is kept), and a boat
      // that only moved is never un-shielded. A place-only change cannot be
      // told from a ripple, so it leaves every shield as it is.
      it('still freezes the whole race on a DSQ of the winner', async () => {
        await setUp();
        await handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          withoutEditedFlags(operationFor(db, raceB, b1, 1, 'DSQ')),
        ]);
        expect(Object.keys(frozenPlaces())).toHaveLength(4);
        expect(await roundTwo()).toEqual(control);
      });

      it('un-shields only the boat whose status the office changed', async () => {
        await setUp();
        await save(db, raceB, b1, 1, 'DSQ');
        await handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          withoutEditedFlags(operationFor(db, raceB, b1, 1, 'FINISHED')),
        ]);
        expect(Object.keys(frozenPlaces()).map(Number).sort()).toEqual(
          [b2, b3, b4].sort(),
        );
      });

      it('leaves the shields alone when only places changed', async () => {
        await setUp();
        await save(db, raceB, b1, 1, 'DSQ');
        await handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          withoutEditedFlags(operationFor(db, raceB, b3, 3, 'FINISHED')),
        ]);
        expect(Object.keys(frozenPlaces())).toHaveLength(4);
      });
    });

    it('puts the frozen rows back in memory when a save with promoted boats fails', async () => {
      await setUp();
      await expect(
        handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
          operationFor(db, raceB, b1, 1, 'DSQ'),
          { raceId: 987654, cells: [] },
        ]),
      ).rejects.toThrow();
      expect(shield()).toBeUndefined();
      expect(persistedBoats()).toEqual([]);
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
      const total = (boat: number) =>
        db
          .prepare(
            'SELECT total_points_event AS t FROM Leaderboard WHERE boat_id = ?',
          )
          .get(boat).t;
      expect(total(first)).toBe(1);

      await save(db, raceA, first, 2, 'FINISHED');

      expect(total(first)).toBe(2);
      expect(total(second)).toBe(1);
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
      const total = () =>
        db
          .prepare(
            'SELECT total_points_final AS t FROM FinalLeaderboard WHERE boat_id = ?',
          )
          .get(first).t;
      expect(total()).toBe(1);

      await handlerRegistry.saveLeaderboardRaceResultsAtomic(
        {},
        EVENT_ID,
        [operationFor(db, finalRace, first, 2, 'FINISHED')],
        true,
      );

      expect(total()).toBe(2);
    });
  });
});
