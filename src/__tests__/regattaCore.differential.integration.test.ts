/** @jest-environment node */
export {};

/**
 * regatta-core against the app. Each seed is a random event run twice: once
 * through the app's real handlers on a real SQLite database, once as a
 * decision log replayed by packages/regatta-core. After every step the two
 * must agree on every heat's boats and on the qualifying, final and overall
 * standings (totals and places).
 *
 * The steps: entries (some late), first heats, scoring (finishers, codes,
 * ties, ZFP/SCP), rounds by the Heat Movement Table or pre-assignment,
 * race-office corrections, protest decisions (DSQ, DPI, RDG1, RDG3), the
 * Final Series split and its races.
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
import applyRaceColumnEdit from '../shared/raceColumnEdit';
import { payloadFor, prng, randomOutcome } from './fixtures/scoringOracle';
// The library is not an installed package; import its source.
// eslint-disable-next-line import/no-relative-packages
import * as core from '../../packages/regatta-core/src';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const PROFILES: Array<[string, core.DiscardProfile]> = [
  ['standard', { kind: 'standard' }],
  [JSON.stringify({ thresholds: [2, 5] }), { kind: 'thresholds', at: [2, 5] }],
  [
    JSON.stringify({
      firstDiscardAt: 3,
      secondDiscardAt: 6,
      additionalEvery: 3,
    }),
    { kind: 'custom', first: 3, second: 6, every: 3 },
  ],
  [JSON.stringify({ thresholds: [] }), { kind: 'none' }],
];
const NATIONS = ['CRO', 'ITA', 'GBR', 'AUS'];

/** "Heat A2" -> "A2", "Final Gold" -> "Gold". */
const coreHeatId = (name: string) => name.replace(/^(Heat|Final)\s+/, '');

interface AppHeat {
  heat_id: number;
  heat_name: string;
  heat_type: string;
}

/** Standings where SHRS 5.7 went round in a circle (see `settled`). */
const CIRCLES = new Set<string>();
/** What the random events covered, so a quiet run is not an empty one. */
const COVERED: Record<string, number> = {};

