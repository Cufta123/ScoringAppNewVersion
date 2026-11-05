/** @jest-environment node */
export {};

// What a result correction on the leaderboard does to a race, by the rules,
// through the real Save: real migrations on a real SQLite engine
// (node:sqlite), the real handlers, regatta-core deciding.
//
// Each race is built the way a race office builds it (boats entered, heats
// made, the sheet submitted on the scoring screen, earlier corrections
// saved). A correction is then made as the edit screen makes it: the column
// as `readLeaderboard` shows it goes through shared/raceColumnEdit (the RRS
// A6.1 promotion, the place ripple), and the race is sent WHOLE to
// `saveLeaderboardRaceResultsAtomic`, which checks it, turns it into the race
// office's corrected sheet and the protest committee's decisions, and has
// regatta-core work the event out again. The assertions read the race back
// as the screen does (`readLeaderboard`: race_positions, race_points,
// race_statuses, race_held_places) and check that the projected Scores rows
// say the same.
//
// Pinned: RRS A6.1 (promotion after DSQ and every other code with no
// place), A6.2 / A10 (redress and DPI move no one; the kept place of a
// redressed boat), A9(a) (RDG1 is her average, parity R9), A7 (shared
// places), SHRS 5.2 (largest heat + 1), RRS 44.3(c) / T1 (penalty points),
// status normalisation, and the refusals of values that cannot be stored
// (nothing changes). SHRS 3.1(5) (which order the next round reads after a
// protest decision) is in HeatRaceHandler.saveLeaderboard.integration.test.ts.

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

/* eslint-disable import/first, import/order */
import { realEvent } from './fixtures/realEvent';
import applyRaceColumnEdit from '../shared/raceColumnEdit';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

/**
 * One boat's line on the scoring screen: a finishing place, a code with no
 * place ('DNS'), or a place with a penalty that keeps it ([3, 'ZFP']).
 */
type Line = number | string | [number, string];

/** A boat's result in the race as the leaderboard shows it. */
type Shown = [position: number, points: number, status: string];

let db: any;
let eventId: number;
let raceId: number;
/** boat_id of boat 1, 2, … of the race (the scenario's numbering). */
let boatIds: number[];

/**
 * An event whose race holds `sheet` as scored on the scoring screen: boat k
 * of the race has the k-th line. `largestHeat` is the size of the largest
 * heat (SHRS 5.2 scores codes at largest heat + 1); when it is more than the
 * race's boats, a second heat of that size sails the round too, so the race
 * counts in the standings (SHRS 1.1). `earlier` is a race the same boats
 * sailed before it (one heat only).
 */
async function race(
  sheet: Line[],
  {
    largestHeat = sheet.length,
    earlier,
  }: { largestHeat?: number; earlier?: Line[] } = {},
) {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  const event = realEvent(db, call);
  eventId = await event.createEvent('Corrections');

  const boats = sheet.length;
  const twoHeats = largestHeat > boats;
  const total = twoHeats ? boats + largestHeat : boats;
  await event.enterBoats(
    eventId,
    Array.from({ length: total }, (_, i) => 101 + i),
  );
  await call('createInitialHeatsAtomic', eventId, twoHeats ? 2 : 1);

  let heat = event.heatId(eventId, 'Heat A1');
  if (twoHeats) {
    // Heat A1 holds the largest heat, Heat B1 the race of the scenario.
    const other = heat;
    heat = event.heatId(eventId, 'Heat B1');
    const boatsOf = (id: number): number[] =>
      db
        .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
        .all(id)
        .map((row: { boat_id: number }) => row.boat_id);
    for (const boat of boatsOf(heat).slice(boats)) {
      // eslint-disable-next-line no-await-in-loop
      await call('transferBoatBetweenHeats', heat, other, boat);
    }
    for (const boat of boatsOf(other).slice(largestHeat)) {
      // eslint-disable-next-line no-await-in-loop
      await call('transferBoatBetweenHeats', other, heat, boat);
    }
    expect(boatsOf(other)).toHaveLength(largestHeat);
    await event.scoreHeat(eventId, 'Heat A1');
  }

  const sails = event.sailsIn(heat);
  expect(sails).toHaveLength(boats);
  const submit = async (lines: Line[]) => {
    const result = await call('submitHeatRaceScoresAtomic', {
      heat_id: heat,
      placeNumbers: lines.map((line, i) => {
        if (typeof line === 'number') {
          return { boatNumber: sails[i], place: line, status: 'FINISHED' };
        }
        if (typeof line === 'string') {
          return { boatNumber: sails[i], place: 0, status: line };
        }
        return { boatNumber: sails[i], place: line[0], status: line[1] };
      }),
    });
    expect(result.ok).toBe(true);
    return Number(result.raceId);
  };
  if (earlier) {
    expect(twoHeats).toBe(false);
    await submit(earlier);
  }
  raceId = await submit(sheet);
  boatIds = sails.map((sail) =>
    Number(
      db.prepare('SELECT boat_id FROM Boats WHERE sail_number = ?').get(sail)
        .boat_id,
    ),
  );
}

