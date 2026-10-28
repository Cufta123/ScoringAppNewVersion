/** @jest-environment node */
import os from 'os';
import path from 'path';
import { classifyDatabaseFailure } from '../shared/errors/explainError';

// When the database cannot be brought up to date the app must stop and say why
// in words the person can act on. Which failure it was is decided by the shared
// explainer (the same recognition the in-window messages use); the wording
// below is the startup dialog's own.

const mockShowErrorBox = jest.fn();
const mockExit = jest.fn();
let mockMigrateError: unknown;

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(),
    exit: (...args: unknown[]) => mockExit(...args),
  },
  dialog: { showErrorBox: (...args: unknown[]) => mockShowErrorBox(...args) },
}));
jest.mock('better-sqlite3', () => jest.fn(() => ({ pragma: jest.fn() })), {
  virtual: true,
});
jest.mock('../../public/Database/schema', () => ({
  LATEST_SCHEMA_VERSION: 1,
  migrate: () => {
    throw mockMigrateError;
  },
}));
jest.mock('../../public/Database/backup', () => ({
  backupDirFor: () => '/the/backups',
  createAutoBackup: jest.fn(),
  hasUserData: jest.fn(() => false),
  writeBackup: jest.fn(),
}));

const sqliteError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

/** Start the app's database module with a migration that fails with `error`. */
function startWithFailure(error: unknown): string {
  mockMigrateError = error;
  mockShowErrorBox.mockClear();
  mockExit.mockClear();
  process.env.SCORING_APP_DB_PATH = path.join(
    os.tmpdir(),
    'iom-dbmanager-startup-test',
    'scoring_app.db',
  );
  jest.isolateModules(() => {
    // The module throws after showing the dialog; that is the point.
    expect(() => require('../../public/Database/DBManager')).toThrow();
  });
  expect(mockExit).toHaveBeenCalledWith(1);
  expect(mockShowErrorBox).toHaveBeenCalledTimes(1);
  const [title, body] = mockShowErrorBox.mock.calls[0];
  expect(title).toBe('IOM Regatta Manager cannot open its database');
  expect(body).toContain('Backups: /the/backups');
  return body as string;
}

describe('failStartup advice', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('says a damaged file needs the latest backup', () => {
    const body = startWithFailure(
      sqliteError('SQLITE_CORRUPT', 'database disk image is malformed'),
    );
    expect(body).toMatch(
      /^The data file is damaged\. Restore the latest backup/,
    );
  });

  it('says a file that is not a database is damaged too', () => {
    const body = startWithFailure(
      sqliteError('SQLITE_NOTADB', 'file is not a database'),
    );
    expect(body).toMatch(/^The data file is damaged\./);
  });

  it('says a busy file means the app is already open', () => {
    const body = startWithFailure(
      sqliteError('SQLITE_BUSY', 'database is locked'),
    );
    expect(body).toMatch(/^The data file is in use, probably because the app/);
  });

  it('says a full disk needs space', () => {
    const body = startWithFailure(
      sqliteError('SQLITE_FULL', 'database or disk is full'),
    );
    expect(body).toMatch(/^The disk is full\./);
  });

  it.each([
    sqliteError('SQLITE_READONLY', 'attempt to write a readonly database'),
    sqliteError('SQLITE_CANTOPEN', 'unable to open database file'),
    sqliteError('EACCES', 'permission denied'),
    sqliteError('EROFS', 'read-only file system'),
  ])('says a file that cannot be written is a drive problem (%p)', (error) => {
    const body = startWithFailure(error);
    expect(body).toMatch(/^The data file cannot be opened for writing\./);
  });

  it('adds no advice for a failure it cannot recognise, but still shows it', () => {
    const body = startWithFailure(new Error('Migration 4 failed: bad SQL'));
    expect(body).toMatch(/^Migration 4 failed: bad SQL\n\nDatabase: /);
  });
});

describe('classifyDatabaseFailure', () => {
  it.each([
    ['SQLITE_BUSY', 'database is locked', 'busy'],
    ['SQLITE_LOCKED', 'database table is locked', 'busy'],
    ['SQLITE_FULL', 'database or disk is full', 'full'],
    ['ENOSPC', 'no space left on device', 'full'],
    ['SQLITE_READONLY', 'attempt to write a readonly database', 'readonly'],
    ['EROFS', 'read-only file system', 'readonly'],
    ['EPERM', 'operation not permitted', 'readonly'],
    ['SQLITE_CANTOPEN', 'unable to open database file', 'unreadable'],
    ['SQLITE_IOERR', 'disk I/O error', 'unreadable'],
    ['SQLITE_CORRUPT', 'database disk image is malformed', 'damaged'],
    ['SQLITE_NOTADB', 'file is not a database', 'damaged'],
  ])('%s is %s', (code, message, expected) => {
    expect(classifyDatabaseFailure(sqliteError(code, message))).toBe(expected);
  });

  it('recognises a failure from its text when there is no code', () => {
    expect(classifyDatabaseFailure(new Error('database is locked'))).toBe(
      'busy',
    );
    expect(
      classifyDatabaseFailure(new Error('database disk image is malformed')),
    ).toBe('damaged');
  });

  it('is null for an error that is not about the database file', () => {
    expect(
      classifyDatabaseFailure(new Error('Cannot score Heat A1')),
    ).toBeNull();
    expect(
      classifyDatabaseFailure(
        sqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed'),
      ),
    ).toBeNull();
    expect(classifyDatabaseFailure(undefined)).toBeNull();
    expect(classifyDatabaseFailure(null)).toBeNull();
  });
});
