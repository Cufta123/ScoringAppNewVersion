/** @jest-environment node */
/**
 * A screen can be out of date: the heat it shows was rebuilt, the race undone,
 * the boat removed, the event deleted (another window, the history dialog).
 * Every action the window can send must then either work or say plainly why
 * not — never a technical message, never "unexpected problem".
 *
 * Runs every channel against the real handlers and a real database, with ids
 * that no longer exist and with values a stale or mistyped screen can send.
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
  dialog: {
    showSaveDialog: jest.fn(async () => ({ canceled: true })),
    showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] })),
  },
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
import { setCallObserver } from '../main/ipcHandlers/handle';
import { journalObserver } from '../main/functions/changeJournal';
import { isTechnicalText } from '../shared/errors/explainError';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const GONE = 987654;

describe('a stale or mistyped screen always gets a plain answer', () => {
  let db: any;
  let eventId: number;
  let heatId: number;
  let raceId: number;
  let boatId: number;
  let scoreId: number;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/SailorHandler');
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
    setCallObserver(journalObserver);
  });
  afterAll(() => {
    setCallObserver(null);
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    invalidateAssignmentSnapshotCache();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
    eventId = Number(
      (await call('insertEvent', 'Stale', 'Split', '2026-05-01', '2026-05-03'))
        .lastInsertRowid,
    );
    const boatIds: number[] = [];
    for (let sail = 1; sail <= 4; sail += 1) {
      const id = Number(
        db
          .prepare(
            "INSERT INTO Boats (sail_number, country, model) VALUES (?, 'CRO', 'IOM')",
          )
          .run(sail).lastInsertRowid,
      );
      boatIds.push(id);
      // eslint-disable-next-line no-await-in-loop
      await call('associateBoatWithEvent', id, eventId);
    }
    [boatId] = boatIds;
    await call('createInitialHeatsAtomic', eventId, 1);
    heatId = db.prepare('SELECT heat_id FROM Heats').get().heat_id;
    ({ raceId } = await call('submitHeatRaceScoresAtomic', {
      heat_id: heatId,
      placeNumbers: [1, 2, 3, 4].map((sail) => ({
        boatNumber: sail,
        place: sail,
        status: 'FINISHED',
      })),
    }));
    scoreId = db
      .prepare('SELECT score_id FROM Scores WHERE race_id = ? LIMIT 1')
      .get(raceId).score_id;
  });
  afterEach(() => db.close());

  /** Each case: a channel and the arguments a stale or bad screen sends. */
  const cases: Array<[string, () => any[]]> = [
    ['readEventHistory', () => [GONE]],
    ['revertHistoryAction', () => [eventId, GONE]],
    ['restoreEventToHistoryPoint', () => [eventId, GONE]],
    ['restoreEventToHistoryPoint', () => [GONE, 1]],
    ['associateBoatWithEvent', () => [GONE, eventId]],
    ['associateBoatWithEvent', () => [boatId, GONE]],
    ['removeBoatFromEvent', () => [boatId, eventId]],
    ['removeBoatFromEvent', () => [GONE, GONE]],
    [
      'updateEvent',
      () => [
        GONE,
        'X',
        'Y',
        '2026-01-01',
        '2026-01-02',
        'standard',
        'standard',
      ],
    ],
    ['deleteEvent', () => [GONE]],
    ['insertBoat', () => ['', 'CRO', 'IOM', GONE]],
    ['insertBoat', () => [12, 'CRO', 'IOM', GONE]],
    ['insertSailor', () => ['', 'Doe', '', 1, GONE]],
    [
      'updateSailor',
      () => [
        {
          name: 'A',
          surname: 'B',
          birthday: '',
          category_name: 'SENIOR',
          club_name: 'YC',
          boat_id: GONE,
          sail_number: 5,
          country: 'CRO',
          model: 'IOM',
          sailor_id: GONE,
        },
      ],
    ],
    ['importSailors', () => [[{ name: 'A' }]]],
    ['insertHeatBoat', () => [GONE, boatId]],
    ['insertHeatBoat', () => [heatId, GONE]],
    ['createInitialHeatsAtomic', () => [eventId, 2]],
    ['createInitialHeatsAtomic', () => [GONE, 2]],
    ['recreateInitialHeatsAtomic', () => [eventId, 2]],
    ['recreateInitialHeatsAtomic', () => [GONE, 0]],
    ['deleteHeatsByEvent', () => [eventId]],
    ['insertRace', () => [GONE, 1]],
    ['insertScore', () => [GONE, boatId, 1, 1, 'FINISHED']],
    ['insertScore', () => [raceId, boatId, 0, 0, 'FINISHED']],
    ['insertScore', () => [raceId, boatId, 1, 1, 'XYZ']],
    ['updateScore', () => [GONE, 1, 1, 'FINISHED']],
    ['updateScore', () => [scoreId, 'abc', 'abc', 'FINISHED']],
    ['deleteScore', () => [GONE]],
    ['updateEventLeaderboard', () => [GONE]],
    ['updateFinalLeaderboard', () => [GONE]],
    ['createNewHeatsBasedOnLeaderboard', () => [GONE]],
    ['undoLastScoredRaceForHeat', () => [GONE]],
    ['undoLastScoredRace', () => [GONE]],
    ['undoLatestHeatRedistribution', () => [eventId]],
    ['undoLatestHeatRedistribution', () => [GONE]],
    ['transferBoatBetweenHeats', () => [GONE, heatId, boatId]],
    ['transferBoatBetweenHeats', () => [heatId, GONE, boatId]],
    ['readLeaderboard', () => [GONE]],
    ['updateRaceResult', () => [eventId, GONE, boatId, 1, false, 'FINISHED']],
    ['updateRaceResult', () => [eventId, raceId, GONE, 1, false, 'FINISHED']],
    [
      'updateRaceResult',
      () => [eventId, raceId, boatId, 99, false, 'FINISHED'],
    ],
    ['updateRaceResult', () => [eventId, raceId, boatId, 1, false, 'FOO']],
    [
      'saveLeaderboardRaceResultsAtomic',
      () => [
        eventId,
        [
          {
            raceId: GONE,
            cells: [{ boatId, position: 1, status: 'FINISHED' }],
          },
        ],
        false,
        false,
      ],
    ],
    [
      'saveLeaderboardRaceResultsAtomic',
      () => [
        eventId,
        [
          {
            raceId,
            cells: [{ boatId: GONE, position: 1, status: 'FINISHED' }],
          },
        ],
        false,
        false,
      ],
    ],
    [
      'saveLeaderboardRaceResultsAtomic',
      () => [
        eventId,
        [{ raceId, cells: [{ boatId, position: 9, status: 'FINISHED' }] }],
        false,
        false,
      ],
    ],
    ['submitHeatRaceScoresAtomic', () => [{ heat_id: GONE, placeNumbers: [] }]],
    [
      'submitHeatRaceScoresAtomic',
      () => [
        {
          heat_id: heatId,
          placeNumbers: [
            { boatNumber: 1, place: 1, status: 'FINISHED' },
            { boatNumber: 1, place: 2, status: 'FINISHED' },
          ],
        },
      ],
    ],
    [
      'submitHeatRaceScoresAtomic',
      () => [
        {
          heat_id: heatId,
          placeNumbers: [{ boatNumber: 1, place: 0, status: 'FINISHED' }],
        },
      ],
    ],
    ['readFinalLeaderboard', () => [GONE]],
    ['readOverallLeaderboard', () => [GONE]],
    ['startFinalSeriesAtomic', () => [eventId]],
    ['startFinalSeriesAtomic', () => [GONE]],
    ['getMaxHeatSize', () => [GONE, 'Final']],
    ['explainTieBreak', () => [eventId, boatId, GONE, false]],
    ['explainTieBreak', () => [GONE, GONE, GONE, true]],
    ['explainBoatScore', () => [eventId, GONE]],
    ['explainBoatScore', () => [GONE, boatId]],
    ['getFinalSeriesEligibility', () => [GONE]],
    ['exportEventSnapshotToFile', () => [GONE]],
  ];

  it('a boat dragged twice from an old screen is not put in two heats', async () => {
    const other = Number(
      (
        await call(
          'insertEvent',
          'Two heats',
          'Split',
          '2026-05-01',
          '2026-05-03',
        )
      ).lastInsertRowid,
    );
    for (let sail = 11; sail <= 14; sail += 1) {
      const id = Number(
        db
          .prepare(
            "INSERT INTO Boats (sail_number, country, model) VALUES (?, 'ITA', 'IOM')",
          )
          .run(sail).lastInsertRowid,
      );
      // eslint-disable-next-line no-await-in-loop
      await call('associateBoatWithEvent', id, other);
    }
    await call('createInitialHeatsAtomic', other, 2);
    const [a, b] = db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ? ORDER BY heat_id')
      .all(other)
      .map((row: any) => row.heat_id);
    const moved = db
      .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ? LIMIT 1')
      .get(a).boat_id;
    await call('transferBoatBetweenHeats', a, b, moved);
    // The old screen still shows her in A and moves her to B again.
    await expect(call('transferBoatBetweenHeats', a, b, moved)).rejects.toThrow(
      /no longer in the heat it was dragged from/,
    );
    expect(
      db
        .prepare('SELECT heat_id FROM Heat_Boat WHERE boat_id = ?')
        .all(moved)
        .map((row: any) => row.heat_id),
    ).toEqual([b]);
  });

  it.each(cases)('%s refuses in plain words', async (channel, args) => {
    expect(handlerRegistry[channel]).toBeDefined();
    let message: string | null = null;
    try {
      await call(channel, ...args());
    } catch (error) {
      message = (error as Error).message;
    }
    if (process.env.SHOW_MESSAGES) {
      process.stdout.write(`${channel}: ${message ?? '(no error)'}\n`);
    }
    if (message == null) return; // it worked, or quietly did nothing
    expect({ channel, message, technical: isTechnicalText(message) }).toEqual({
      channel,
      message,
      technical: false,
    });
    expect(message).not.toMatch(/unexpected problem/);
  });
});