const boatNo = (boatId: number) => boatIds.indexOf(Number(boatId)) + 1;

/** The race's column of the leaderboard, as the screen reads it. */
async function shownColumn() {
  const rows: any[] = await call('readLeaderboard', eventId);
  return rows.flatMap((row) => {
    const split = (value: unknown) => String(value ?? '').split(',');
    const i = split(row.race_ids).indexOf(String(raceId));
    if (i === -1) return [];
    const held = split(row.race_held_places)[i];
    return [
      {
        boat: boatNo(row.boat_id),
        position: Number(split(row.race_positions)[i]),
        points: Number(split(row.race_points)[i]),
        status: split(row.race_statuses)[i] || 'FINISHED',
        heldPlace: held === '' ? null : Number(held),
      },
    ];
  });
}

/** The race as stored (the projection of the replayed event). */
const storedRace = () =>
  db
    .prepare(
      `SELECT boat_id, position, points, COALESCE(status, 'FINISHED') AS status,
              held_place FROM Scores WHERE race_id = ?`,
    )
    .all(raceId)
    .map((row: any) => ({
      boat: boatNo(row.boat_id),
      position: row.position,
      points: row.points,
      status: row.status,
      heldPlace: row.held_place,
    }));

/**
 * The race as the leaderboard shows it, by boat: { boat: [place, points,
 * code] }. The stored rows must say the same.
 */
async function readRace(): Promise<Record<number, Shown>> {
  const column = await shownColumn();
  const byBoat = (cells: typeof column) =>
    [...cells].sort((a, b) => a.boat - b.boat);
  expect(byBoat(storedRace())).toEqual(byBoat(column));
  return Object.fromEntries(
    column.map((cell) => [
      cell.boat,
      [cell.position, cell.points, cell.status] as Shown,
    ]),
  );
}

/** The place each boat keeps in the order (RRS A6.2), as shown. */
async function heldPlaces(): Promise<Record<number, number | null>> {
  const column = await shownColumn();
  return Object.fromEntries(column.map((cell) => [cell.boat, cell.heldPlace]));
}

/**
 * Save the race: `cells` by the scenario's boat numbers (or, for a boat not
 * in the race, by `boatId`).
 */
const save = (
  cells: Array<{
    boat?: number;
    boatId?: number;
    position: number;
    status: string;
    edited?: boolean;
    heldPlace?: number | null;
  }>,
) =>
  call('saveLeaderboardRaceResultsAtomic', eventId, [
    {
      raceId,
      cells: cells.map(({ boat, boatId, ...cell }) => ({
        boatId: boatId ?? boatIds[boat! - 1],
        ...cell,
      })),
    },
  ]);

/**
 * Correct one boat's result as the leaderboard does: the column shown goes
 * through the edit rules and is saved whole, the typed cell flagged edited.
 * `position` is the new place, or the points for RDG / DPI. `keptPlaces`
 * false sends the race as an older edit screen did, without the place a
 * redressed boat keeps.
 */
