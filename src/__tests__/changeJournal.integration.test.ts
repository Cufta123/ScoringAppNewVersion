/** @jest-environment node */
export {};

/**
 * The change journal end to end: the real schema migrations (with the journal
 * triggers), the real IPC handlers and the journal observer the app installs,
 * on a real SQLite engine. Every user action must appear in the event's
 * history once, with readable sentences, in the order it happened.
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
import { setCallObserver } from '../main/ipcHandlers/handle';
// eslint-disable-next-line import/first, import/order
import { journalObserver } from '../main/functions/changeJournal';
// eslint-disable-next-line import/first, import/order
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';
// eslint-disable-next-line import/first, import/order
import {
  HistoryAction,
  actionLabel,
  summarizeAction,
} from '../shared/history/describe';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

async function createEvent(name: string): Promise<number> {
  const result = await call(
    'insertEvent',
    name,
    'Split',
    '2026-05-01',
    '2026-05-03',
  );
  return Number(result.lastInsertRowid);
}

async function enterBoats(db: any, eventId: number, sails: number[]) {
  for (const sail of sails) {
    const boatId = Number(
      db
        .prepare(
          "INSERT INTO Boats (sail_number, country, model) VALUES (?, 'CRO', 'IOM')",
        )
        .run(sail).lastInsertRowid,
    );
    // eslint-disable-next-line no-await-in-loop
    await call('associateBoatWithEvent', boatId, eventId);
  }
}

const heatId = (db: any, eventId: number, name: string): number =>
  db
    .prepare('SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?')
    .get(eventId, name).heat_id;

const sailsIn = (db: any, id: number): number[] =>
  db
    .prepare(
      'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ? ORDER BY b.sail_number',
    )
    .all(id)
    .map((row: { sail_number: number }) => row.sail_number);

/** Score a heat; boats finish in sail-number order unless `reversed`. */
async function scoreHeat(
  db: any,
  eventId: number,
  name: string,
  reversed = false,
) {
  const id = heatId(db, eventId, name);
  const sails = sailsIn(db, id);
  if (reversed) sails.reverse();
  const result = await call('submitHeatRaceScoresAtomic', {
    heat_id: id,
    placeNumbers: sails.map((sail, index) => ({
      boatNumber: sail,
      place: index + 1,
      status: 'FINISHED',
    })),
  });
  expect(result.ok).toBe(true);
  return result.raceId as number;
}

const history = (eventId: number): Promise<HistoryAction[]> =>
  call('readEventHistory', eventId);

const labels = (actions: HistoryAction[]) =>
  actions.map((action) => actionLabel(action.channel));

const sentences = (action: HistoryAction) => summarizeAction(action).lines;

