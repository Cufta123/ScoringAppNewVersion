/** @jest-environment node */
export {};

/**
 * The two explanations (explainBoatScore, explainTieBreak) against the
 * leaderboard the screen shows, on random events built through the real
 * handlers on real SQLite: entries (some late, in no heat), first heats,
 * scoring with codes, ties and penalties, leaderboard corrections, the next
 * rounds, the Final Series split and its races.
 *
 * After every step, for every boat: the explained qualifying, final and
 * overall totals equal readLeaderboard / readFinalLeaderboard /
 * readOverallLeaderboard; and for every two boats on equal totals (the same
 * fleet, in the Final Series) the tie-break names as winner the boat placed
 * higher, or no winner when they share the place, and its shared races are
 * races both boats have on the leaderboard.
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
import applyRaceColumnEdit from '../shared/raceColumnEdit';
import { payloadFor, prng, randomOutcome } from './fixtures/scoringOracle';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const SEEDS = Number(process.env.EXPLAIN_SEEDS || 30);

/** What the random events covered, so a quiet run is not an empty one. */
const COVERED: Record<string, number> = {};
const cover = (kind: string, n = 1) => {
  COVERED[kind] = (COVERED[kind] ?? 0) + n;
};

const ids = (csv: unknown) =>
  new Set(
    String(csv ?? '')
      .split(',')
      .filter((id) => id !== ''),
  );

/** The boat placed higher, or null when they share the place. */
const higher = (a: any, b: any, rank: (row: any) => number) => {
  if (rank(a) < rank(b)) return String(a.boat_id);
  if (rank(b) < rank(a)) return String(b.boat_id);
  return null;
};

