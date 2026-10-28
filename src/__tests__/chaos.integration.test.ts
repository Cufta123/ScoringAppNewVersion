/** @jest-environment node */
export {};

/**
 * Chaos: long random sequences of everything a race office does — score,
 * undo a race, build and undo the next round, late entries, moving a boat
 * between heats, leaderboard corrections, undo from the history, start the
 * final series, read every screen — through the real handlers on real SQLite.
 *
 * Nothing may fail except the app's own guards (each listed below with the
 * situation it protects), and after every step the data must hold together:
 * foreign keys intact, one score per boat per race, places inside the race,
 * every stored race scored by the rules, and every total on the leaderboard
 * equal to its races minus the discards.
 */

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
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';
import { rescoreRace } from '../main/functions/raceScoring';
import { setCallObserver } from '../main/ipcHandlers/handle';
import { isTechnicalText } from '../shared/errors/explainError';
import { journalObserver } from '../main/functions/changeJournal';
import applyRaceColumnEdit, {
  holdsPlace,
  scoreRaceColumn,
} from '../shared/raceColumnEdit';
import {
  payloadFor,
  prng,
  randomOutcome,
  tenth,
} from './fixtures/scoringOracle';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

/**
 * The guards: refusals that protect the data, with the situation each is for.
 * Anything else that throws is a bug.
 */
const GUARDS: RegExp[] = [
  /Cannot score .* Final Series has already started/i, // qualifying closed
  /already been built from|next round .* built|Undo the redistribution/i, // round built on it
  /no (scored )?race to undo|nothing to undo|No races? (have been )?scored/i,
  /different race counts|not all sailed the same number of races|not every heat|has not sailed|still being sailed|Not all heats have the same number of races/i, // round incomplete
  /Cannot undo|was changed again later|Undo that change first/i, // history conflict
  /scoring page|event settings|by itself|nothing to undo/i, // not undoable here
  /Final series has already been started/i,
  /needs at least 2 qualifying heats/i,
  /no redistribution|first round|Cannot undo .* round/i,
  /races have already been scored|has raced|already raced|after a race/i,
  /not in (a|any|the) current|current-round|cannot be assigned|already in a heat|not entered/i,
  /Cannot (create|build) new heats|no assignments/i,
  /no longer in the history/i,
  /final series/i,
  /There is no heat redistribution to undo/i,
  /No scored race found to undo/i,
  /has already raced\. Undo its race first/i, // moving a boat
  /Score the current round before/i,
  /Nothing was changed after this point/i,
  /has no qualifying heats yet/i, // back to before the heats
  /No boats are registered for this event yet/i, // back to before the entries
];

const isGuard = (error: unknown) =>
  GUARDS.some((pattern) => pattern.test((error as Error)?.message ?? ''));