async function correct(
  boat: number,
  position: number,
  status: string,
  { keptPlaces = true } = {},
) {
  const column = await shownColumn();
  const index = column.findIndex((cell) => cell.boat === boat);
  const maxBoats = await call('getMaxHeatSize', eventId, 'Qualifying');
  const cells = applyRaceColumnEdit(
    column.map((cell) => ({
      position: cell.position,
      points: cell.points,
      status: cell.status,
      ...(cell.heldPlace != null ? { heldPlace: cell.heldPlace } : {}),
    })),
    {
      index,
      previousPosition: column[index].position,
      previousStatus: column[index].status,
      newPosition: position,
      newPoints: position,
      newStatus: status,
      maxBoats,
    },
  );
  const result = await save(
    cells.map((cell, i) => ({
      boat: column[i].boat,
      position: cell.position,
      status: cell.status,
      edited: column[i].boat === boat,
      ...(keptPlaces && /^(RDG|DPI)/.test(cell.status)
        ? { heldPlace: cell.heldPlace ?? null }
        : {}),
    })),
  );
  expect(result.success).toBe(true);
}

const finishers = (count: number): Line[] =>
  Array.from({ length: count }, (_, i) => i + 1);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  require('../main/ipcHandlers/EventHandler');
  require('../main/ipcHandlers/HeatRaceHandler');
});

afterAll(() => jest.restoreAllMocks());

afterEach(() => {
  db?.close();
  mockDbHolder.current = null;
});