async function checkEvent(eventId: number, context: string) {
  const qualifying = (await call('readLeaderboard', eventId)) as any[];
  const finals = (await call('readFinalLeaderboard', eventId)) as any[];
  const overall = (await call('readOverallLeaderboard', eventId)) as any[];
  const overallByBoat = new Map(overall.map((row) => [row.boat_id, row]));
  const finalByBoat = new Map(finals.map((row) => [row.boat_id, row]));

  // Every boat's explained totals are the leaderboard's.
  for (const row of qualifying) {
    // eslint-disable-next-line no-await-in-loop
    const explained = await call('explainBoatScore', eventId, row.boat_id);
    const final = finalByBoat.get(row.boat_id);
    expect({
      context,
      boat: row.boat_id,
      qualifying: explained.qualifying?.total,
      final: explained.final?.total ?? null,
      overall: explained.overall?.points ?? null,
    }).toEqual({
      context,
      boat: row.boat_id,
      qualifying: row.total_points_event,
      final: final ? final.total_points_final : null,
      overall: final ? overallByBoat.get(row.boat_id).overall_points : null,
    });
    const series = explained.final ?? explained.qualifying;
    cover('boat explained');
    cover('tie note', series.ties.length);
  }

  // Qualifying: every two boats on the same total.
  const qRank = (row: any) => row.place;
  for (let i = 0; i < qualifying.length; i += 1) {
    for (let j = i + 1; j < qualifying.length; j += 1) {
      const a = qualifying[i];
      const b = qualifying[j];
      if (a.total_points_event !== b.total_points_event) continue;
      // eslint-disable-next-line no-await-in-loop
      const res = await call(
        'explainTieBreak',
        eventId,
        a.boat_id,
        b.boat_id,
        false,
      );
      const expected = higher(a, b, qRank);
      expect({
        context,
        a: a.boat_id,
        b: b.boat_id,
        res: res.winnerBoatId,
      }).toEqual({ context, a: a.boat_id, b: b.boat_id, res: expected });
      expect([res.tied, res.totalA, res.totalB]).toEqual([
        true,
        a.total_points_event,
        a.total_points_event,
      ]);
      const raceIdsA = ids(a.race_ids);
      const raceIdsB = ids(b.race_ids);
      res.sharedRacePairs.forEach((pair: any) => {
        expect(raceIdsA.has(String(pair.raceId))).toBe(true);
        expect(raceIdsB.has(String(pair.raceId))).toBe(true);
      });
      expect(res.sharedQualRacePairs).toEqual([]);
      if (res.steps.some((s: any) => s.comparison?.raceId !== undefined)) {
        expect(res.raceGrid.some((cell: any) => cell.isBreaker)).toBe(true);
      }
      cover(expected === null ? 'qualifying tie shared' : 'qualifying tie');
      if (res.steps.some((s: any) => s.comparison)) cover('step comparison');
    }
  }

  // Final Series: two boats of one fleet on the same overall points, in the
  // order the screen shows (overall rank; qualifying place before a race).
  const fRank = (row: any) => {
    const o = overallByBoat.get(row.boat_id);
    return o.overall_rank ?? o.place;
  };
  for (let i = 0; i < finals.length; i += 1) {
    for (let j = i + 1; j < finals.length; j += 1) {
      const a = finals[i];
      const b = finals[j];
      const oa = overallByBoat.get(a.boat_id);
      const ob = overallByBoat.get(b.boat_id);
      if (
        !oa ||
        !ob ||
        a.placement_group !== b.placement_group ||
        oa.overall_points !== ob.overall_points
      ) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const res = await call(
        'explainTieBreak',
        eventId,
        a.boat_id,
        b.boat_id,
        true,
      );
      const expected = higher(a, b, fRank);
      expect({
        context,
        a: a.boat_id,
        b: b.boat_id,
        res: res.winnerBoatId,
      }).toEqual({ context, a: a.boat_id, b: b.boat_id, res: expected });
      expect([res.tied, res.totalA, res.totalB]).toEqual([
        true,
        oa.overall_points,
        oa.overall_points,
      ]);
      const qa = qualifying.find((row) => row.boat_id === a.boat_id);
      const qb = qualifying.find((row) => row.boat_id === b.boat_id);
      res.sharedQualRacePairs.forEach((pair: any) => {
        expect(ids(qa?.race_ids).has(String(pair.raceId))).toBe(true);
        expect(ids(qb?.race_ids).has(String(pair.raceId))).toBe(true);
      });
      res.sharedRacePairs.forEach((pair: any) => {
        expect(ids(a.race_ids).has(String(pair.raceId))).toBe(true);
        expect(ids(b.race_ids).has(String(pair.raceId))).toBe(true);
      });
      cover(expected === null ? 'final tie shared' : 'final tie');
    }
  }
}

