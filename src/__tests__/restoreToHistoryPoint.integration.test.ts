/** @jest-environment node */
export {};

/**
 * "Go back to here" from the event history: the event must come back EXACTLY
 * as it was right after the chosen entry — entries, heats, races, every
 * result, the SHRS 3.1.5 rows and the standings — whatever happened since;
 * going back must itself be undoable; and when it cannot be done safely
 * nothing may change. Real migrations, real handlers, the real journal.
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
const mockDbHolder2 = mockDbHolder;
const mockDbHolderRef = mockDbHolder2;

/* eslint-disable import/first, import/order */
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';
import { setCallObserver } from '../main/ipcHandlers/handle';
import { journalObserver } from '../main/functions/changeJournal';
import applyRaceColumnEdit from '../shared/raceColumnEdit';
import { restorePreview, undoneActions } from '../shared/history/restore';
import { payloadFor, prng, randomOutcome } from './fixtures/scoringOracle';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

let db: any;

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

function freshDb() {
  invalidateAssignmentSnapshotCache();
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
}

async function newEvent(name: string, boats: number, nations = ['CRO']) {
  const eventId = Number(
    (await call('insertEvent', name, 'Split', '2026-05-01', '2026-05-03'))
      .lastInsertRowid,
  );
  for (let i = 0; i < boats; i += 1) {
    const id = Number(
      db
        .prepare(
          "INSERT INTO Boats (sail_number, country, model) VALUES (?, ?, 'IOM')",
        )
        .run(100 + i, nations[i % nations.length]).lastInsertRowid,
    );
    // eslint-disable-next-line no-await-in-loop
    await call('associateBoatWithEvent', id, eventId);
  }
  return eventId;
}

/**
 * Everything an event is, by natural keys (score ids may differ when an
 * automatic DNC is re-created, so scores are keyed by race and boat).
 */
async function stateOf(eventId: number) {
  const q = (sql: string) => db.prepare(sql).all(eventId);
  const standings = await call('readLeaderboard', eventId);
  const finals = await call('readFinalLeaderboard', eventId);
  const overall = await call('readOverallLeaderboard', eventId);
  return {
    event: q('SELECT * FROM Events WHERE event_id = ?'),
    entries: q(
      'SELECT boat_id FROM Boat_Event WHERE event_id = ? ORDER BY boat_id',
    ),
    heats: q('SELECT * FROM Heats WHERE event_id = ? ORDER BY heat_id'),
    heatBoats: q(
      `SELECT hb.heat_id, hb.boat_id FROM Heat_Boat hb JOIN Heats h ON h.heat_id = hb.heat_id
       WHERE h.event_id = ? ORDER BY hb.heat_id, hb.boat_id`,
    ),
    races: q(
      `SELECT r.* FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
       WHERE h.event_id = ? ORDER BY r.race_id`,
    ),
    scores: q(
      `SELECT s.race_id, s.boat_id, s.position, s.points, s.status, s.rdg_race_ids
       FROM Scores s JOIN Races r ON r.race_id = s.race_id JOIN Heats h ON h.heat_id = r.heat_id
       WHERE h.event_id = ? ORDER BY s.race_id, s.boat_id`,
    ),
    frozen: q(
      `SELECT ras.* FROM RaceAssignmentSnapshots ras JOIN Races r ON r.race_id = ras.race_id
       JOIN Heats h ON h.heat_id = r.heat_id WHERE h.event_id = ? ORDER BY ras.race_id, ras.rank`,
    ),
    standings: standings.map((row: any) => [
      row.boat_id,
      row.place,
      row.total_points_event,
      row.race_points,
      row.race_statuses,
    ]),
    finals: finals.map((row: any) => [
      row.boat_id,
      row.placement_group,
      row.total_points_final,
      row.race_points,
    ]),
    overall: overall.map((row: any) => [
      row.boat_id,
      row.overall_rank,
      row.overall_points,
    ]),
  };
}

