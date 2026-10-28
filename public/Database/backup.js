/* eslint-disable no-console */
/**
 * Automatic database backups.
 *
 * A regatta's results live in one SQLite file on one laptop. These copies are
 * the safety net for a crash, a bad migration, or a wrong click in the race
 * office:
 *
 *  - `pre-migration-*`  taken before any schema migration runs. Never pruned.
 *  - `auto-*`           taken on start-up, every few minutes while data is
 *                       changing, and on quit. The newest MAX_AUTO_BACKUPS
 *                       are kept, plus the last one of each earlier day.
 *
 * Copies are made with `VACUUM INTO`, which writes a consistent, compacted
 * snapshot of the live database (WAL included) without closing it. To restore
 * one, quit the app and copy the backup over `scoring_app.db`.
 */
const fs = require('fs');
const path = require('path');

// Recent rolling copies (about two hours of busy scoring at the 5-minute
// interval). Older ones thin out to one per day — see pruneAutoBackups.
const MAX_AUTO_BACKUPS = 24;

const timestamp = (date = new Date()) =>
  // 2026-10-27T14-05-09-123Z — sortable, and legal in Windows file names.
  date.toISOString().replace(/[:.]/g, '-');

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

function backupDirFor(dbPath) {
  return path.join(path.dirname(dbPath), 'backups');
}

/** True when the database holds anything worth keeping. */
function hasUserData(db) {
  try {
    const row = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM Events) + (SELECT COUNT(*) FROM Sailors) AS n`,
      )
      .get();
    return Number(row?.n) > 0;
  } catch {
    // Tables missing: a brand-new or pre-schema file. Nothing to protect.
    return false;
  }
}

/**
 * Write a snapshot of `db` into `dir` and return its path.
 * `kind` becomes the file-name prefix ('auto', 'pre-migration-v1-to-v2', …).
 */
function writeBackup(db, dir, kind) {
  fs.mkdirSync(dir, { recursive: true });
  let target = path.join(dir, `${kind}-${timestamp()}.db`);
  // Two backups in the same millisecond would collide; VACUUM INTO refuses to
  // overwrite an existing file.
  let suffix = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${kind}-${timestamp()}-${suffix}.db`);
    suffix += 1;
  }
  db.exec(`VACUUM INTO ${sqlString(target)}`);
  return target;
}

/**
 * Prune `auto-*` backups. Keeps the newest `keepRecent` copies, plus the last
 * copy of every earlier day — so a three-day regatta still has an end-of-day
 * snapshot for each day after the recent window has rolled past it.
 * Returns the deleted paths.
 */
function pruneAutoBackups(dir, keepRecent = MAX_AUTO_BACKUPS) {
  if (!fs.existsSync(dir)) return [];
  const autos = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('auto-') && name.endsWith('.db'))
    .sort(); // ISO timestamps sort chronologically
  const older = autos.slice(0, Math.max(0, autos.length - keepRecent));
  const lastOfDay = new Map();
  older.forEach((name) => {
    // auto-2026-10-27T14-05-09-123Z.db -> 2026-10-27
    lastOfDay.set(name.slice('auto-'.length, 'auto-'.length + 10), name);
  });
  const dailyKeepers = new Set(lastOfDay.values());
  return older
    .filter((name) => !dailyKeepers.has(name))
    .map((name) => {
      const full = path.join(dir, name);
      fs.rmSync(full, { force: true });
      return full;
    });
}

/**
 * Rolling backups for a live database.
 *
 * `backupIfChanged()` writes an `auto-*` copy only when the connection has
 * made changes since the last one (`total_changes()`), so an idle app does
 * not churn out identical files. Call `start()` once the app is running and
 * `stop()` + `backupIfChanged()` on quit.
 */
function createAutoBackup(
  db,
  dbPath,
  { intervalMs = 5 * 60 * 1000, onStatus = null } = {},
) {
  const dir = backupDirFor(dbPath);
  // Tell the app when backups start failing and when they work again, so
  // the person at the screen is not relying on copies that are not there.
  let statusListener = onStatus;
  let failing = false;
  const report = (ok, error) => {
    if (ok === !failing) return;
    failing = !ok;
    if (statusListener) {
      try {
        statusListener({ ok, error });
      } catch (listenerError) {
        console.error('Backup status listener failed:', listenerError);
      }
    }
  };
  const totalChanges = () =>
    Number(db.prepare('SELECT total_changes() AS n').get().n);
  let lastBackedUpAt = null;
  let timer = null;

  const backup = () => {
    try {
      if (!hasUserData(db)) return null;
      const file = writeBackup(db, dir, 'auto');
      lastBackedUpAt = totalChanges();
      report(true);
      try {
        pruneAutoBackups(dir);
      } catch (error) {
        console.error('Pruning old automatic backups failed:', error);
      }
      return file;
    } catch (error) {
      // A failed backup must never take scoring down with it.
      console.error('Automatic backup failed:', error);
      report(false, error);
      return null;
    }
  };

  return {
    dir,
    /** Called with { ok, error } when backups fail, and when they recover. */
    onStatus(listener) {
      statusListener = listener;
    },
    backupNow: backup,
    backupIfChanged() {
      if (lastBackedUpAt !== null && totalChanges() === lastBackedUpAt) {
        return null;
      }
      return backup();
    },
    start() {
      if (timer) return;
      timer = setInterval(() => this.backupIfChanged(), intervalMs);
      // Do not keep the process alive just for backups.
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  MAX_AUTO_BACKUPS,
  backupDirFor,
  createAutoBackup,
  hasUserData,
  pruneAutoBackups,
  writeBackup,
};
