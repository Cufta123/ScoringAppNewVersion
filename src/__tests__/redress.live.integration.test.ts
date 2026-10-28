/** @jest-environment node */
export {};

// Average-points redress stays live (RRS A9: "all the races in the series"),
// driven through the real IPC handlers against a real SQLite engine.

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
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../main/functions/eventSnapshot';

const EVENT_ID = 1;
const REDRESSED = 1;

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

describe('live average-points redress (single-fleet event)', () => {
  let db: any;
  let heatId: number;

  /** Score the next race with boats finishing in `order` (sail numbers). */
  const scoreRace = async (order: number[]) => {
    const result = await handlerRegistry.submitHeatRaceScoresAtomic(
      {},
      {
        heat_id: heatId,
        placeNumbers: order.map((sail, i) => ({
          boatNumber: sail,
          place: i + 1,
          status: 'FINISHED',
        })),
      },
    );
    expect(result.ok).toBe(true);
    return result.raceId as number;
  };

  const cell = (raceId: number) =>
    db
      .prepare(
        'SELECT points, status, rdg_race_ids FROM Scores WHERE race_id = ? AND boat_id = ?',
      )
      .get(raceId, REDRESSED);

  const grant = (raceId: number, status: string, rdgRaceIds?: number[]) =>
    handlerRegistry.saveLeaderboardRaceResultsAtomic({}, EVENT_ID, [
      {
        raceId,
        cells: [
          {
            boatId: REDRESSED,
            position: 1,
            status,
            ...(rdgRaceIds ? { rdgRaceIds } : {}),
          },
        ],
      },
    ]);

  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(async () => {
    db = seed();
    await handlerRegistry.createInitialHeatsAtomic({}, EVENT_ID, 1);
    heatId = db.prepare('SELECT heat_id FROM Heats').get().heat_id;
  });

  afterEach(() => db.close());

  it('re-averages an RDG1 as later races are sailed', async () => {
    const r1 = await scoreRace([2, 3, 4, 1]); // boat 1: 4th — redressed
    await scoreRace([1, 2, 3, 4]); // 1
    await scoreRace([2, 1, 3, 4]); // 2
    await grant(r1, 'RDG1');
    expect(cell(r1)).toMatchObject({ status: 'RDG1', points: 1.5 });

    await scoreRace([2, 3, 4, 1]); // 4 -> (1 + 2 + 4) / 3 = 2.3
    expect(cell(r1).points).toBe(2.3);
  });

  it('keeps an RDG2 on the chosen races and records them', async () => {
    const r1 = await scoreRace([1, 2, 3, 4]); // 1
    const r2 = await scoreRace([2, 3, 1, 4]); // 3
    const r3 = await scoreRace([2, 3, 4, 1]); // 4 — redressed
    await grant(r3, 'RDG2', [r1, r2]);
    expect(cell(r3)).toEqual({
      points: 2,
      status: 'RDG2',
      rdg_race_ids: JSON.stringify([r1, r2]),
    });

    // A later race is NOT one of the chosen races, so the average holds.
    await scoreRace([4, 3, 2, 1]);
    expect(cell(r3).points).toBe(2);
  });

  it('forgets the RDG2 selection when the score is changed to something else', async () => {
    const r1 = await scoreRace([1, 2, 3, 4]);
    const r2 = await scoreRace([2, 3, 4, 1]);
    await grant(r2, 'RDG2', [r1]);
    await grant(r2, 'RDG3');
    expect(cell(r2).rdg_race_ids).toBeNull();
  });

  it('carries the RDG2 selection through a snapshot backup and restore', async () => {
    const r1 = await scoreRace([1, 2, 3, 4]);
    const r2 = await scoreRace([2, 3, 4, 1]);
    await grant(r2, 'RDG2', [r1]);

    const snapshot = JSON.parse(JSON.stringify(buildEventSnapshot(EVENT_ID)));
    restoreEventSnapshot(EVENT_ID, snapshot);

    expect(cell(r2).rdg_race_ids).toBe(JSON.stringify([r1]));
  });
});
