/* eslint-disable no-console */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app, dialog } = require('electron');
const { migrate, LATEST_SCHEMA_VERSION } = require('./schema');
const {
  classifyDatabaseFailure,
} = require('../../src/shared/errors/explainError');
const {
  backupDirFor,
  createAutoBackup,
  hasUserData,
  writeBackup,
} = require('./backup');

// Define the path for the database file.
//
// SCORING_APP_DB_PATH overrides both locations. It exists for the end-to-end
// tests, which drive the real app and would otherwise write into the developer
// database: every run left its events, sailors and races behind, so runs grew
// slower and later ones tripped over identity rules (a sail number registered
// by an earlier run) that have nothing to do with the test at hand. Pointing
// each run at a throwaway file makes it start from an empty database.
const dbPath =
  process.env.SCORING_APP_DB_PATH ||
  (app.isPackaged
    ? path.join(app.getPath('userData'), 'scoring_app.db')
    : path.join(__dirname, 'public', 'Database', 'data', 'scoring_app.db'));

const dataDir = path.dirname(dbPath);
console.log(`Database path: ${dbPath}`);
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// What to tell the person when the app cannot start, by kind of failure. The
// kinds come from the shared explainer (the same recognition as the messages
// in the window); the advice is worded for startup, when no menu is reachable.
const CANNOT_WRITE =
  'The data file cannot be opened for writing. Check that the drive is connected and not read-only.\n\n';
const STARTUP_ADVICE = {
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
function failStartup(error) {
  console.error('Database could not be opened:', error);
  const detail = error && error.message ? error.message : String(error);
  const plain = STARTUP_ADVICE[classifyDatabaseFailure(error)] || '';
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
const autoBackup = createAutoBackup(db, dbPath);

module.exports = { db, dbPath, autoBackup };