async function runEvent(seed: number) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  const rand = prng(seed * 104729);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];

  const eventId = Number(
    (
      await call(
        'insertEvent',
        `Explain ${seed}`,
        'Split',
        '2026-05-01',
        '2026-05-03',
      )
    ).lastInsertRowid,
  );
  if (rand() < 0.4) {
    db.prepare(
      'UPDATE Events SET shrs_discard_profile_qualifying = ? WHERE event_id = ?',
    ).run(JSON.stringify({ thresholds: [2, 4] }), eventId);
  }
  let nextSail = 1;
  const enterBoat = async () => {
    const sail = nextSail;
    nextSail += 1;
    const id = Number(
      db
        .prepare(
          "INSERT INTO Boats (sail_number, country, model) VALUES (?, ?, 'IOM')",
        )
        .run(sail, pick(['CRO', 'ITA', 'GBR'])).lastInsertRowid,
    );
    await call('associateBoatWithEvent', id, eventId);
    return id;
  };
  const boats = 4 + Math.floor(rand() * 11);
  for (let i = 0; i < boats; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await enterBoat();
  }
  const heatCount = rand() < 0.25 ? 1 : 2 + Math.floor(rand() * 2);
  await call('createInitialHeatsAtomic', eventId, heatCount);

  const heats = () =>
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
    const all = heats().filter((h) => h.heat_type === 'Qualifying');
    const round = Math.max(
      ...all.map((h) => Number(h.heat_name.match(/(\d+)$/)![1])),
    );
    return all.filter((h) => h.heat_name.endsWith(String(round)));
  };
  const scoreHeat = async (heatId: number, heatName: string) => {
    const rows = db
      .prepare(
        `SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id
         WHERE hb.heat_id = ?`,
      )
      .all(heatId) as { sail_number: number }[];
    if (rows.length === 0) return;
    const sails = rows.map((r) => r.sail_number);
    const outcome = randomOutcome(rand, heatName, sails);
    await call('submitHeatRaceScoresAtomic', {
      heat_id: heatId,
      placeNumbers: payloadFor(outcome, sails).map((p) => ({
        ...p,
        boatNumber: String(p.boatNumber),
      })),
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
    const newStatus =
      rand() < 0.5 ? 'FINISHED' : pick(['DNF', 'DSQ', 'RDG3', 'DNS', 'OCS']);
    const newPosition =
      newStatus === 'RDG3'
        ? 1 + Math.floor(rand() * 6)
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
    cover('correction');
  };

  // Qualifying rounds.
  const rounds = 2 + Math.floor(rand() * 4);
  for (let round = 1; round <= rounds; round += 1) {
    if (round > 1) {
      // One heat sails as one fleet: its races go on in A1 (SHRS 1.1).
      if (heatCount > 1) {
        // eslint-disable-next-line no-await-in-loop
        await call('createNewHeatsBasedOnLeaderboard', eventId);
      }
      if (rand() < 0.15) {
        // Entered late, in no heat: DNC in every race she missed (RRS A5.1).
        // eslint-disable-next-line no-await-in-loop
        await enterBoat();
        cover('late entry');
      }
    }
    const raceCount = heatCount === 1 ? 1 + Math.floor(rand() * 2) : 1;
    for (let race = 0; race < raceCount; race += 1) {
      for (const heat of latestQualifying()) {
        // eslint-disable-next-line no-await-in-loop
        await scoreHeat(heat.heat_id, heat.heat_name);
      }
    }
    if (rand() < 0.4) {
      // eslint-disable-next-line no-await-in-loop
      await correctRace();
    }
    // eslint-disable-next-line no-await-in-loop
    await checkEvent(eventId, `seed ${seed} round ${round}`);
  }

  // The Final Series.
  if (heatCount === 1 || rand() < 0.25) {
    db.close();
    return;
  }
  await call('startFinalSeriesAtomic', eventId, true, rand() < 0.5);
  cover('final series');
  await checkEvent(eventId, `seed ${seed} final split`);
  const finalRaces = 1 + Math.floor(rand() * 4);
  for (let race = 1; race <= finalRaces; race += 1) {
    const fleets = heats().filter((h) => h.heat_type === 'Final');
    // Fleets may sail different numbers of races (SHRS 4.5).
    for (const fleet of fleets) {
      // eslint-disable-next-line no-await-in-loop
      if (rand() < 0.85) await scoreHeat(fleet.heat_id, fleet.heat_name);
    }
    if (rand() < 0.3) {
      // eslint-disable-next-line no-await-in-loop
      await correctRace();
    }
    // eslint-disable-next-line no-await-in-loop
    await checkEvent(eventId, `seed ${seed} final race ${race}`);
  }
  db.close();
}

describe('the explanations agree with the leaderboard', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
  });
  afterAll(() => jest.restoreAllMocks());

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))(
    'event %i',
    async (seed) => {
      // The checks are in checkEvent, after every step.
      await expect(runEvent(seed)).resolves.toBeUndefined();
    },
  );

  it('covered ties of every kind', () => {
    if (process.env.SHOW_COVERED)
      process.stdout.write(`${JSON.stringify(COVERED)}\n`);
    if (SEEDS < 30) return;
    expect(COVERED['boat explained']).toBeGreaterThan(1000);
    expect(COVERED['qualifying tie']).toBeGreaterThan(20);
    expect(COVERED['final tie']).toBeGreaterThan(5);
    expect(COVERED['step comparison']).toBeGreaterThan(10);
    expect(COVERED['final series']).toBeGreaterThan(5);
    expect(COVERED['late entry']).toBeGreaterThan(0);
  });
});