describe('chaos: random race-office sessions keep the data whole', () => {
  let db: any;
  let unexpected: string[] = [];

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
    setCallObserver(journalObserver);
  });
  afterAll(() => {
    setCallObserver(null);
    jest.restoreAllMocks();
  });

  it('a race whose rows came back one by one is scored again (found by chaos)', async () => {
    // An undo from the history restores each row as it was; when a later
    // action had moved another boat onto that place, the two share it and
    // must split the points (RRS A7). rescoreRace does that after an undo.
    invalidateAssignmentSnapshotCache();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
    const eventId = Number(
      (
        await call(
          'insertEvent',
          'Undo tie',
          'Split',
          '2026-05-01',
          '2026-05-03',
        )
      ).lastInsertRowid,
    );
    for (let sail = 1; sail <= 4; sail += 1) {
      const id = Number(
        db
          .prepare(
            "INSERT INTO Boats (sail_number, country, model) VALUES (?, 'CRO', 'IOM')",
          )
          .run(sail).lastInsertRowid,
      );
      // eslint-disable-next-line no-await-in-loop
      await call('associateBoatWithEvent', id, eventId);
    }
    await call('createInitialHeatsAtomic', eventId, 1);
    const heat = db.prepare('SELECT heat_id FROM Heats').get();
    const { raceId } = await call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: [1, 2, 3, 4].map((sail) => ({
        boatNumber: sail,
        place: sail,
        status: 'FINISHED',
      })),
    });
    // The state an undo can leave: boats 2 and 4 both 2nd, scored 2 each.
    db.prepare(
      'UPDATE Scores SET position = 2, points = 2 WHERE race_id = ? AND boat_id = 4',
    ).run(raceId);
    rescoreRace(raceId);
    const race = db
      .prepare(
        'SELECT boat_id, position, points FROM Scores WHERE race_id = ? ORDER BY boat_id',
      )
      .all(raceId)
      .map((r: any) => [r.boat_id, r.position, r.points]);
    expect(race).toEqual([
      [1, 1, 1],
      [2, 2, 2.5],
      [3, 3, 3],
      [4, 2, 2.5],
    ]);
    db.close();
  });

  const SEEDS = Array.from(
    { length: Number(process.env.CHAOS_SEEDS || 25) },
    (_, i) => i + 1,
  );

  it.each(SEEDS)('session %i', async (seed) => {
    unexpected = [];
    invalidateAssignmentSnapshotCache();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
    const rand = prng(seed * 31337);
    const pick = <T>(list: T[]): T | undefined =>
      list.length ? list[Math.floor(rand() * list.length)] : undefined;

    const eventId = Number(
      (
        await call(
          'insertEvent',
          `Chaos ${seed}`,
          'Split',
          '2026-05-01',
          '2026-05-03',
        )
      ).lastInsertRowid,
    );
    let nextSail = 1;
    const NATIONS = ['CRO', 'ITA', 'GBR', 'AUS'];
    const enterBoat = async () => {
      const sail = nextSail;
      nextSail += 1;
      const id = Number(
        db
          .prepare(
            "INSERT INTO Boats (sail_number, country, model) VALUES (?, ?, 'IOM')",
          )
          .run(sail % 9 === 0 ? 5 : sail, pick(NATIONS)).lastInsertRowid,
      );
      try {
        await call('associateBoatWithEvent', id, eventId);
      } catch (error) {
        if (!/already entered/.test((error as Error).message)) throw error;
      }
      return id;
    };
    const boats = 6 + Math.floor(rand() * 20);
    for (let i = 0; i < boats; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await enterBoat();
    }
    const heatCount = 2 + Math.floor(rand() * 2);
    await call('createInitialHeatsAtomic', eventId, heatCount);

    const heatsNow = () =>
      db
        .prepare(
          'SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?',
        )
        .all(eventId) as {
        heat_id: number;
        heat_name: string;
        heat_type: string;
      }[];
    const sailsIn = (heatId: number) =>
      db
        .prepare(
          `SELECT b.sail_number, b.country FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id
           WHERE hb.heat_id = ?`,
        )
        .all(heatId) as { sail_number: number; country: string }[];
    const latestQualifying = () => {
      const heats = heatsNow().filter((h) => h.heat_type === 'Qualifying');
      if (heats.length === 0) return [];
      const round = Math.max(
        ...heats.map((h) => Number(h.heat_name.match(/(\d+)$/)![1])),
      );
      return heats.filter((h) => h.heat_name.endsWith(String(round)));
    };
    const finalHeats = () => heatsNow().filter((h) => h.heat_type === 'Final');

    /** Score a heat as the scoring page does (names: shared/boatKeys). */
    const scoreHeat = async (heatId: number, heatName: string) => {
      const rows = sailsIn(heatId);
      if (rows.length === 0) return;
      const count = new Map<number, number>();
      rows.forEach((r) =>
        count.set(r.sail_number, (count.get(r.sail_number) ?? 0) + 1),
      );
      // Name boats by a number: use an index, map back to the entry name.
      const names = rows.map((r) =>
        count.get(r.sail_number)! > 1
          ? `${r.country} ${r.sail_number}`
          : String(r.sail_number),
      );
      const ids = names.map((_, i) => i + 1);
      const outcome = randomOutcome(rand, heatName, ids);
      const payload = payloadFor(outcome, ids).map((p) => ({
        ...p,
        boatNumber: names[Number(p.boatNumber) - 1],
      }));
      await call('submitHeatRaceScoresAtomic', {
        heat_id: heatId,
        placeNumbers: payload,
      });
    };

    /** A leaderboard correction, built with the edit screen's own rules. */
    const correctRace = async () => {
      const race = pick(
        db
          .prepare(
            `SELECT r.race_id, h.heat_type FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
             WHERE h.event_id = ?`,
          )
          .all(eventId) as { race_id: number; heat_type: string }[],
      );
      if (!race) return;
      const rows = db
        .prepare(
          "SELECT boat_id, position, points, COALESCE(status,'FINISHED') AS status FROM Scores WHERE race_id = ? ORDER BY score_id",
        )
        .all(race.race_id) as any[];
      const maxBoats = await call('getMaxHeatSize', eventId, race.heat_type);
      const index = Math.floor(rand() * rows.length);
      const r = rand();
      const newStatus =
        r < 0.5
          ? 'FINISHED'
          : pick(['DNF', 'DSQ', 'OCS', 'BFD', 'ZFP', 'RDG3', 'DNS'])!;
      const newPosition =
        newStatus === 'RDG3'
          ? 1 + Math.floor(rand() * 9)
          : 1 + Math.floor(rand() * rows.length);
      const cells = applyRaceColumnEdit(
        rows.map((row) => ({
          position: row.position,
          points: row.points,
          status: row.status,
        })),
        {
          index,
          previousPosition: rows[index].position,
          previousStatus: rows[index].status,
          newPosition,
          newPoints: newPosition,
          newStatus,
          maxBoats,
        },
      );
      await call(
        'saveLeaderboardRaceResultsAtomic',
        eventId,
        [
          {
            raceId: String(race.race_id),
            cells: cells.map((cell, i) => ({
              boatId: rows[i].boat_id,
              position: cell.position,
              status: cell.status,
            })),
          },
        ],
        race.heat_type === 'Final',
      );
    };

    const ACTIONS: Array<[string, number, () => Promise<unknown>]> = [
      [
        'score a heat',
        6,
        async () => {
          const heats = finalHeats().length ? finalHeats() : latestQualifying();
          const unsailed = heats.filter(
            (h) =>
              h.heat_type === 'Final' ||
              db
                .prepare('SELECT COUNT(*) AS n FROM Races WHERE heat_id = ?')
                .get(h.heat_id).n === 0,
          );
          const heat = pick(unsailed);
          if (heat) await scoreHeat(heat.heat_id, heat.heat_name);
        },
      ],
      [
        'next round',
        2,
        () => call('createNewHeatsBasedOnLeaderboard', eventId),
      ],
      [
        'undo next round',
        1,
        () => call('undoLatestHeatRedistribution', eventId),
      ],
      [
        'undo last race of a heat',
        1,
        async () => {
          const heat = pick(heatsNow());
          if (heat) await call('undoLastScoredRaceForHeat', heat.heat_id);
        },
      ],
      [
        'undo the last race of every heat of the round',
        1,
        async () => {
          for (const heat of latestQualifying()) {
            // eslint-disable-next-line no-await-in-loop
            await call('undoLastScoredRaceForHeat', heat.heat_id);
          }
        },
      ],
      ['correct a result', 3, correctRace],
      [
        'undo from the history',
        2,
        async () => {
          const history = await call('readEventHistory', eventId);
          const action = pick(history as any[]);
          if (action?.action_id != null) {
            await call('revertHistoryAction', eventId, action.action_id);
          }
        },
      ],
      [
        'create the heats',
        1,
        async () => {
          if (heatsNow().length === 0) {
            await call('createInitialHeatsAtomic', eventId, heatCount);
          }
        },
      ],
      [
        'go back to a point in the history',
        1,
        async () => {
          const history = (await call('readEventHistory', eventId)) as any[];
          const ids = history
            .map((a) => a.action_id)
            .filter((id) => id != null);
          const target = pick(ids.slice(1));
          if (target != null) {
            await call('restoreEventToHistoryPoint', eventId, target);
          }
        },
      ],
      [
        'late entry',
        1,
        async () => {
          const id = await enterBoat();
          const heat = pick(
            latestQualifying().filter(
              (h) =>
                db
                  .prepare('SELECT COUNT(*) AS n FROM Races WHERE heat_id = ?')
                  .get(h.heat_id).n === 0,
            ),
          );
          if (heat) await call('insertHeatBoat', heat.heat_id, id);
        },
      ],
      [
        'move a boat to another heat',
        1,
        async () => {
          const heats = latestQualifying();
          const from = pick(heats);
          const to = pick(heats);
          if (!from || !to || from.heat_id === to.heat_id) return;
          const boat = pick(
            db
              .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
              .all(from.heat_id) as any[],
          );
          if (boat) {
            await call(
              'transferBoatBetweenHeats',
              from.heat_id,
              to.heat_id,
              boat.boat_id,
            );
          }
        },
      ],
      [
        'start the final series',
        1,
        () => call('startFinalSeriesAtomic', eventId, true, rand() < 0.5),
      ],
      [
        'read every screen',
        2,
        async () => {
          await call('readLeaderboard', eventId);
          await call('readFinalLeaderboard', eventId);
          await call('readOverallLeaderboard', eventId);
          const boat = db
            .prepare(
              'SELECT boat_id FROM Boat_Event WHERE event_id = ? LIMIT 2',
            )
            .all(eventId) as any[];
          if (boat.length === 2) {
            await call('explainBoatScore', eventId, boat[0].boat_id);
            await call(
              'explainTieBreak',
              eventId,
              boat[0].boat_id,
              boat[1].boat_id,
              false,
            );
            await call(
              'explainTieBreak',
              eventId,
              boat[0].boat_id,
              boat[1].boat_id,
              true,
            );
          }
          await call('getFinalSeriesEligibility', eventId);
        },
      ],
    ];
    const weighted = ACTIONS.flatMap((a) => Array(a[1]).fill(a));

    const steps = 60 + Math.floor(rand() * 60);
    for (let step = 0; step < steps; step += 1) {
      const [name, , run] = pick(weighted)!;
      if (process.env.CHAOS_TRACE) {
        // eslint-disable-next-line no-console
        console.info(`step ${step}: ${name}`);
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await run();
      } catch (error) {
        if (!isGuard(error)) {
          unexpected.push(
            `seed ${seed} step ${step} "${name}": ${(error as Error).stack}`,
          );
        } else if (isTechnicalText((error as Error).message)) {
          // A refusal the user would see must be worded for them.
          unexpected.push(
            `seed ${seed} step ${step} "${name}" (technical wording): ${(error as Error).message}`,
          );
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await checkInvariants(`seed ${seed} step ${step} after "${name}"`);
    }
    expect(unexpected.map((u) => u.split('\n')[0])).toEqual([]);
    db.close();

    async function checkInvariants(context: string) {
      expect({
        context,
        fk: db.prepare('PRAGMA foreign_key_check').all(),
      }).toEqual({
        context,
        fk: [],
      });
      // One score per boat per race.
      expect({
        context,
        doubles: db
          .prepare(
            'SELECT race_id, boat_id, COUNT(*) AS n FROM Scores GROUP BY race_id, boat_id HAVING n > 1',
          )
          .all(),
      }).toEqual({ context, doubles: [] });

      // The reads rebuild the standings; then every race is as the rules say.
      let rows: any[] = [];
      try {
        rows = await call('readLeaderboard', eventId);
        if (finalHeats().length) {
          await call('readFinalLeaderboard', eventId);
          await call('readOverallLeaderboard', eventId);
        }
      } catch (error) {
        unexpected.push(
          `${context}: reading the standings: ${(error as Error).stack}`,
        );
        return;
      }
      const races = db
        .prepare(
          `SELECT r.race_id, h.heat_type FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
           WHERE h.event_id = ?`,
        )
        .all(eventId) as { race_id: number; heat_type: string }[];
      for (const race of races) {
        const cells = db
          .prepare(
            "SELECT position, points, COALESCE(status,'FINISHED') AS status FROM Scores WHERE race_id = ? ORDER BY score_id",
          )
          .all(race.race_id) as any[];
        cells.forEach((cell) => {
          if (holdsPlace(cell.status)) {
            expect({
              context,
              race: race.race_id,
              inRace: cell.position >= 1 && cell.position <= cells.length,
            }).toEqual({
              context,
              race: race.race_id,
              inRace: true,
            });
          }
        });
        // eslint-disable-next-line no-await-in-loop
        const maxBoats = await call('getMaxHeatSize', eventId, race.heat_type);
        const plain = cells.filter((c) => !/^RDG[12]$/.test(c.status));
        const rescored = scoreRaceColumn(
          cells.map((c) => ({ ...c })),
          maxBoats,
        ).filter((c) => !/^RDG[12]$/.test(c.status));
        expect({
          context,
          race: race.race_id,
          points: plain.map((c) => tenth(c.points)),
        }).toEqual({
          context,
          race: race.race_id,
          points: rescored.map((c) => tenth(c.points)),
        });
      }
      // Every total equals its races minus the discards (no DNE/DGM here).
      rows.forEach((row) => {
        const points = String(row.race_points ?? '')
          .split(',')
          .filter(Boolean)
          .map(Number);
        const n = points.length;
        let drop = 0;
        if (n >= 4) drop = n < 8 ? 1 : 2 + Math.floor((n - 8) / 8);
        const worstFirst = [...points].sort((a, b) => b - a);
        const expected = tenth(
          worstFirst.slice(drop).reduce((sum, p) => sum + p, 0),
        );
        if (
          tenth(Number(row.total_points_event)) !== expected &&
          !process.env.CHAOS_QUIET
        ) {
          // eslint-disable-next-line no-console
          console.info(
            context,
            JSON.stringify({
              boat: row.boat_id,
              total: row.total_points_event,
              counts: rows.map(
                (r: any) => String(r.race_points).split(',').length,
              ),
              races: db
                .prepare(
                  `SELECT h.heat_name, r.race_id, sc.points, sc.status FROM Scores sc
                   JOIN Races r ON r.race_id = sc.race_id JOIN Heats h ON h.heat_id = r.heat_id
                   WHERE sc.boat_id = ? ORDER BY r.race_id`,
                )
                .all(row.boat_id),
              counted: db
                .prepare('SELECT race_id FROM CountedRaces WHERE event_id = ?')
                .all(eventId),
              four: rows
                .filter((r: any) => String(r.race_points).split(',').length > 3)
                .map((r: any) =>
                  db
                    .prepare(
                      `SELECT h.heat_name, r.race_id, sc.points, sc.status FROM Scores sc
                       JOIN Races r ON r.race_id = sc.race_id JOIN Heats h ON h.heat_id = r.heat_id
                       WHERE sc.boat_id = ? ORDER BY r.race_id`,
                    )
                    .all(r.boat_id),
                ),
            }),
          );
        }
        expect({
          context,
          boat: row.boat_id,
          races: row.race_points,
          statuses: row.race_statuses,
          total: tenth(Number(row.total_points_event)),
        }).toEqual({
          context,
          boat: row.boat_id,
          races: row.race_points,
          statuses: row.race_statuses,
          total: expected,
        });
      });
    }
  });
});
