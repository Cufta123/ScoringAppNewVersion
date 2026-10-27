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
import {
  buildRandomEvent as buildEvent,
  EVENT_ID,
} from './fixtures/randomEvents';
// eslint-disable-next-line import/first, import/order
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../main/functions/leaderboardRecompute';
// eslint-disable-next-line import/first, import/order
import { processLeaderboardEntry } from '../renderer/utils/leaderboardUtils';

const EVENTS = 150;

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
