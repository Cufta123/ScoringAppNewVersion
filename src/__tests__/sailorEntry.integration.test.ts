/** @jest-environment node */
export {};

/**
 * Entering sailors (the add form's enterSailorInEvent and the CSV import) and
 * moving an event to another computer (importEventSnapshot), through the real
 * handlers on a database built by the real migrations.
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const freshDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
};

let db: any;
const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args);
const count = (table: string): number =>
  db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

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

const entry = (overrides: Record<string, unknown> = {}) => ({
  name: 'Ivan',
  surname: 'Horvat',
  clubName: 'JK Split',
  country: 'CRO',
  sailNumber: '12',
  model: 'IOM',
  categoryId: 3,
  ...overrides,
});

beforeAll(() => {
  require('../main/ipcHandlers/SailorHandler');
  require('../main/ipcHandlers/EventHandler');
  require('../main/ipcHandlers/HeatRaceHandler');
});

beforeEach(() => {
  db = freshDb();
  mockDbHolder.current = db;
});

afterEach(() => {
  db.close();
});

describe('enterSailorInEvent', () => {
  it('enters club, sailor and boat together', async () => {
    const eventId = await createEvent('Kup');
    const result = await call('enterSailorInEvent', entry(), eventId);
    expect(result).toMatchObject({
      status: 'entered',
      createdBoat: true,
      createdSailor: true,
    });
    expect(all('SELECT club_name, country FROM Clubs')).toEqual([
      { club_name: 'JK Split', country: 'CRO' },
    ]);
    expect(count('Boat_Event')).toBe(1);
  });

  it('two sailors of the same name in different clubs are two people', async () => {
    const eventId = await createEvent('Kup');
    await call('enterSailorInEvent', entry({ categoryId: 4 }), eventId);
    await call(
      'enterSailorInEvent',
      entry({ clubName: 'JK Zadar', sailNumber: '77', categoryId: 2 }),
      eventId,
    );
    const sailors = all(
      `SELECT s.name, c.club_name, s.category_id FROM Sailors s
       JOIN Clubs c ON c.club_id = s.club_id ORDER BY s.sailor_id`,
    );
    // Earlier the second Ivan Horvat became the first, with his club and
    // subgroup.
    expect(sailors).toEqual([
      { name: 'Ivan', club_name: 'JK Split', category_id: 4 },
      { name: 'Ivan', club_name: 'JK Zadar', category_id: 2 },
    ]);
  });

  it('the same sailor with a second boat stays one person', async () => {
    const eventId = await createEvent('Kup');
    await call('enterSailorInEvent', entry(), eventId);
    const other = await createEvent('Other');
    await call('enterSailorInEvent', entry({ sailNumber: '99' }), other);
    expect(count('Sailors')).toBe(1);
    expect(count('Boats')).toBe(2);
  });

  it("writes nothing for someone else's boat until told to use her sailor", async () => {
    const first = await createEvent('First');
    await call('enterSailorInEvent', entry(), first);
    const eventId = await createEvent('Kup');
    const before = {
      sailors: count('Sailors'),
      clubs: count('Clubs'),
      boats: count('Boats'),
    };

    const asked = await call(
      'enterSailorInEvent',
      entry({ name: 'Ana', surname: 'Kovač', clubName: 'JK Novi' }),
      eventId,
    );
    expect(asked).toMatchObject({
      status: 'ownerConflict',
      ownerName: 'Ivan Horvat',
    });
    // A Cancel at this point used to leave Ana and her club behind.
    expect({
      sailors: count('Sailors'),
      clubs: count('Clubs'),
      boats: count('Boats'),
    }).toEqual(before);
    expect(all('SELECT 1 FROM Boat_Event WHERE event_id = ?', eventId)).toEqual(
      [],
    );

    const entered = await call(
      'enterSailorInEvent',
      entry({ name: 'Ana', surname: 'Kovač', clubName: 'JK Novi' }),
      eventId,
      { useRegisteredSailor: true },
    );
    expect(entered).toMatchObject({ status: 'entered', createdBoat: false });
    expect(count('Sailors')).toBe(before.sailors);
  });

  it('a failure part-way rolls back the club it already wrote', async () => {
    const eventId = await createEvent('Kup');
    // The club is written first; the sailor then fails (no such subgroup).
    await expect(
      call(
        'enterSailorInEvent',
        entry({ clubName: 'JK Novi', categoryId: 999 }),
        eventId,
      ),
    ).rejects.toThrow();
    expect(count('Clubs')).toBe(0);
    expect(count('Sailors')).toBe(0);
    expect(count('Boats')).toBe(0);
  });

  it('says when the boat is already entered', async () => {
    const eventId = await createEvent('Kup');
    await call('enterSailorInEvent', entry(), eventId);
    expect(await call('enterSailorInEvent', entry(), eventId)).toMatchObject({
      status: 'alreadyEntered',
    });
  });
});

describe('importSailors and its preview', () => {
  const row = (name: string, sail: string, extra = {}) => ({
    name,
    surname: 'Test',
    birthday: '',
    sail_number: sail,
    country: 'CRO',
    model: 'IOM',
    club_name: 'JK Split',
    category_name: 'M',
    ...extra,
  });

  it("names the rows whose boat is someone else's and leaves them out", async () => {
    const first = await createEvent('First');
    await call('enterSailorInEvent', entry(), first);
    const eventId = await createEvent('Kup');
    const rows = [row('Ana', '12'), row('Bor', '13')].map((r) => ({
      ...r,
      eventId,
    }));

    const preview = await call('previewSailorImport', rows);
    expect(preview.conflicts).toEqual([
      {
        line: 2,
        sail: 'CRO 12',
        fileName: 'Ana Test',
        ownerName: 'Ivan Horvat',
      },
    ]);

    const summary = await call('importSailors', rows);
    expect(summary).toMatchObject({ created: 1, ownerConflicts: 1 });
    // No Ana without a boat.
    expect(all("SELECT name FROM Sailors WHERE name = 'Ana'")).toEqual([]);
  });

  it('enters them under the registered sailor when asked to', async () => {
    const first = await createEvent('First');
    await call('enterSailorInEvent', entry(), first);
    const eventId = await createEvent('Kup');
    const summary = await call(
      'importSailors',
      [{ ...row('Ana', '12'), eventId }],
      { ownerConflicts: 'use-registered' },
    );
    expect(summary).toMatchObject({ associated: 1, ownerConflicts: 0 });
    expect(count('Sailors')).toBe(1);
  });

  it("keeps a known sailor's club and subgroup when the file has none", async () => {
    const first = await createEvent('First');
    await call('enterSailorInEvent', entry({ categoryId: 4 }), first);
    const eventId = await createEvent('Kup');
    await call('importSailors', [
      {
        ...row('Ivan', '12', {
          surname: 'Horvat',
          club_name: '',
          category_name: '',
        }),
        eventId,
      },
    ]);
    expect(
      all(
        `SELECT c.club_name, s.category_id FROM Sailors s JOIN Clubs c ON c.club_id = s.club_id`,
      ),
    ).toEqual([{ club_name: 'JK Split', category_id: 4 }]);
  });
});

describe('importEventSnapshot (another computer)', () => {
  async function scoredEvent() {
    const eventId = await createEvent('Kup Kvarnera');
    const sails = ['1', '2', '3', '4'];
    // eslint-disable-next-line no-restricted-syntax
    for (const [i, sail] of sails.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await call(
        'enterSailorInEvent',
        entry({ name: `S${i}`, surname: 'X', sailNumber: sail }),
        eventId,
      );
    }
    await call('createInitialHeatsAtomic', eventId, 1);
    const [heat] = all('SELECT heat_id FROM Heats WHERE event_id = ?', eventId);
    await call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: sails.map((sail, index) => ({
        boatNumber: sail,
        place: index + 1,
        status: 'FINISHED',
      })),
    });
    return eventId;
  }

  it('adds the event to an empty database with its sailors and results', async () => {
    const eventId = await scoredEvent();
    // eslint-disable-next-line global-require
    const snapshotModule = require('../main/functions/eventSnapshot');
    const file = JSON.parse(
      JSON.stringify(snapshotModule.buildEventSnapshot(eventId)),
    );
    const standingsBefore = await call('readLeaderboard', eventId);

    db.close();
    db = freshDb();
    mockDbHolder.current = db;
    await createEvent('Something else');

    const { eventId: imported, eventName } =
      snapshotModule.importEventSnapshot(file);
    expect(eventName).toBe('Kup Kvarnera');
    expect(
      all('SELECT name FROM Sailors ORDER BY name').map((s: any) => s.name),
    ).toEqual(['S0', 'S1', 'S2', 'S3']);
    const standingsAfter = await call('readLeaderboard', imported);
    const pick = (rows: any[]) =>
      rows
        .map((r) => ({
          sail: String(r.sail_number),
          total: r.total_points_event,
        }))
        .sort((a, b) => a.sail.localeCompare(b.sail));
    expect(pick(standingsAfter)).toEqual(pick(standingsBefore));
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('can be imported twice: the second copy gets its own name', async () => {
    const eventId = await scoredEvent();
    // eslint-disable-next-line global-require
    const snapshotModule = require('../main/functions/eventSnapshot');
    const file = snapshotModule.buildEventSnapshot(eventId);
    const second = snapshotModule.importEventSnapshot(file);
    expect(second.eventName).toBe('Kup Kvarnera (imported)');
    // The boats on file are reused, not doubled.
    expect(count('Boats')).toBe(4);
  });

  it('refuses an old backup without the sailors, in words', async () => {
    const eventId = await scoredEvent();
    // eslint-disable-next-line global-require
    const snapshotModule = require('../main/functions/eventSnapshot');
    const { people, ...old } = snapshotModule.buildEventSnapshot(eventId);
    expect(people.Boats).toHaveLength(4);
    db.close();
    db = freshDb();
    mockDbHolder.current = db;
    expect(() => snapshotModule.importEventSnapshot(old)).toThrow(
      /older version of the app/,
    );
    expect(count('Events')).toBe(0);
  });
});
