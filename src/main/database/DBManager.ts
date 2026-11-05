/* eslint-disable no-console */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app, dialog } from 'electron';
import { migrate, LATEST_SCHEMA_VERSION } from './schema';
import {
  classifyDatabaseFailure,
  type DatabaseFailure,
} from '../../shared/errors/explainError';
import {
  backupDirFor,
  createAutoBackup,
  hasUserData,
  writeBackup,
} from './backup';
import { DB_FILE, resolveDataDir, resolveDevDataDir } from './dataLocation';

/**
 * The app's connection. Typed, so the compiler checks how it is used; a
 * statement's rows are `unknown` until the call site that reads them says
 * which row type of the IPC contract (`src/shared/rows.ts`, `ipc.ts`) the
 * SQL returns, e.g. `db.prepare(sql).all(eventId) as EventBoatRow[]`.
 */
export type Db = Database.Database;

// Define the path for the database file.
//
// SCORING_APP_DB_PATH overrides both locations. It exists for the end-to-end
// tests, which drive the real app and would otherwise write into the developer
// database: every run left its events, sailors and races behind, so runs grew
// slower and later ones tripped over identity rules (a sail number registered
// by an earlier run) that have nothing to do with the test at hand. Pointing
// each run at a throwaway file makes it start from an empty database.
//
// Installed, the data lives in Electron's data folder, or in the folder an
// earlier build (named after the template) used, if that is where the
// results are (dataLocation.ts). The app's own browser data follows it.
// Run from the repository (`npm start`), it lives in the repository
// (resolveDevDataDir), whichever build tool built the main process.
const packagedDbPath = (): string => {
  const dir = resolveDataDir({
    userData: app.getPath('userData'),
    appData: app.getPath('appData'),
    exists: fs.existsSync,
  });
  if (dir !== app.getPath('userData')) app.setPath('userData', dir);
  return path.join(dir, DB_FILE);
};

const devDbPath = (): string =>
  path.join(
    resolveDevDataDir({ repoRoot: app.getAppPath(), exists: fs.existsSync }),
    DB_FILE,
  );

export const dbPath: string =
  process.env.SCORING_APP_DB_PATH ||
  (app.isPackaged ? packagedDbPath() : devDbPath());

const dataDir = path.dirname(dbPath);
console.log(`Database path: ${dbPath}`);
fs.mkdirSync(dataDir, { recursive: true });

export const db: Db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// What to tell the person when the app cannot start, by kind of failure. The
// kinds come from the shared explainer (the same recognition as the messages
// in the window); the advice is worded for startup, when no menu is reachable.
const CANNOT_WRITE =
  'The data file cannot be opened for writing. Check that the drive is connected and not read-only.\n\n';
const STARTUP_ADVICE: Record<DatabaseFailure, string> = {
  damaged:
    'The data file is damaged. Restore the latest backup from the backups folder below (copy it over the database file while the app is closed).\n\n',
  busy: 'The data file is in use, probably because the app is already open. Close the other window and start the app again.\n\n',
  full: 'The disk is full. Free some space and start the app again.\n\n',
  readonly: CANNOT_WRITE,
  unreadable: CANNOT_WRITE,
};

/**
 * Stop instead of running on a database whose schema could not be brought up
 * to date. Carrying on would let the app read and write a half-migrated file
 * and turn one failed step into wrong results; the pre-migration backup is
 * untouched and the message says where to find it.
 */
function failStartup(error: unknown): never {
  console.error('Database could not be opened:', error);
  const detail =
    error && (error as Error).message
      ? (error as Error).message
      : String(error);
  const kind = classifyDatabaseFailure(error);
  const plain = kind ? STARTUP_ADVICE[kind] : '';
  dialog.showErrorBox(
    'IOM Regatta Manager cannot open its database',
    `${plain}${detail}\n\n` +
      `Database: ${dbPath}\n` +
      `Backups: ${backupDirFor(dbPath)}\n\n` +
      'No changes have been made after the last successful step. ' +
      'Please report this, and keep the backups folder.',
  );
  app.exit(1);
  throw error;
}

try {
  const result = migrate(db, {
    beforeMigrating: (from, to) => {
      // Only an existing database with real data needs protecting; a fresh
      // install has nothing to lose.
      if (from > 0 || hasUserData(db)) {
        const file = writeBackup(
          db,
          backupDirFor(dbPath),
          `pre-migration-v${from}-to-v${to}`,
        );
        console.log(`Pre-migration backup written to ${file}`);
      }
    },
  });
  if (result.applied.length > 0) {
    console.log(
      `Database schema migrated from v${result.from} to v${result.to}.`,
    );
  } else {
    console.log(`Database schema is current (v${LATEST_SCHEMA_VERSION}).`);
  }
} catch (error) {
  failStartup(error);
}

// Rolling safety copies while the app runs; main.ts starts and stops them.
export const autoBackup = createAutoBackup(db, dbPath);
