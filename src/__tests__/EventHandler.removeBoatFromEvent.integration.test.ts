/** @jest-environment node */
export {};

// Removing a boat from an event's entry list has to remove her from the heats
// that entry list built, or she stays on the water: still in her heat, still on
// the printed starting list, still scoreable — but absent from Boat_Event,
// which every leaderboard read joins, so a result for her would not appear at
// all.
//
// Heats legitimately exist before any race is scored, which is exactly the
// window in which removal is still allowed, so this is reachable in normal use.

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
}));

const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  return { db: createSqliteDbMock(mockDbHolder) };
});

// eslint-disable-next-line import/first, import/order
import { EVENT_LIFECYCLE_SCHEMA } from './fixtures/eventLifecycleSchema';

const EVENT_ID = 1;
const OTHER_EVENT_ID = 2;
const REMOVED = 1;
const KEPT = 2;

/** Two boats entered in two events, heats built, nothing raced yet. */
function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);
  db.exec(`
    INSERT INTO Events (event_id, event_name) VALUES (${EVENT_ID}, 'Kup'), (${OTHER_EVENT_ID}, 'Other');
    INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (${REMOVED}, 11, 'CRO', 'IOM'), (${KEPT}, 22, 'CRO', 'IOM');

    INSERT INTO Boat_Event (boat_id, event_id) VALUES (${REMOVED}, ${EVENT_ID}), (${KEPT}, ${EVENT_ID});
    INSERT INTO Boat_Event (boat_id, event_id) VALUES (${REMOVED}, ${OTHER_EVENT_ID});

    INSERT INTO Heats (heat_id, event_id, heat_name, heat_type) VALUES (10, ${EVENT_ID}, 'Heat A1', 'Qualifying');
    INSERT INTO Heats (heat_id, event_id, heat_name, heat_type) VALUES (20, ${OTHER_EVENT_ID}, 'Heat A1', 'Qualifying');

    INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (10, ${REMOVED}), (10, ${KEPT});
    INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (20, ${REMOVED});
  `);
  mockDbHolder.current = db;
  return db;
}

const assignmentsIn = (db: any, heat_id: number) =>
  db
    .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ? ORDER BY boat_id')
    .all(heat_id)
    .map((row: { boat_id: number }) => row.boat_id);

const entriesIn = (db: any, event_id: number) =>
  db
    .prepare(
      'SELECT boat_id FROM Boat_Event WHERE event_id = ? ORDER BY boat_id',
    )
    .all(event_id)
    .map((row: { boat_id: number }) => row.boat_id);

describe('removeBoatFromEvent', () => {
  let db: any;

  beforeAll(() => {
    require('../main/ipcHandlers/EventHandler');
  });

  beforeEach(() => {
    db = seed();
  });

  afterEach(() => {
    db.close();
  });

  it('removes the entry', async () => {
    await handlerRegistry.removeBoatFromEvent({}, REMOVED, EVENT_ID);

    expect(entriesIn(db, EVENT_ID)).toEqual([KEPT]);
  });

  it('removes her heat assignment too', async () => {
    await handlerRegistry.removeBoatFromEvent({}, REMOVED, EVENT_ID);

    expect(assignmentsIn(db, 10)).toEqual([KEPT]);
  });

  it('leaves her entry and assignment in another event alone', async () => {
    await handlerRegistry.removeBoatFromEvent({}, REMOVED, EVENT_ID);

    expect(entriesIn(db, OTHER_EVENT_ID)).toEqual([REMOVED]);
    expect(assignmentsIn(db, 20)).toEqual([REMOVED]);
  });

  it('drops a stale leaderboard row for her', async () => {
    db.exec(
      `INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place) VALUES (${REMOVED}, 4, ${EVENT_ID}, 1);
       INSERT INTO FinalLeaderboard (boat_id, total_points_final, event_id, placement_group, place) VALUES (${REMOVED}, 4, ${EVENT_ID}, 'Gold', 1);`,
    );

    await handlerRegistry.removeBoatFromEvent({}, REMOVED, EVENT_ID);

    expect(
      db
        .prepare('SELECT COUNT(*) AS c FROM Leaderboard WHERE event_id = ?')
        .get(EVENT_ID).c,
    ).toBe(0);
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM FinalLeaderboard WHERE event_id = ?',
        )
        .get(EVENT_ID).c,
    ).toBe(0);
  });

  it('refuses once a race has been scored, changing nothing', async () => {
    // The renderer already blocks this, but that state can be stale and the
    // handler is reachable on its own. A mid-series withdrawal is WTH, not a
    // removal — removing here would orphan her scores.
    db.exec(
      `INSERT INTO Races (race_id, heat_id, race_number) VALUES (500, 10, 1);
       INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (500, ${REMOVED}, 1, 1, 'FINISHED');`,
    );

    await expect(
      handlerRegistry.removeBoatFromEvent({}, REMOVED, EVENT_ID),
    ).rejects.toThrow(/race has already been scored/i);

    expect(entriesIn(db, EVENT_ID)).toEqual([REMOVED, KEPT]);
    expect(assignmentsIn(db, 10)).toEqual([REMOVED, KEPT]);
  });

  it('leaves the database referentially intact', async () => {
    await handlerRegistry.removeBoatFromEvent({}, REMOVED, EVENT_ID);

    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // The boat itself outlives the event.
    expect(db.prepare('SELECT COUNT(*) AS c FROM Boats').get().c).toBe(2);
  });
});
