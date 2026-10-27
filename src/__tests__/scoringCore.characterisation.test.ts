/** @jest-environment node */
export {};

/**
 * Characterisation of the whole scoring pipeline on 150 seeded random events,
 * run against a real SQLite engine:
 *
 *   Scores rows -> recompute (non-finisher renormalisation, redress, discards,
 *   SHRS 5.7 tie-break, shared places) -> Leaderboard / FinalLeaderboard
 *   -> the rows the leaderboard screen reads -> the renderer's discard marks
 *   and totals.
 *
 * The snapshot was recorded from the scoring code as it stood BEFORE the
 * scoring core was extracted into src/shared/scoring. It pins behaviour, not
 * correctness: a rule fix that changes results updates the snapshot on
 * purpose, in its own commit, with the reason. A refactor must leave it
 * untouched.
 *
 * The events are built to hit the awkward cases often: small point ranges
 * (lots of ties), boats missing whole rounds, tenth-point redress, DNE (never
 * discarded), DNF (renormalised to the largest heat + 1), custom and "never"
 * discard profiles, and final fleets that sail different numbers of races.
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

// eslint-disable-next-line import/first, import/order
import { EVENT_LIFECYCLE_SCHEMA } from './fixtures/eventLifecycleSchema';
// eslint-disable-next-line import/first, import/order
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../main/functions/leaderboardRecompute';
// eslint-disable-next-line import/first, import/order
import { processLeaderboardEntry } from '../renderer/utils/leaderboardUtils';

const EVENT_ID = 1;
const EVENTS = 150;

/** mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0; // eslint-disable-line no-bitwise
  return () => {
    /* eslint-disable no-bitwise */
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    /* eslint-enable no-bitwise */
  };
}

const DISCARD_PROFILES = [
  'standard',
  'standard',
  JSON.stringify({ thresholds: [2, 5] }),
  JSON.stringify({ firstDiscardAt: 3, secondDiscardAt: 6, additionalEvery: 3 }),
  JSON.stringify({ thresholds: [] }),
];
const FLEETS = ['Gold', 'Silver', 'Bronze'];

