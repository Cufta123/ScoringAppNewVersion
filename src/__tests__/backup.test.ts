/** @jest-environment node */
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const os = require('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const backup = require('../../public/Database/backup');

describe('automatic backups', () => {
  let workDir: string;
  let dbPath: string;
  let db: any;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-backup-'));
    dbPath = path.join(workDir, 'scoring_app.db');
    db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE Events (event_id INTEGER PRIMARY KEY, event_name TEXT);
      CREATE TABLE Sailors (sailor_id INTEGER PRIMARY KEY, name TEXT);
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const backupFiles = () =>
    fs.existsSync(backup.backupDirFor(dbPath))
      ? fs.readdirSync(backup.backupDirFor(dbPath)).sort()
      : [];

  it('writes a complete, readable copy of the live database', () => {
    db.exec("INSERT INTO Events VALUES (1, 'Kup Rogoznice')");

    const file = backup.writeBackup(db, backup.backupDirFor(dbPath), 'auto');

    const copy = new DatabaseSync(file);
    expect(copy.prepare('SELECT event_name FROM Events').get()).toEqual({
      event_name: 'Kup Rogoznice',
    });
    copy.close();
  });

  it('skips an empty database — a fresh install has nothing to lose', () => {
    const auto = backup.createAutoBackup(db, dbPath);
    expect(auto.backupNow()).toBeNull();
    expect(backupFiles()).toEqual([]);
  });

  it('backs up again only after something changed', () => {
    db.exec("INSERT INTO Events VALUES (1, 'Kup')");
    const auto = backup.createAutoBackup(db, dbPath);

    expect(auto.backupIfChanged()).not.toBeNull();
    expect(auto.backupIfChanged()).toBeNull();

    db.exec("INSERT INTO Sailors VALUES (1, 'Ana')");
    expect(auto.backupIfChanged()).not.toBeNull();
    expect(backupFiles()).toHaveLength(2);
  });

  it('keeps the recent copies plus the last copy of each earlier day', () => {
    const dir = backup.backupDirFor(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const names = [
      'auto-2026-10-25T09-00-00-000Z.db',
      'auto-2026-10-25T17-00-00-000Z.db', // last of 25th -> kept
      'auto-2026-10-26T09-00-00-000Z.db',
      'auto-2026-10-26T18-00-00-000Z.db', // last of 26th -> kept
      'auto-2026-10-27T09-00-00-000Z.db', // recent -> kept
      'auto-2026-10-27T09-05-00-000Z.db', // recent -> kept
      'pre-migration-v0-to-v2-2026-01-01T00-00-00-000Z.db', // never pruned
    ];
    names.forEach((name) => fs.writeFileSync(path.join(dir, name), ''));

    backup.pruneAutoBackups(dir, 2);

    expect(backupFiles()).toEqual([
      'auto-2026-10-25T17-00-00-000Z.db',
      'auto-2026-10-26T18-00-00-000Z.db',
      'auto-2026-10-27T09-00-00-000Z.db',
      'auto-2026-10-27T09-05-00-000Z.db',
      'pre-migration-v0-to-v2-2026-01-01T00-00-00-000Z.db',
    ]);
  });
});