describe('change journal through the real handlers', () => {
  let db: any;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
    setCallObserver(journalObserver);
  });

  afterAll(() => {
    setCallObserver(null);
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    invalidateAssignmentSnapshotCache();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
  });

  afterEach(() => db.close());

  it('records each action once, newest first, in readable sentences', async () => {
    const eventId = await createEvent('Kup');
    await enterBoats(db, eventId, [1, 2, 3, 4]);
    await call('createInitialHeatsAtomic', eventId, 2);
    const raceId = await scoreHeat(db, eventId, 'Heat A1');
    const [firstSail] = sailsIn(db, heatId(db, eventId, 'Heat A1'));
    await call('updateRaceResult', eventId, raceId, firstSail, 1, false, 'DSQ');
    await call('undoLastScoredRaceForHeat', heatId(db, eventId, 'Heat A1'));

    const actions = await history(eventId);
    expect(labels(actions)).toEqual([
      'Last race of a heat undone',
      'Result changed',
      'Race scored',
      'Heats created',
      'Boat entered',
      'Boat entered',
      'Boat entered',
      'Boat entered',
      'Event created',
    ]);

    const [undo, protest, scored, heats] = actions;
    expect(sentences(scored)).toEqual(
      expect.arrayContaining([
        'Heat A1 race 1 added',
        `CRO ${firstSail}, Heat A1 race 1: 1 (1 point)`,
      ]),
    );
    expect(sentences(protest)).toContainEqual(
      expect.stringMatching(
        new RegExp(`^CRO ${firstSail}, Heat A1 race 1: 1 \\(1 point\\) → DSQ`),
      ),
    );
    expect(sentences(undo)).toContain('Heat A1 race 1 removed');
    expect(sentences(heats)).toEqual(
      expect.arrayContaining(['Heat A1 (Qualifying) created']),
    );
    expect(sentences(actions[actions.length - 1])).toEqual([
      'Event "Kup" created',
    ]);
    // Every row of this event went to exactly one action.
    const untagged = db
      .prepare('SELECT COUNT(*) AS n FROM ChangeLog WHERE action_id IS NULL')
      .get().n;
    expect(untagged).toBe(0);
  });

  it('keeps the derived standings out of the history', async () => {
    const eventId = await createEvent('Kup');
    await enterBoats(db, eventId, [1, 2, 3, 4]);
    await call('createInitialHeatsAtomic', eventId, 2);
    await scoreHeat(db, eventId, 'Heat A1');
    await scoreHeat(db, eventId, 'Heat B1');
    await call('updateEventLeaderboard', eventId);
    const tables = db
      .prepare('SELECT DISTINCT table_name FROM ChangeLog')
      .all()
      .map((row: { table_name: string }) => row.table_name);
    expect(tables).not.toContain('Leaderboard');
    expect(tables).not.toContain('FinalLeaderboard');
    expect(db.prepare('SELECT COUNT(*) AS n FROM Leaderboard').get().n).toBe(4);
  });

  it('a refused action leaves no trace', async () => {
    const eventId = await createEvent('Kup');
    await enterBoats(db, eventId, [1, 2]);
    const before = await history(eventId);
    await expect(
      call('submitHeatRaceScoresAtomic', {
        heat_id: 999,
        placeNumbers: [{ boatNumber: 1, place: 1, status: 'FINISHED' }],
      }),
    ).rejects.toThrow('Heat not found');
    expect(await history(eventId)).toEqual(before);
  });

  it('deleting an event deletes its history, and only its history', async () => {
    const kept = await createEvent('Kept');
    const gone = await createEvent('Gone');
    await enterBoats(db, kept, [1]);
    await enterBoats(db, gone, [2]);
    const keptHistory = await history(kept);

    await call('deleteEvent', gone);

    expect(await history(gone)).toEqual([]);
    expect(await history(kept)).toEqual(keptHistory);
    const actions = db
      .prepare('SELECT channel FROM ChangeActions ORDER BY action_id')
      .all()
      .map((row: { channel: string }) => row.channel);
    expect(actions).toEqual(['insertEvent', 'associateBoatWithEvent']);
  });

  it('records event settings changes field by field', async () => {
    const eventId = await createEvent('Kup');
    await call(
      'updateEvent',
      eventId,
      'Kup Jadrana',
      'Split',
      '2026-05-01',
      '2026-05-04',
      'progressive',
      'standard',
      'standard',
      'auto-increase',
    );
    const [update] = await history(eventId);
    expect(actionLabel(update.channel)).toBe('Event settings changed');
    expect(sentences(update)).toEqual([
      'Name: Kup → Kup Jadrana; End date: 2026-05-03 → 2026-05-04',
    ]);
  });
});