const latestActionOf = (eventId: number): number | null =>
  db
    .prepare('SELECT MAX(action_id) AS id FROM ChangeLog WHERE event_id = ?')
    .get(eventId).id;

/** Random race-office steps (as the chaos test, without its checks). */
function sessionSteps(eventId: number, rand: () => number) {
  const pick = <T>(list: T[]): T | undefined =>
    list.length ? list[Math.floor(rand() * list.length)] : undefined;
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
  const latestQualifying = () => {
    const heats = heatsNow().filter((h) => h.heat_type === 'Qualifying');
    if (!heats.length) return [];
    const round = Math.max(
      ...heats.map((h) => Number(h.heat_name.match(/(\d+)$/)![1])),
    );
    return heats.filter((h) => h.heat_name.endsWith(String(round)));
  };
  const raced = (heatId: number) =>
    db.prepare('SELECT COUNT(*) AS n FROM Races WHERE heat_id = ?').get(heatId)
      .n > 0;
  const scoreHeat = async (heat: { heat_id: number; heat_name: string }) => {
    const sails = db
      .prepare(
        'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ?',
      )
      .all(heat.heat_id)
      .map((r: any) => Number(r.sail_number));
    if (!sails.length) return;
    const outcome = randomOutcome(rand, heat.heat_name, sails);
    await call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: payloadFor(outcome, sails),
    });
  };
  const correct = async () => {
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
    const status = pick(['FINISHED', 'FINISHED', 'DSQ', 'ZFP', 'RDG3', 'DNF'])!;
    const position =
      status === 'RDG3'
        ? 2 + Math.floor(rand() * 5)
        : 1 + Math.floor(rand() * rows.length);
    const cells = applyRaceColumnEdit(
      rows.map((r) => ({
        position: r.position,
        points: r.points,
        status: r.status,
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
    await call(
      'saveLeaderboardRaceResultsAtomic',
      eventId,
      [
        {
          raceId: String(race.race_id),
          cells: cells.map((c, i) => ({
            boatId: rows[i].boat_id,
            position: c.position,
            status: c.status,
          })),
        },
      ],
      false,
      race.heat_type === 'Final',
    );
  };
  const steps: Array<[number, () => Promise<unknown>]> = [
    [
      6,
      async () => {
        const finals = heatsNow().filter((h) => h.heat_type === 'Final');
        const heat = finals.length
          ? pick(finals)
          : pick(latestQualifying().filter((h) => !raced(h.heat_id)));
        if (heat) await scoreHeat(heat);
      },
    ],
    [2, () => call('createNewHeatsBasedOnLeaderboard', eventId)],
    [1, () => call('undoLatestHeatRedistribution', eventId)],
    [
      1,
      async () => {
        const heat = pick(heatsNow());
        if (heat) await call('undoLastScoredRaceForHeat', heat.heat_id);
      },
    ],
    [3, correct],
    [
      1,
      async () => {
        const history = await call('readEventHistory', eventId);
        const action = pick(history as any[]);
        if (action?.action_id != null) {
          await call('revertHistoryAction', eventId, action.action_id);
        }
      },
    ],
    [
      1,
      async () => {
        const id = Number(
          db
            .prepare(
              "INSERT INTO Boats (sail_number, country, model) VALUES (?, 'ITA', 'IOM')",
            )
            .run(500 + Math.floor(rand() * 400)).lastInsertRowid,
        );
        await call('associateBoatWithEvent', id, eventId);
        const heat = pick(latestQualifying().filter((h) => !raced(h.heat_id)));
        if (heat) await call('insertHeatBoat', heat.heat_id, id);
      },
    ],
    [1, () => call('startFinalSeriesAtomic', eventId, true, rand() < 0.5)],
    [
      1,
      () =>
        call(
          'updateEvent',
          eventId,
          `Renamed ${Math.floor(rand() * 100)}`,
          'Split',
          '2026-05-01',
          '2026-05-03',
          'progressive',
          'standard',
          'standard',
          'auto-increase',
        ),
    ],
  ];
  return steps.flatMap(([weight, run]) => Array(weight).fill(run)) as Array<
    () => Promise<unknown>
  >;
}

describe('going back to a point in the history', () => {
  const SEEDS = Array.from(
    { length: Number(process.env.RESTORE_SEEDS || 25) },
    (_, i) => i + 1,
  );

  it.each(SEEDS)(
    'random session %i: back to any point is exact',
    async (seed) => {
      freshDb();
      const rand = prng(seed * 92821);
      const eventId = await newEvent(
        `Restore ${seed}`,
        6 + Math.floor(rand() * 14),
      );
      // A second event, worked on in between: it must never change.
      const otherId = await newEvent(`Other ${seed}`, 4);
      await call('createInitialHeatsAtomic', otherId, 1);
      await call(
        'createInitialHeatsAtomic',
        eventId,
        2 + Math.floor(rand() * 2),
      );

      const steps = sessionSteps(eventId, rand);
      const otherSteps = sessionSteps(otherId, rand);
      const snapshots = new Map<number, unknown>();
      // Actions are numbered in time order. Each one gets the state taken
      // right after the step that made it (with the reads any screen makes).
      let lastSeen = 0;
      const record = async () => {
        const state = await stateOf(eventId);
        const latest = latestActionOf(eventId) ?? 0;
        // A step can make several actions (enter a boat, then put her in a
        // heat); only its last one, and the automatic ones the reads add after
        // it, are in this state.
        const fresh = db
          .prepare(
            `SELECT DISTINCT c.action_id, a.channel FROM ChangeLog c
           JOIN ChangeActions a ON a.action_id = c.action_id
           WHERE c.event_id = ? AND c.action_id > ? ORDER BY c.action_id`,
          )
          .all(eventId, lastSeen) as { action_id: number; channel: string }[];
        const automatic = (channel: string) => /^read/.test(channel);
        let lastUser = -1;
        fresh.forEach((r, i) => {
          if (!automatic(r.channel)) lastUser = i;
        });
        fresh.forEach((r, i) => {
          if (i >= lastUser) snapshots.set(r.action_id, state);
        });
        lastSeen = Math.max(lastSeen, latest);
        return latest;
      };
      // Setup made many actions at once; only its last one has a known state.
      await stateOf(eventId);
      lastSeen = latestActionOf(eventId) ?? 0;
      snapshots.set(lastSeen, await stateOf(eventId));
      lastSeen = latestActionOf(eventId) ?? 0;
      snapshots.set(lastSeen, await stateOf(eventId));

      const run = async (count: number) => {
        for (let i = 0; i < count; i += 1) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await steps[Math.floor(rand() * steps.length)]();
          } catch {
            // Guards refusing is fine here; the chaos test checks them.
          }
          if (rand() < 0.2) {
            try {
              // eslint-disable-next-line no-await-in-loop
              await otherSteps[Math.floor(rand() * otherSteps.length)]();
            } catch {
              // as above
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await record();
        }
      };

      await run(25 + Math.floor(rand() * 25));

      for (let round = 0; round < 3; round += 1) {
        const ids = [...snapshots.keys()].sort((a, b) => a - b);
        const latest = latestActionOf(eventId)!;
        const candidates = ids.filter((id) => id < latest);
        if (!candidates.length) break;
        const target = candidates[Math.floor(rand() * candidates.length)];
        const otherBefore = await stateOf(otherId);
        // eslint-disable-next-line no-await-in-loop
        await record(); // a read may add an automatic action; it belongs here
        const before = await stateOf(eventId);
        const latestNow = latestActionOf(eventId)!;

        // eslint-disable-next-line no-await-in-loop
        const result = await call(
          'restoreEventToHistoryPoint',
          eventId,
          target,
        );
        expect(result.success).toBe(true);
        // eslint-disable-next-line no-await-in-loop
        expect({ seed, round, target, state: await stateOf(eventId) }).toEqual({
          seed,
          round,
          target,
          state: snapshots.get(target),
        });
        // eslint-disable-next-line no-await-in-loop
        expect(await stateOf(otherId)).toEqual(otherBefore);
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

        // The step is in the history and can be undone: back to just before it.
        const history = await call('readEventHistory', eventId);
        const restoreEntry = history[0];
        expect(restoreEntry.channel).toBe('restoreEventToHistoryPoint');
        expect(restoreEntry.restores_to_action_id).toBe(target);
        if (rand() < 0.5) {
          // eslint-disable-next-line no-await-in-loop
          await call('restoreEventToHistoryPoint', eventId, latestNow);
          // eslint-disable-next-line no-await-in-loop
          expect({
            seed,
            round,
            undo: true,
            state: await stateOf(eventId),
          }).toEqual({
            seed,
            round,
            undo: true,
            state: before,
          });
        }
        // Every earlier point keeps its state: going back to it later, from
        // the new timeline, must still give exactly that.
        // eslint-disable-next-line no-await-in-loop
        await record();
        // eslint-disable-next-line no-await-in-loop
        await run(10 + Math.floor(rand() * 15));
      }
      db.close();
    },
  );
});

describe('going back refuses, and changes nothing, when it cannot be exact', () => {
  beforeEach(() => freshDb());
  afterEach(() => db.close());

  const scoreHeatOnce = async (eventId: number) => {
    const heat = db
      .prepare('SELECT heat_id, heat_name FROM Heats WHERE event_id = ?')
      .get(eventId);
    const sails = db
      .prepare(
        'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ?',
      )
      .all(heat.heat_id)
      .map((r: any) => Number(r.sail_number));
    return call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: sails.map((sail: number, i: number) => ({
        boatNumber: sail,
        place: i + 1,
        status: 'FINISHED',
      })),
    });
  };

  it('a row changed outside the history', async () => {
    const eventId = await newEvent('Tampered', 4);
    await call('createInitialHeatsAtomic', eventId, 1);
    const heatsAction = latestActionOf(eventId)!;
    await scoreHeatOnce(eventId);
    // Changed behind the journal's back (its trigger off for a moment).
    db.exec('DROP TRIGGER journal_Scores_update');
    db.prepare(
      'UPDATE Scores SET points = 9 WHERE score_id = (SELECT MIN(score_id) FROM Scores)',
    ).run();
    // eslint-disable-next-line global-require
    require('../../public/Database/journal').installJournalTriggers(db);
    const before = await stateOf(eventId);
    await expect(
      call('restoreEventToHistoryPoint', eventId, heatsAction),
    ).rejects.toThrow(
      /data no longer matches the history.*Nothing was changed/,
    );
    expect(await stateOf(eventId)).toEqual(before);
  });

  it('a boat of the event deleted from the app since', async () => {
    const eventId = await newEvent('Gone boat', 3);
    const entered = latestActionOf(eventId)!;
    const boat = db
      .prepare('SELECT boat_id FROM Boat_Event WHERE event_id = ? LIMIT 1')
      .get(eventId).boat_id;
    await call('removeBoatFromEvent', boat, eventId);
    db.prepare('DELETE FROM Boats WHERE boat_id = ?').run(boat);
    const before = await stateOf(eventId);
    await expect(
      call('restoreEventToHistoryPoint', eventId, entered),
    ).rejects.toThrow(/boat or sailor .* deleted.*Nothing was changed/);
    expect(await stateOf(eventId)).toEqual(before);
  });

  it('the newest entry, an entry of another event, an unknown entry', async () => {
    const a = await newEvent('A', 3);
    const b = await newEvent('B', 3);
    const newestA = latestActionOf(a)!;
    const newestB = latestActionOf(b)!;
    await expect(
      call('restoreEventToHistoryPoint', a, newestA),
    ).rejects.toThrow('Nothing was changed after this point.');
    await expect(
      call('restoreEventToHistoryPoint', a, newestB),
    ).rejects.toThrow('This point is no longer in the history of this event.');
    await expect(call('restoreEventToHistoryPoint', a, 99999)).rejects.toThrow(
      'This point is no longer in the history of this event.',
    );
  });

  it('back to before the final series: the fleets and their standings are gone', async () => {
    const eventId = await newEvent('Finals', 8);
    await call('createInitialHeatsAtomic', eventId, 2);
    for (const heat of db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ?')
      .all(eventId)) {
      const sails = db
        .prepare(
          'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ?',
        )
        .all(heat.heat_id)
        .map((r: any) => Number(r.sail_number));
      // eslint-disable-next-line no-await-in-loop
      await call('submitHeatRaceScoresAtomic', {
        heat_id: heat.heat_id,
        placeNumbers: sails.map((sail: number, i: number) => ({
          boatNumber: sail,
          place: i + 1,
          status: 'FINISHED',
        })),
      });
    }
    await call('readLeaderboard', eventId);
    const beforeFinals = latestActionOf(eventId)!;
    await call('startFinalSeriesAtomic', eventId, true, false);
    const gold = db
      .prepare("SELECT heat_id FROM Heats WHERE heat_name = 'Final Gold'")
      .get();
    const goldSails = db
      .prepare(
        'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ?',
      )
      .all(gold.heat_id)
      .map((r: any) => Number(r.sail_number));
    await call('submitHeatRaceScoresAtomic', {
      heat_id: gold.heat_id,
      placeNumbers: goldSails.map((sail: number, i: number) => ({
        boatNumber: sail,
        place: i + 1,
        status: 'FINISHED',
      })),
    });
    expect((await call('readFinalLeaderboard', eventId)).length).toBe(8);

    await call('restoreEventToHistoryPoint', eventId, beforeFinals);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM Heats WHERE heat_type = 'Final'")
        .get().n,
    ).toBe(0);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM FinalLeaderboard').get().n,
    ).toBe(0);
    expect(await call('readFinalLeaderboard', eventId)).toEqual([]);
    // Qualifying standings are as before the final series.
    expect((await call('readLeaderboard', eventId)).length).toBe(8);
  });
});