async function runEvent(seed: number): Promise<string[]> {
  invalidateAssignmentSnapshotCache();
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  const rand = prng(seed * 7919);
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const log: core.Decision[] = [];
  const problems: string[] = [];

  const eventId = Number(
    (
      await call(
        'insertEvent',
        `Diff ${seed}`,
        'Split',
        '2026-05-01',
        '2026-05-03',
      )
    ).lastInsertRowid,
  );
  const [qApp, qCore] = pick(PROFILES);
  const [fApp, fCore] = pick(PROFILES);
  const mode = rand() < 0.25 ? 'pre-assigned' : 'progressive';
  db.prepare(
    `UPDATE Events SET shrs_discard_profile_qualifying = ?,
       shrs_discard_profile_final = ?, shrs_qualifying_assignment_mode = ?
     WHERE event_id = ?`,
  ).run(qApp, fApp, mode, eventId);
  log.push({
    type: 'settingsChanged',
    settings: {
      qualifyingMode: mode,
      discards: { qualifying: qCore, final: fCore },
    },
  });

  const used = new Set<string>();
  let nextSail = 1;
  const enterBoat = async () => {
    let nat = '';
    let sail = 0;
    do {
      nat = pick(NATIONS);
      if (rand() < 0.15) sail = 5;
      else {
        sail = nextSail;
        nextSail += 1;
      }
    } while (used.has(`${nat} ${sail}`));
    used.add(`${nat} ${sail}`);
    const id = Number(
      db
        .prepare(
          "INSERT INTO Boats (sail_number, country, model) VALUES (?, ?, 'IOM')",
        )
        .run(sail, nat).lastInsertRowid,
    );
    await call('associateBoatWithEvent', id, eventId);
    log.push({
      type: 'boatEntered',
      boat: { id: String(id), nat, sail: String(sail) },
    });
  };

  const heats = () =>
    db
      .prepare(
        'SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?',
      )
      .all(eventId) as AppHeat[];
  const boatsIn = (heatId: number) =>
    db
      .prepare(
        `SELECT b.boat_id, b.sail_number, b.country FROM Heat_Boat hb
         JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ? ORDER BY b.boat_id`,
      )
      .all(heatId) as {
      boat_id: number;
      sail_number: number;
      country: string;
    }[];
  const raceCount = (heatId: number) =>
    db.prepare('SELECT COUNT(*) AS n FROM Races WHERE heat_id = ?').get(heatId)
      .n as number;

  const state = () => {
    const result = core.replay(log);
    if (!result.ok)
      throw new Error(`core refused #${result.at}: ${result.reason}`);
    return result.state;
  };

  /** A random race as the scoring screen enters it, and as a core sheet. */
  const randomRace = (heatName: string, rows: ReturnType<typeof boatsIn>) => {
    const count = new Map<number, number>();
    rows.forEach((r) =>
      count.set(r.sail_number, (count.get(r.sail_number) ?? 0) + 1),
    );
    const names = rows.map((r) =>
      count.get(r.sail_number)! > 1
        ? `${r.country} ${r.sail_number}`
        : String(r.sail_number),
    );
    const ids = rows.map((_r, i) => i + 1);
    const outcome = randomOutcome(rand, heatName, ids);
    const payload = payloadFor(outcome, ids).map((p) => ({
      ...p,
      boatNumber: names[Number(p.boatNumber) - 1],
    }));
    const idOf = (i: number) => String(rows[i - 1].boat_id);
    const lines: core.RaceLine[] = outcome.crossed.map((i) => ({
      boat: idOf(i),
      ...(outcome.penalty.has(i)
        ? { penalty: outcome.penalty.get(i) as core.PenaltyCode }
        : {}),
      ...(outcome.tiedWithAbove.has(i) ? { tied: true } : {}),
    }));
    ids.forEach((i) => {
      if (!outcome.crossed.includes(i)) {
        lines.push({
          boat: idOf(i),
          code: outcome.penalty.get(i) as core.NoPlaceCode,
        });
      }
    });
    return { payload, lines };
  };

  const scoreHeat = async (heat: AppHeat) => {
    const rows = boatsIn(heat.heat_id);
    if (rows.length === 0) return;
    const { payload, lines } = randomRace(heat.heat_name, rows);
    await call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: payload,
    });
    log.push({ type: 'raceScored', heat: coreHeatId(heat.heat_name), lines });
  };

  const appRaces = () =>
    db
      .prepare(
        `SELECT r.race_id, r.race_number, h.heat_name, h.heat_type FROM Races r
         JOIN Heats h ON h.heat_id = r.heat_id WHERE h.event_id = ?`,
      )
      .all(eventId) as {
      race_id: number;
      race_number: number;
      heat_name: string;
      heat_type: string;
    }[];
  const protested = new Set<number>();

  /** The race office enters a race again from scratch. */
  const correctRace = async () => {
    const race = pick(appRaces().filter((r) => !protested.has(r.race_id)));
    if (!race) return;
    // The heat's boats: the race's scores also hold the DNCs the app files
    // there for boats that had no heat.
    const heat = heats().find((h) => h.heat_name === race.heat_name)!;
    const rows = boatsIn(heat.heat_id);
    // A race-office sheet: the app takes any DSQ/DNE/DGM it saves for a
    // protest decision (it does not record who decided), so a correction
    // here uses DNF instead; protest decisions are a step of their own.
    const lines = randomRace(race.heat_name, rows).lines.map((line) =>
      line.code === 'DSQ' ? { ...line, code: 'DNF' as const } : line,
    );
    // Places as the edit screen holds them: boats level share a place, the
    // next boat takes the place after all of them (RRS A7).
    let finishers = 0;
    let place = 0;
    const cells = lines.map((line) => {
      if (!line.code) {
        finishers += 1;
        if (!line.tied) place = finishers;
      }
      return {
        boatId: Number(line.boat),
        position: line.code ? rows.length : place,
        status: line.code ?? line.penalty ?? 'FINISHED',
        edited: true,
      };
    });
    await call(
      'saveLeaderboardRaceResultsAtomic',
      eventId,
      [{ raceId: String(race.race_id), cells }],
      race.heat_type === 'Final',
    );
    log.push({
      type: 'raceCorrected',
      race: { heat: coreHeatId(race.heat_name), race: race.race_number },
      lines,
    });
  };

  /** A protest committee decision about one finisher. */
  const decideProtest = async () => {
    const race = pick(appRaces());
    if (!race) return;
    const rows = db
      .prepare(
        `SELECT boat_id, position, points, COALESCE(status,'FINISHED') AS status
         FROM Scores WHERE race_id = ? ORDER BY score_id`,
      )
      .all(race.race_id) as any[];
    // Not on a boat sharing her place: the app then re-scores the boat she
    // shared it with, which RRS A6.2 forbids (a known app bug, see the
    // regatta-core notes); the core keeps that boat's score.
    const finishers = rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          row.status === 'FINISHED' &&
          rows.filter(
            (r) => r.status === 'FINISHED' && r.position === row.position,
          ).length === 1,
      );
    if (finishers.length === 0) return;
    const { row, index } = pick(finishers);
    const maxBoats = await call('getMaxHeatSize', eventId, race.heat_type);
    const kind = pick(['DSQ', 'DPI', 'RDG3', 'RDG1'] as const);
    const given = 1 + int(0, 8);
    const newPosition =
      kind === 'DSQ' ? row.position : kind === 'RDG1' ? maxBoats + 1 : given;
    const cells = applyRaceColumnEdit(
      rows.map((r) => ({
        position: r.position,
        points: r.points,
        status: r.status,
      })),
      {
        index,
        previousPosition: row.position,
        previousStatus: row.status,
        newPosition,
        newPoints: newPosition,
        newStatus: kind,
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
            edited: i === index,
          })),
        },
      ],
      race.heat_type === 'Final',
    );
    protested.add(race.race_id);
    const outcome: core.ProtestOutcome =
      kind === 'DPI' || kind === 'RDG3' ? { kind, points: given } : { kind };
    log.push({
      type: 'protestDecided',
      race: { heat: coreHeatId(race.heat_name), race: race.race_number },
      boat: String(row.boat_id),
      outcome,
    });
  };

  /** Both sides must accept a step, or both refuse it. */
  const both = async (
    label: string,
    app: () => Promise<unknown>,
    decision: core.Decision,
  ) => {
    let appError: string | null = null;
    try {
      await app();
    } catch (error) {
      appError = (error as Error).message;
    }
    const coreResult = core.replay([...log, decision]);
    const coreError = coreResult.ok ? null : coreResult.reason;
    if ((appError === null) !== (coreError === null)) {
      problems.push(
        `${label}: app ${appError ?? 'accepted'}, core ${coreError ?? 'accepted'}`,
      );
    }
    if (appError === null && coreError === null) log.push(decision);
    return appError === null && coreError === null;
  };

  const compare = async (step: string) => {
    const s = state();
    const where = `seed ${seed}, after ${step}`;
    heats().forEach((heat) => {
      const appBoats = boatsIn(heat.heat_id)
        .map((b) => String(b.boat_id))
        .sort();
      const found = s.rounds
        .flat()
        .concat(s.fleets ?? [])
        .find((h) => h.id === coreHeatId(heat.heat_name));
      const coreBoats = [...(found?.boats ?? [])].sort();
      if (appBoats.join() !== coreBoats.join()) {
        problems.push(
          `${where}: ${heat.heat_name} app [${appBoats}] core [${coreBoats}]`,
        );
      }
    });

    const diff = (
      name: string,
      a: Map<string, string>,
      b: Map<string, string>,
    ) => {
      const boats = new Set([...a.keys(), ...b.keys()]);
      const wrong = [...boats].filter((boat) => a.get(boat) !== b.get(boat));
      if (wrong.length > 0) {
        problems.push(
          `${where}: ${name} ${wrong
            .map((boat) => `${boat} app ${a.get(boat)} core ${b.get(boat)}`)
            .join('; ')}`,
        );
      }
    };

    /**
     * Places compared exactly. Where SHRS 5.7 goes round in a circle (A
     * ahead of B ahead of C ahead of A) both settle it the same way: the
     * boat no tied boat beats first, a true circle by plain RRS A8. Circles
     * are counted; outside one, an order that puts a boat above one that
     * beats her head-to-head is an error.
     */
    type Row = { boat: string; total: number; place: number; group: string };
    const settled = (
      name: string,
      appRows: Row[],
      coreRows: Array<Row & { circular?: boolean }>,
      tie: (a: string, b: string) => number,
    ) => {
      const groups = new Map<string, Row[]>();
      appRows.forEach((row) =>
        groups.set(row.group, [...(groups.get(row.group) ?? []), row]),
      );
      // In a true circle every order puts someone above a boat that beats
      // her; elsewhere no order may.
      const circular = new Set(
        coreRows.filter((r) => r.circular).map((r) => r.group),
      );
      groups.forEach((group, key) => {
        if (circular.has(key)) return;
        group.forEach((x) =>
          group.forEach((y) => {
            if (x.place < y.place && tie(y.boat, x.boat) < 0) {
              problems.push(
                `${where}: ${name} app puts ${x.boat} above ${y.boat}, who beats her under 5.7`,
              );
            }
          }),
        );
      });
      if (coreRows.some((row) => row.circular)) CIRCLES.add(`${seed}:${name}`);
      const view = (rows: Row[]) =>
        new Map(rows.map((row) => [row.boat, `${row.total}@${row.place}`]));
      diff(name, view(appRows), view(coreRows));
    };

    await call('readLeaderboard', eventId);
    const qTie = core.qualifyingTieBreak(s);
    settled(
      'qualifying',
      (
        db
          .prepare(
            'SELECT boat_id, total_points_event, place FROM Leaderboard WHERE event_id = ?',
          )
          .all(eventId) as any[]
      ).map((r) => ({
        boat: String(r.boat_id),
        total: r.total_points_event,
        place: r.place,
        group: String(r.total_points_event),
      })),
      core
        .qualifyingStandings(s)
        .standings.map((r) => ({ ...r, group: String(r.total) })),
      qTie,
    );

    if (s.fleets) {
      await call('readFinalLeaderboard', eventId);
      const fleets = core.finalStandings(s);
      const raced = new Set(
        fleets.filter((f) => f.races > 0).map((f) => f.fleet),
      );
      const appF = new Map(
        (
          db
            .prepare(
              'SELECT boat_id, total_points_final, placement_group, place FROM FinalLeaderboard WHERE event_id = ?',
            )
            .all(eventId) as any[]
        ).map((r) => [
          String(r.boat_id),
          `${r.placement_group} ${r.total_points_final}${raced.has(r.placement_group) ? `@${r.place}` : ''}`,
        ]),
      );
      const coreF = new Map(
        fleets.flatMap((f) =>
          f.standings.map((r) => [
            r.boat,
            `${f.fleet} ${r.total}${f.races > 0 ? `@${r.place}` : ''}`,
          ]),
        ),
      );
      diff('final', appF, coreF);
    }

    const finalRaced = (s.fleets ?? []).some((f) => f.races.length > 0);
    settled(
      'overall',
      ((await call('readOverallLeaderboard', eventId)) as any[]).map((r) => ({
        boat: String(r.boat_id),
        total: r.overall_points,
        place: r.overall_rank ?? r.place,
        group: finalRaced
          ? `${r.placement_group} ${r.overall_points}`
          : String(r.overall_points),
      })),
      core.overallStandings(s).map((r) => ({
        ...r,
        group: finalRaced ? `${r.fleet} ${r.total}` : String(r.total),
      })),
      finalRaced ? core.overallTieBreak(s) : qTie,
    );
  };

  try {
    for (let i = int(4, 26); i > 0; i -= 1) {
      // eslint-disable-next-line no-await-in-loop
      await enterBoat();
    }
    const boatCount = log.filter((d) => d.type === 'boatEntered').length;
    const heatCount = Math.max(
      Math.ceil(boatCount / 20),
      Math.min(boatCount, int(1, 3)),
    );
    await call('createInitialHeatsAtomic', eventId, heatCount);
    log.push({ type: 'heatsCreated', heatCount });
    await compare('the first heats');

    const steps = int(10, 30);
    for (let step = 0; step < steps && problems.length === 0; step += 1) {
      const s = state();
      const next = core.nextStep(s);
      const r = rand();
      let label = '';
      if (r < 0.08 && !s.fleets) {
        label = 'a late entry';
        // eslint-disable-next-line no-await-in-loop
        await enterBoat();
      } else if (r < 0.16) {
        label = 'a correction';
        // eslint-disable-next-line no-await-in-loop
        await correctRace();
      } else if (r < 0.24) {
        label = 'a protest decision';
        // eslint-disable-next-line no-await-in-loop
        await decideProtest();
      } else if (next.kind === 'createRound') {
        if (s.rounds.length >= 2 && rand() < 0.4) {
          label = 'the final split';
          // eslint-disable-next-line no-await-in-loop
          await both(
            label,
            () => call('startFinalSeriesAtomic', eventId, false, true),
            {
              type: 'finalSeriesStarted',
            },
          );
        } else {
          label = `round ${next.round}`;
          // eslint-disable-next-line no-await-in-loop
          await both(
            label,
            () => call('createNewHeatsBasedOnLeaderboard', eventId),
            {
              type: 'roundCreated',
            },
          );
        }
      } else if (next.kind === 'score') {
        const heat = heats().find(
          (h) => coreHeatId(h.heat_name) === next.heat,
        )!;
        label = `scoring ${heat.heat_name} race ${raceCount(heat.heat_id) + 1}`;
        // eslint-disable-next-line no-await-in-loop
        await scoreHeat(heat);
      }
      if (label) {
        const kind = label
          .replace(/ (\d+|Heat.*|Final.*)$/, '')
          .replace(/^scoring.*/, 'scoring');
        COVERED[kind] = (COVERED[kind] ?? 0) + 1;
        // eslint-disable-next-line no-await-in-loop
        await compare(label);
      }
    }
  } catch (error) {
    problems.push(`seed ${seed}: ${(error as Error).stack}`);
  } finally {
    if (problems.length > 0 && process.env.DIFF_DUMP) {
      // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
      require('fs').writeFileSync(
        `${process.env.DIFF_DUMP}/seed-${seed}.json`,
        JSON.stringify(
          {
            problems,
            log,
            appSeries: (
              db
                .prepare('SELECT boat_id FROM Boat_Event WHERE event_id = ?')
                .all(eventId) as any[]
            ).map((r) => ({
              boat: r.boat_id,
              // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
              scores:
                require('../main/functions/calculateBoatScores').getScoresForA81(
                  eventId,
                  r.boat_id,
                ),
            })),
            scores: db
              .prepare(
                `SELECT h.heat_name, r.race_number, s.boat_id, s.position, s.points, s.status
                 FROM Scores s JOIN Races r ON r.race_id = s.race_id
                 JOIN Heats h ON h.heat_id = r.heat_id ORDER BY r.race_id, s.position`,
              )
              .all(),
          },
          null,
          1,
        ),
      );
    }
    db.close();
  }
  return problems;
}

describe('regatta-core agrees with the app', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
  });
  afterAll(() => {
    jest.restoreAllMocks();
    process.stdout.write(
      `regatta-core vs app: 5.7 circles in ${CIRCLES.size} standings\n` +
        `steps compared: ${JSON.stringify(COVERED)}\n`,
    );
  });

  const SEEDS = Array.from(
    { length: Number(process.env.DIFF_SEEDS || 60) },
    (_v, i) => i + 1,
  );

  it.each(SEEDS)('event %i', async (seed) => {
    expect(await runEvent(seed)).toEqual([]);
  });
});