describe('undoing a change from the history (real handlers)', () => {
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

  beforeEach(() => {
    invalidateAssignmentSnapshotCache();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
  });

  afterEach(() => db.close());

  /** Everything an undo must put back: results, SHRS 3.1.5 rows, standings. */
  const state = () => ({
    scores: db
      .prepare(
        'SELECT score_id, race_id, boat_id, position, points, status, rdg_race_ids FROM Scores ORDER BY score_id',
      )
      .all()
      .map((row: any) => ({ ...row })),
    shields: db
      .prepare('SELECT * FROM RaceAssignmentSnapshots ORDER BY race_id, rank')
      .all()
      .map((row: any) => ({ ...row })),
    standings: db
      .prepare(
        'SELECT boat_id, total_points_event, place FROM Leaderboard ORDER BY boat_id',
      )
      .all()
      .map((row: any) => ({ ...row })),
  });

  const newest = async (eventId: number) => (await history(eventId))[0];

  /** Two heats of two, both scored; returns heat A1's race. */
  async function scoredEvent() {
    const eventId = await createEvent('Kup');
    await enterBoats(db, eventId, [1, 2, 3, 4]);
    await call('createInitialHeatsAtomic', eventId, 2);
    const raceA = await scoreHeat(db, eventId, 'Heat A1');
    await scoreHeat(db, eventId, 'Heat B1');
    const [winner] = sailsIn(db, heatId(db, eventId, 'Heat A1'));
    return { eventId, raceA, winner };
  }

  it('undoes a protest decision exactly, and the undo can be undone', async () => {
    const { eventId, raceA, winner } = await scoredEvent();
    const before = state();

    await call('updateRaceResult', eventId, raceA, winner, 1, false, 'DSQ');
    const decided = state();
    expect(decided.shields.length).toBeGreaterThan(0);
    const decision = await newest(eventId);

    await call('revertHistoryAction', eventId, decision.action_id);
    expect(state()).toEqual(before);

    const actions = await history(eventId);
    expect(summarizeAction(actions[0]).label).toBe('Undid “Result changed”');
    expect(summarizeAction(actions[0]).lines).toContainEqual(
      expect.stringMatching(/→ 1 \(1 point\)$/),
    );

    await call('revertHistoryAction', eventId, actions[0].action_id);
    expect(state()).toEqual(decided);
  });

  it('refuses to overwrite a later change to the same result', async () => {
    const { eventId, raceA, winner } = await scoredEvent();
    await call('updateRaceResult', eventId, raceA, winner, 1, false, 'DSQ');
    const first = await newest(eventId);
    await call('updateRaceResult', eventId, raceA, winner, 1, false, 'DNF');
    const second = await newest(eventId);
    const afterBoth = state();
    const historyBefore = await history(eventId);

    await expect(
      call('revertHistoryAction', eventId, first.action_id),
    ).rejects.toThrow(
      /was changed again later by “Result changed”\. Undo that change first\./,
    );
    // A refused undo changes nothing and leaves no trace.
    expect(state()).toEqual(afterBoth);
    expect(await history(eventId)).toEqual(historyBefore);

    await call('revertHistoryAction', eventId, second.action_id);
    await call('revertHistoryAction', eventId, first.action_id);
    expect(
      db
        .prepare('SELECT status FROM Scores WHERE race_id = ? AND boat_id = ?')
        .get(raceA, winner).status,
    ).toBe('FINISHED');
  });

  it('redress averages moving with later races do not block the undo', async () => {
    const eventId = await createEvent('Kup');
    await enterBoats(db, eventId, [1, 2, 3, 4]);
    await call('createInitialHeatsAtomic', eventId, 1);
    const race1 = await scoreHeat(db, eventId, 'Heat A1');
    await scoreHeat(db, eventId, 'Heat A1');
    const before = state();

    // Sail 4 gets average-points redress for race 1...
    await call('updateRaceResult', eventId, race1, 4, 4, false, 'RDG1');
    const redress = await newest(eventId);
    const rdgPoints = () =>
      db
        .prepare('SELECT points FROM Scores WHERE race_id = ? AND boat_id = 4')
        .get(race1).points;
    const pointsThen = rdgPoints();
    // ...and a later race moves that average.
    const race3 = await scoreHeat(db, eventId, 'Heat A1', true);
    expect(rdgPoints()).not.toBe(pointsThen);

    await call('revertHistoryAction', eventId, redress.action_id);
    const restored = state();
    const race1Rows = (s: any) =>
      s.scores.filter((r: any) => r.race_id === race1);
    expect(race1Rows(restored)).toEqual(race1Rows(before));
    expect(
      restored.scores.filter((r: any) => r.race_id === race3),
    ).toHaveLength(4);
  });

  it('scoring a whole race is undone on the scoring page, not here', async () => {
    const { eventId } = await scoredEvent();
    const scored = (await history(eventId)).find(
      (action) => action.channel === 'submitHeatRaceScoresAtomic',
    ) as HistoryAction;
    await expect(
      call('revertHistoryAction', eventId, scored.action_id),
    ).rejects.toThrow(/scoring page \(Undo last race\)/);
  });

  it('refuses an action of another event', async () => {
    const { eventId, raceA, winner } = await scoredEvent();
    await call('updateRaceResult', eventId, raceA, winner, 1, false, 'DSQ');
    const decision = await newest(eventId);
    const other = await createEvent('Other');
    await expect(
      call('revertHistoryAction', other, decision.action_id),
    ).rejects.toThrow('This change belongs to another event.');
  });
});