describe('what the history shows as undone, and what going back would change', () => {
  const a = (
    action_id: number,
    extra: { reverts_action_id?: number; restores_to_action_id?: number } = {},
  ) => ({
    action_id,
    reverts_action_id: null,
    restores_to_action_id: null,
    ...extra,
  });

  it('going back marks the later entries undone; going back again restores them', () => {
    const list = [a(1), a(2), a(3), a(4, { restores_to_action_id: 1 })];
    expect([...undoneActions(list)].sort()).toEqual([2, 3]);
    const back = [...list, a(5, { restores_to_action_id: 3 })];
    expect([...undoneActions(back)]).toEqual([]);
  });

  it('an undo inside, and an undo of an undo, are followed exactly', () => {
    const list = [
      a(1),
      a(2),
      a(3, { reverts_action_id: 2 }),
      a(4, { reverts_action_id: 3 }),
    ];
    expect([...undoneActions(list)]).toEqual([3]);
    // Going back to right after 3 (2 undone) brings back nothing, undoes 4
    // (the undo of the undo) and so takes 2 out again.
    const preview = restorePreview(list, 3);
    expect(preview.undo.map((x) => x.action_id)).toEqual([4, 2]);
    expect(preview.redo.map((x) => x.action_id)).toEqual([3]);
  });

  it('going back to an entry that had been undone brings it back', () => {
    const list = [a(1), a(2), a(3, { reverts_action_id: 2 })];
    const preview = restorePreview(list, 2);
    expect(preview.undo.map((x) => x.action_id)).toEqual([3]);
    expect(preview.redo.map((x) => x.action_id)).toEqual([2]);
  });

  it('the newest entry: nothing would change', () => {
    const list = [a(1), a(2)];
    expect(restorePreview(list, 2)).toEqual({ undo: [], redo: [] });
  });
});
