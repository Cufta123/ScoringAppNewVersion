/** @jest-environment node */
export {};

/**
 * The event's export logo through the real migrations and handlers on a real
 * SQLite engine: it is stored with the event, kept out of the event list and
 * out of the change history, and travels with an event snapshot.
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
import {
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../main/functions/eventSnapshot';
// eslint-disable-next-line import/first, import/order
import { isAcceptableLogo } from '../main/functions/exportLogo';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate, getSchemaVersion } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('event export logo', () => {
  let db: any;
  let eventId: number;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // handle() logs every refusal; these tests cause some on purpose.
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
    const result = await call(
      'insertEvent',
      'Kup',
      'Split',
      '2026-05-01',
      '2026-05-03',
    );
    eventId = Number(result.lastInsertRowid);
  });

  afterEach(() => db.close());

  it('is added by a migration, as an empty column', () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(7);
    const columns = db.prepare("PRAGMA table_info('Events')").all();
    expect(columns.map((c: { name: string }) => c.name)).toContain(
      'export_logo',
    );
    expect(
      db.prepare('SELECT export_logo FROM Events').get().export_logo,
    ).toBeNull();
  });

  it('saves, reads and removes the logo', async () => {
    expect(await call('readEventExportLogo', eventId)).toBeNull();
    await call('saveEventExportLogo', eventId, LOGO);
    expect(await call('readEventExportLogo', eventId)).toBe(LOGO);
    await call('saveEventExportLogo', eventId, null);
    expect(await call('readEventExportLogo', eventId)).toBeNull();
  });

  it('refuses anything that is not a PNG or JPEG picture', async () => {
    await expect(
      call('saveEventExportLogo', eventId, '<svg onload=alert(1)>'),
    ).rejects.toThrow(/PNG or JPEG/);
    await expect(
      call('saveEventExportLogo', eventId, 'data:text/html;base64,AAAA'),
    ).rejects.toThrow(/PNG or JPEG/);
    await expect(
      call(
        'saveEventExportLogo',
        eventId,
        `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`,
      ),
    ).rejects.toThrow(/PNG or JPEG/);
    expect(await call('readEventExportLogo', eventId)).toBeNull();
    expect(isAcceptableLogo(LOGO)).toBe(true);
    expect(isAcceptableLogo(42)).toBe(false);
  });

  it('says so when the event is gone', async () => {
    await expect(call('saveEventExportLogo', 9999, LOGO)).rejects.toThrow(
      /no longer exists/,
    );
  });

  it('is left out of the event list, so the list stays small', async () => {
    await call('saveEventExportLogo', eventId, LOGO);
    const [event] = await call('readAllEvents');
    expect(event.event_name).toBe('Kup');
    expect(event).not.toHaveProperty('export_logo');
  });

  it('is not written into the change history', async () => {
    const changes = () =>
      db.prepare('SELECT COUNT(*) AS c FROM ChangeLog').get().c;
    const before = changes();
    await call('saveEventExportLogo', eventId, LOGO);
    await call('saveEventExportLogo', eventId, null);
    expect(changes()).toBe(before);
  });

  it('travels with an event snapshot (export and restore)', async () => {
    await call('saveEventExportLogo', eventId, LOGO);
    const snapshot = buildEventSnapshot(eventId);
    expect(snapshot.tables.Events[0].export_logo).toBe(LOGO);

    await call('saveEventExportLogo', eventId, null);
    restoreEventSnapshot(eventId, snapshot as any);
    expect(await call('readEventExportLogo', eventId)).toBe(LOGO);
  });

  it('a snapshot from before logos leaves the current logo alone', async () => {
    const snapshot = JSON.parse(JSON.stringify(buildEventSnapshot(eventId)));
    delete snapshot.tables.Events[0].export_logo;
    await call('saveEventExportLogo', eventId, LOGO);
    restoreEventSnapshot(eventId, snapshot);
    expect(await call('readEventExportLogo', eventId)).toBe(LOGO);
  });

  it('a snapshot file with a hostile logo never stores it', async () => {
    const snapshot = JSON.parse(JSON.stringify(buildEventSnapshot(eventId)));
    snapshot.tables.Events[0].export_logo = `${'javascript'}:alert(1)`;
    restoreEventSnapshot(eventId, snapshot);
    expect(await call('readEventExportLogo', eventId)).toBeNull();
  });
});