function buildEvent(seed: number) {
  const random = rng(seed);
  const int = (lo: number, hi: number) =>
    lo + Math.floor(random() * (hi - lo + 1));
  const pick = <T>(items: T[]): T => items[int(0, items.length - 1)];

  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);
  const qualifyingProfile = pick(DISCARD_PROFILES);
  const finalProfile = pick(DISCARD_PROFILES);
  db.prepare(
    `INSERT INTO Events (event_id, event_name, event_location, start_date, end_date,
       shrs_version, shrs_qualifying_assignment_mode, shrs_discard_profile_qualifying,
       shrs_discard_profile_final, shrs_discard_locked_qualifying,
       shrs_discard_locked_final, shrs_heat_overflow_policy)
     VALUES (?, 'E', 'X', '2026-05-01', '2026-05-03', '2026-1', 'progressive',
       ?, ?, 0, 0, 'auto-increase')`,
  ).run(EVENT_ID, qualifyingProfile, finalProfile);

  const boatCount = int(4, 14);
  const boats = Array.from({ length: boatCount }, (_, i) => i + 1);
  boats.forEach((id) => {
    db.exec(
      `INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (${id}, ${id}, 'CRO', 'IOM');
       INSERT INTO Boat_Event (boat_id, event_id) VALUES (${id}, ${EVENT_ID});`,
    );
  });

  const insertHeat = db.prepare(
    'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
  );
  const insertHeatBoat = db.prepare(
    'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
  );
  const insertRace = db.prepare(
    'INSERT INTO Races (heat_id, race_number) VALUES (?, ?)',
  );
  const insertScore = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, ?)`,
  );

  /** One sailed race: a random (often tied) score for every boat in it. */
  const scoreRace = (raceId: number, entrants: number[], spread: number) => {
    entrants.forEach((boat) => {
      const roll = random();
      if (roll < 0.06) {
        insertScore.run(raceId, boat, 0, entrants.length + 1, 'DNF');
      } else if (roll < 0.09) {
        insertScore.run(raceId, boat, 0, entrants.length + 1, 'DNE');
      } else if (roll < 0.13) {
        const tenths = int(10, 10 * spread) / 10;
        insertScore.run(raceId, boat, tenths, tenths, 'RDG3');
      } else {
        const place = int(1, spread);
        insertScore.run(raceId, boat, place, place, 'FINISHED');
      }
    });
  };

  const heatCount = int(1, 3);
  const rounds = int(1, 9);
  for (let round = 1; round <= rounds; round += 1) {
    const shuffled = [...boats].sort(() => random() - 0.5);
    for (let h = 0; h < heatCount; h += 1) {
      const heatId = Number(
        insertHeat.run(
          EVENT_ID,
          `Heat ${String.fromCharCode(65 + h)}${round}`,
          'Qualifying',
        ).lastInsertRowid,
      );
      // About one boat in fifteen misses the round entirely.
      const entrants = shuffled
        .filter((_, i) => i % heatCount === h)
        .filter(() => random() > 0.07);
      entrants.forEach((boat) => insertHeatBoat.run(heatId, boat));
      if (entrants.length > 0) {
        const raceId = Number(insertRace.run(heatId, 1).lastInsertRowid);
        scoreRace(raceId, entrants, int(2, Math.max(2, entrants.length)));
      }
    }
  }

  const hasFinal = random() < 0.6;
  if (hasFinal) {
    const fleetCount = Math.min(int(1, 3), boatCount);
    for (let f = 0; f < fleetCount; f += 1) {
      const fleetBoats = boats.filter((_, i) => i % fleetCount === f);
      const heatId = Number(
        insertHeat.run(EVENT_ID, `Final ${FLEETS[f]}`, 'Final').lastInsertRowid,
      );
      fleetBoats.forEach((boat) => insertHeatBoat.run(heatId, boat));
      const races = int(0, 7);
      for (let r = 1; r <= races; r += 1) {
        const raceId = Number(insertRace.run(heatId, r).lastInsertRowid);
        scoreRace(raceId, fleetBoats, int(2, Math.max(2, fleetBoats.length)));
      }
    }
  }

  return { db, hasFinal, qualifyingProfile, finalProfile };
}

/** One line per boat, compact enough to keep the snapshot reviewable. */
const line = (row: any, profile: string, seriesRaceCount: number) => {
  const entry = processLeaderboardEntry(row, profile, seriesRaceCount);
  return [
    row.placement_group ?? '',
    `boat ${row.boat_id}`,
    `place ${row.place ?? '-'}`,
    `total ${row.total_points_event ?? row.total_points_final}`,
    `ui ${entry.computed_total}`,
    entry.races.join(' '),
  ]
    .filter(Boolean)
    .join(' | ');
};

const raceCount = (row: any) =>
  row.race_positions ? String(row.race_positions).split(',').length : 0;

async function scoreEvent(seed: number): Promise<string[]> {
  const { db, hasFinal, qualifyingProfile, finalProfile } = buildEvent(seed);
  mockDbHolder.current = db;
  try {
    recomputeEventLeaderboard(EVENT_ID);
    const out = [`seed ${seed}: qualifying (${qualifyingProfile})`];
    const qualifying = await handlerRegistry.readLeaderboard({}, EVENT_ID);
    const seriesRaces = Math.max(0, ...qualifying.map(raceCount));
    qualifying.forEach((row: any) =>
      out.push(line(row, qualifyingProfile, seriesRaces)),
    );

    if (hasFinal) {
      recomputeFinalLeaderboard(EVENT_ID);
      const places = new Map<string, number>(
        db
          .prepare(
            'SELECT boat_id, place FROM FinalLeaderboard WHERE event_id = ?',
          )
          .all(EVENT_ID)
          .map((r: any) => [String(r.boat_id), r.place]),
      );
      const finals = await handlerRegistry.readFinalLeaderboard({}, EVENT_ID);
      const fleetRaces = new Map<string, number>();
      finals.forEach((row: any) =>
        fleetRaces.set(
          row.placement_group,
          Math.max(fleetRaces.get(row.placement_group) ?? 0, raceCount(row)),
        ),
      );
      out.push(`seed ${seed}: final (${finalProfile})`);
      finals.forEach((row: any) =>
        out.push(
          line(
            { ...row, place: places.get(String(row.boat_id)) },
            finalProfile,
            fleetRaces.get(row.placement_group) ?? 0,
          ),
        ),
      );
    }
    return out;
  } finally {
    db.close();
  }
}

describe('scoring pipeline characterisation (150 seeded random events)', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // The DNC backfill warns for every boat that missed a round.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  afterAll(() => jest.restoreAllMocks());

  // Split into groups so a difference points at a small range of seeds.
  const GROUP = 25;
  for (let start = 1; start <= EVENTS; start += GROUP) {
    const end = start + GROUP - 1;
    it(`events ${start}-${end} score exactly as recorded`, async () => {
      const lines: string[] = [];
      for (let seed = start; seed <= end; seed += 1) {
        // eslint-disable-next-line no-await-in-loop
        lines.push(...(await scoreEvent(seed)));
      }
      expect(lines.join('\n')).toMatchSnapshot();
    });
  }
});