describe('a leaderboard correction, by the rules (real Save)', () => {
  describe('RRS A6.1 — disqualification promotes the boats behind', () => {
    it('moves every boat behind a DSQ up one place', async () => {
      await race(finishers(4));
      await correct(2, 2, 'DSQ');
      const shown = await readRace();
      expect(shown[1]).toEqual([1, 1, 'FINISHED']);
      expect(shown[3]).toEqual([2, 2, 'FINISHED']);
      expect(shown[4]).toEqual([3, 3, 'FINISHED']);
      // SHRS 5.2: the DSQ is scored at largest heat + 1.
      expect(shown[2]).toEqual([5, 5, 'DSQ']);
    });

    it.each(['RET', 'DNE', 'DGM'])(
      'applies to %s as well as DSQ',
      async (status) => {
        await race(finishers(3));
        await correct(1, 1, status);
        const shown = await readRace();
        expect(shown[2]).toEqual([1, 1, 'FINISHED']);
        expect(shown[3]).toEqual([2, 2, 'FINISHED']);
      },
    );

    it('does not promote when the boat never finished', async () => {
      // A boat already DNS has no finishing place to vacate.
      await race([1, 'DNS', 2]);
      await correct(2, 0, 'DSQ');
      const shown = await readRace();
      expect(shown[1]).toEqual([1, 1, 'FINISHED']);
      expect(shown[3]).toEqual([2, 2, 'FINISHED']);
      expect(shown[2]).toEqual([4, 4, 'DSQ']);
    });

    it('carries a position-keeping penalty up with the finishers', async () => {
      // RRS 44.3(c): ZFP holds a real place, so it is promoted too, and its
      // points are worked out from the new place.
      await race([1, 2, [3, 'ZFP']]);
      await correct(1, 1, 'DSQ');
      const shown = await readRace();
      expect(shown[2]).toEqual([1, 1, 'FINISHED']);
      // 2 + 20% of the DNF score (4) = 2.8.
      expect(shown[3]).toEqual([2, 2.8, 'ZFP']);
    });
  });

  describe('RRS A6.2 / A10 — redress and DPI never move anyone', () => {
    it('leaves every other boat untouched for RDG1', async () => {
      // In the race before, boat 2 was 3rd.
      await race(finishers(4), { earlier: [4, 3, 2, 1] });
      await correct(2, 2.5, 'RDG1');
      const shown = await readRace();
      expect(shown[1]).toEqual([1, 1, 'FINISHED']);
      expect(shown[3]).toEqual([3, 3, 'FINISHED']);
      expect(shown[4]).toEqual([4, 4, 'FINISHED']);
      // RRS A9(a): RDG1 is the average of her other races (here 3), not a
      // value typed in the cell. The old write path stored the typed 2.5.
      expect(shown[2]).toEqual([3, 3, 'RDG1']);
      expect((await heldPlaces())[2]).toBe(2);
    });

    it('RDG1 with nothing to average scores as no place until there is', async () => {
      // Parity decision R9 (RRS A9): worked out again on each read; with no
      // other race it is largest heat + 1 (SHRS 5.2), whatever was typed.
      await race(finishers(4));
      await correct(2, 2.5, 'RDG1');
      const shown = await readRace();
      expect(shown[2]).toEqual([5, 5, 'RDG1']);
      expect(shown[3]).toEqual([3, 3, 'FINISHED']);
    });

    it('keeps the provided value for DPI without displacing', async () => {
      await race(finishers(3));
      await correct(1, 1.5, 'DPI');
      const shown = await readRace();
      expect(shown[1]).toEqual([1.5, 1.5, 'DPI']);
      expect(shown[2]).toEqual([2, 2, 'FINISHED']);
      expect(shown[3]).toEqual([3, 3, 'FINISHED']);
    });
  });

  describe('a new place moves the boat; the boats in between make room', () => {
    it('ripples the boats between old and new place', async () => {
      await race(finishers(4));
      // Move the 4th boat up to 2nd: the boats it passes drop one place.
      await correct(4, 2, 'FINISHED');
      const shown = await readRace();
      expect(shown[1]).toEqual([1, 1, 'FINISHED']);
      expect(shown[4]).toEqual([2, 2, 'FINISHED']);
      expect(shown[2]).toEqual([3, 3, 'FINISHED']);
      expect(shown[3]).toEqual([4, 4, 'FINISHED']);
    });

    it('ripples downward moves too', async () => {
      await race(finishers(4));
      await correct(1, 3, 'FINISHED');
      const shown = await readRace();
      expect(shown[2]).toEqual([1, 1, 'FINISHED']);
      expect(shown[3]).toEqual([2, 2, 'FINISHED']);
      expect(shown[1]).toEqual([3, 3, 'FINISHED']);
      expect(shown[4]).toEqual([4, 4, 'FINISHED']);
    });

    it('puts a boat that had no place into the order; the rest move down', async () => {
      await race([1, 2, 3, 'DNF'], { largestHeat: 10 });
      // Found to have finished 2nd after all.
      await correct(4, 2, 'FINISHED');
      const shown = await readRace();
      expect(shown[1]).toEqual([1, 1, 'FINISHED']);
      expect(shown[4]).toEqual([2, 2, 'FINISHED']);
      expect(shown[2]).toEqual([3, 3, 'FINISHED']);
      expect(shown[3]).toEqual([4, 4, 'FINISHED']);
    });

    it('giving a redressed boat a place back never puts a boat past the last', async () => {
      // Found by the chaos test: 3 boats, the 2nd given redress, then given
      // 3rd place again pushed the 3rd boat to 4th of 3.
      await race(finishers(3), { largestHeat: 10 });
      await correct(2, 5, 'RDG3');
      await correct(2, 3, 'FINISHED');
      const shown = await readRace();
      expect(shown[1]).toEqual([1, 1, 'FINISHED']);
      expect(shown[3]).toEqual([2, 2, 'FINISHED']);
      expect(shown[2]).toEqual([3, 3, 'FINISHED']);
    });

    it('keeps a dead heat when a tied boat only gets a ZFP', async () => {
      await race([1, 1, 3], { largestHeat: 10 });
      await correct(2, 1, 'ZFP');
      const shown = await readRace();
      expect(shown[1]).toEqual([1, 1.5, 'FINISHED']);
      // RRS 44.3(c) 2025-2028: her ZFP adds to the shared 1.5, not to 1
      // (1.5 + 20% of 11).
      expect(shown[2]).toEqual([1, 3.7, 'ZFP']);
      expect(shown[3]).toEqual([3, 3, 'FINISHED']);
    });

    it('carries position-keeping penalties along the ripple', async () => {
      // LB-7: a ZFP occupies a place, so a ripple past it must move it, or the
      // A7 re-average would read its stale place as a shared one.
      await race([1, [2, 'ZFP'], 3]);
      await correct(3, 2, 'FINISHED');
      const shown = await readRace();
      expect(shown[3]).toEqual([2, 2, 'FINISHED']);
      // 3 + 20% of 4 = 3.8.
      expect(shown[2]).toEqual([3, 3.8, 'ZFP']);
    });
  });

  describe('RRS A7 — shared places split the points', () => {
    it('averages a tie created by a promotion', async () => {
      await race([1, 2, 2, 4]);
      await correct(1, 1, 'DSQ');
      const shown = await readRace();
      // The tied pair takes places 1 and 2 => 1.5 each; the next boat is 3rd.
      expect(shown[2]).toEqual([1, 1.5, 'FINISHED']);
      expect(shown[3]).toEqual([1, 1.5, 'FINISHED']);
      expect(shown[4]).toEqual([3, 3, 'FINISHED']);
    });

    it('re-averages after a move onto an occupied place', async () => {
      await race(finishers(3));
      await correct(3, 1, 'FINISHED');
      const shown = await readRace();
      expect(shown[3]).toEqual([1, 1, 'FINISHED']);
      expect(shown[1]).toEqual([2, 2, 'FINISHED']);
      expect(shown[2]).toEqual([3, 3, 'FINISHED']);
    });

    it('stores a shared place sent by the screen as an A7 average', async () => {
      await race(finishers(4));
      await save([
        { boat: 2, position: 2, status: 'FINISHED' },
        { boat: 3, position: 2, status: 'FINISHED' },
      ]);
      const shown = await readRace();
      expect(shown[2]).toEqual([2, 2.5, 'FINISHED']);
      expect(shown[3]).toEqual([2, 2.5, 'FINISHED']);
      expect(shown[4]).toEqual([4, 4, 'FINISHED']);
    });
  });

  describe('SHRS 5.2 — non-finishers score largest heat + 1', () => {
    it('uses the largest heat size, not the number of boats in the race', async () => {
      // Three boats in this heat, but the largest heat holds 10: DNF scores 11.
      await race(finishers(3), { largestHeat: 10 });
      await correct(3, 0, 'DNF');
      expect((await readRace())[3]).toEqual([11, 11, 'DNF']);
    });

    it('discards the provided position for a non-scoring penalty', async () => {
      // A caller may send 0 or a stale place; it must not be written.
      await race(finishers(3));
      await correct(2, 99, 'DNS');
      expect((await readRace())[2]).toEqual([4, 4, 'DNS']);
    });
  });

  describe('RRS 44.3(c) / T1 — penalty points and the cap', () => {
    it('scores ZFP as place + 20% of the DNF score', async () => {
      // largest heat 10 => DNF score 11 => 20% = 2.2 => 3 + 2.2 = 5.2
      await race(finishers(3), { largestHeat: 10 });
      await correct(3, 3, 'ZFP');
      expect((await readRace())[3]).toEqual([3, 5.2, 'ZFP']);
    });

    it('caps SCP at the DNF score', async () => {
      // largest heat 5 => 20% of 6 = 1.2 => 5 + 1.2 = 6.2, capped at 6.
      await race(finishers(5));
      await correct(5, 5, 'SCP');
      expect((await readRace())[5]).toEqual([5, 6, 'SCP']);
    });

    it('applies no artificial minimum in a small heat', async () => {
      // largest heat 5 => 20% of 6 = 1.2 (no minimum) => 2 + 1.2 = 3.2
      await race(finishers(5));
      await correct(2, 2, 'ZFP');
      expect((await readRace())[2]).toEqual([2, 3.2, 'ZFP']);
    });

    it('scores T1 as place + 30% of the DNF score', async () => {
      // largest heat 10 => 30% of 11 = 3.3 => 4 + 3.3 = 7.3
      await race(finishers(5), { largestHeat: 10 });
      await correct(4, 4, 'T1');
      expect((await readRace())[4]).toEqual([4, 7.3, 'T1']);
    });
  });

  describe('a code with no finishing place moves the boats behind up', () => {
    // RRS A6.1 for DSQ/RET/DNE/DGM, and the same for every other code with
    // no finishing place: a boat that did not start or finish never held the
    // place, so the result equals entering her with that code in the first
    // place.
    it.each([
      'DSQ',
      'RET',
      'DNE',
      'DGM',
      'DNF',
      'DNS',
      'OCS',
      'BFD',
      'UFD',
      'DNC',
      'NSC',
    ])('%s promotes the boats behind', async (status) => {
      await race(finishers(3), { largestHeat: 10 });
      await correct(1, 1, status);
      const shown = await readRace();
      expect(shown[2]).toEqual([1, 1, 'FINISHED']);
      expect(shown[3]).toEqual([2, 2, 'FINISHED']);
      expect(shown[1]).toEqual([11, 11, status]);
    });
  });

  describe('status normalisation and refusals', () => {
    it('normalises RAF to RET', async () => {
      await race(finishers(3), { largestHeat: 10 });
      await correct(2, 2, 'RAF');
      expect((await readRace())[2]).toEqual([11, 11, 'RET']);
    });

    it('keeps a fractional RDG3 / DPI value as set by the protest committee', async () => {
      await race(finishers(3), { largestHeat: 10 });
      await save([
        { boat: 1, position: 4.5, status: 'RDG3' },
        { boat: 2, position: 2.5, status: 'DPI' },
      ]);
      const shown = await readRace();
      expect(shown[1]).toEqual([4.5, 4.5, 'RDG3']);
      expect(shown[2]).toEqual([2.5, 2.5, 'DPI']);
      expect(shown[3]).toEqual([3, 3, 'FINISHED']);
    });

    /**
     * Save `cells`, expecting a refusal: its words. A refused save leaves the
     * race exactly as it was.
     */
    async function refusal(cells: Parameters<typeof save>[0]) {
      const before = await readRace();
      const error = await save(cells).then(
        () => null,
        (failure: Error) => failure,
      );
      expect(await readRace()).toEqual(before);
      return error?.message ?? 'saved';
    }

    it('refuses a code this app does not know', async () => {
      await race(finishers(3));
      expect(await refusal([{ boat: 1, position: 3, status: 'FOO' }])).toMatch(
        '"FOO" is not a result code this app knows.',
      );
    });

    it.each([0, Number.NaN])(
      'refuses %p as a finishing place instead of writing it (BK-6)',
      async (position) => {
        await race(finishers(3));
        expect(
          await refusal([{ boat: 1, position, status: 'FINISHED' }]),
        ).toMatch(/must be a whole number of 1 or more/);
      },
    );

    it('refuses a fractional finishing place', async () => {
      await race(finishers(3));
      expect(
        await refusal([{ boat: 1, position: 2.5, status: 'FINISHED' }]),
      ).toMatch(/must be a whole number of 1 or more/);
    });

    it.each([
      ['RDG2', 0],
      ['DPI', -1],
    ])(
      'refuses %s with points of %p (BK-6 / CMP C-23)',
      async (status, value) => {
        await race(finishers(3));
        expect(await refusal([{ boat: 1, position: value, status }])).toMatch(
          /must be a number above 0/,
        );
      },
    );

    it('refuses a place past the last boat of the race', async () => {
      await race(finishers(3), { largestHeat: 10 });
      expect(
        await refusal([{ boat: 1, position: 4, status: 'FINISHED' }]),
      ).toMatch(/place 4 is not possible, only 3 boats sailed this race/);
    });

    it('refuses redress points above 99', async () => {
      await race(finishers(3), { largestHeat: 10 });
      expect(
        await refusal([{ boat: 1, position: 100, status: 'RDG3' }]),
      ).toMatch(/100 points is more than the 99 allowed/);
    });

    it('refuses a result for a boat that did not sail the race', async () => {
      await race(finishers(2), { largestHeat: 10 });
      // A boat of the other heat.
      const other = Number(
        db
          .prepare(
            `SELECT hb.boat_id FROM Heat_Boat hb JOIN Heats h ON h.heat_id = hb.heat_id
             WHERE h.event_id = ? AND h.heat_name = 'Heat A1'`,
          )
          .get(eventId).boat_id,
      );
      expect(
        await refusal([{ boatId: other, position: 1, status: 'FINISHED' }]),
      ).toMatch(/did not sail .*, so it has no result there/i);
    });

    it('refuses the same boat twice in one race', async () => {
      await race(finishers(2));
      expect(
        await refusal([
          { boat: 1, position: 1, status: 'FINISHED' },
          { boat: 1, position: 2, status: 'FINISHED' },
        ]),
      ).toMatch(/appears twice/i);
    });

    it('refuses a change that does not send its whole race', async () => {
      await race(finishers(2));
      const before = await readRace();
      await expect(
        call('saveLeaderboardRaceResultsAtomic', eventId, [
          { raceId, boatId: boatIds[0], position: 2, status: 'FINISHED' },
        ]),
      ).rejects.toThrow(/did not include the whole race/);
      expect(await readRace()).toEqual(before);
    });
  });
});

describe('RRS A6.2: a redressed boat keeps her place in the order', () => {
  // Five boats, 3 and 4 level on 3rd: 1, 2, 3.5, 3.5, 5.
  const tiedRace = (): Line[] => [1, 2, 3, 3, 5];

  it.each(['RDG3', 'DPI'])(
    '%s for one of two boats level: the other still shares the place',
    async (status) => {
      await race(tiedRace());
      await correct(3, 2.5, status);
      const shown = await readRace();
      expect(shown[3]).toEqual([2.5, 2.5, status]);
      // Used to become 3: the redressed boat no longer counted for the tie.
      expect(shown[4]).toEqual([3, 3.5, 'FINISHED']);
      expect(shown[5]).toEqual([5, 5, 'FINISHED']);
      expect((await heldPlaces())[3]).toBe(3);
    },
  );

  it('a disqualification ahead moves her kept place up with the others', async () => {
    await race(tiedRace());
    await correct(3, 4, 'RDG3');
    await correct(1, 0, 'DSQ');
    const shown = await readRace();
    // 2 -> 1st; 3 (kept) and 4 level on 2nd; 5 -> 4th (A6.1).
    expect(shown[2]).toEqual([1, 1, 'FINISHED']);
    expect((await heldPlaces())[3]).toBe(2);
    expect(shown[4]).toEqual([2, 2.5, 'FINISHED']);
    expect(shown[5]).toEqual([4, 4, 'FINISHED']);
  });

  it('taking the redress away gives her a place back in the order', async () => {
    await race(tiedRace());
    await correct(3, 4, 'RDG3');
    // A typed place moves her in, the boats from there make room (a dead
    // heat is entered with the tie control, not by typing a place).
    await correct(3, 3, 'FINISHED');
    const shown = await readRace();
    expect(shown[3]).toEqual([3, 3, 'FINISHED']);
    expect(shown[4]).toEqual([4, 4, 'FINISHED']);
    expect(shown[5]).toEqual([5, 5, 'FINISHED']);
    expect((await heldPlaces())[3]).toBeNull();
  });

  it('a disqualification after redress leaves the order (A6.1)', async () => {
    await race(tiedRace());
    await correct(3, 4, 'RDG3');
    await correct(3, 0, 'DSQ');
    const shown = await readRace();
    expect(shown[4]).toEqual([3, 3, 'FINISHED']);
    expect(shown[5]).toEqual([4, 4, 'FINISHED']);
    expect((await heldPlaces())[3]).toBeNull();
  });

  it('redress for a boat with no place keeps none', async () => {
    await race([1, 2, 3, 3, 'DNF']);
    await correct(5, 3, 'RDG3');
    expect((await heldPlaces())[5]).toBeNull();
    expect((await readRace())[4]).toEqual([3, 3.5, 'FINISHED']);
  });

  it('a request without kept places keeps the place she held before', async () => {
    // An older edit screen sends only place and code.
    await race(tiedRace());
    await correct(3, 2.5, 'RDG3', { keptPlaces: false });
    expect((await heldPlaces())[3]).toBe(3);
    expect((await readRace())[4]).toEqual([3, 3.5, 'FINISHED']);
  });
});
