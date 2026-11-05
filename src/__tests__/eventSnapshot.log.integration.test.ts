/** @jest-environment node */
export {};

/**
 * The backup file carries the event's decision log (schemaVersion 3). An
 * event is built through the real handlers (a tie, a race-office
 * correction, a committee DSQ, RDG2 on chosen races, a late entry, the
 * Final Series and a final race), saved to a file through the real export,
 * and then:
 * - restored into the same event after further changes: the log is the
 *   file's, the standings those of the file, one action in the history that
 *   can be gone back from, nothing converted;
 * - imported as a new event on another computer: the same standings by sail
 *   number, the log the original with the boats renamed;
 * - refused in words, changing nothing, when the library refuses its log.
 * A version 2 file (no log) still restores and imports from its tables.
 * Real migrations, real handlers, the real journal, real SQLite.
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
jest.mock('../main/database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

/* eslint-disable import/first, import/order */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dialog } from 'electron';
import {
  applyRaceColumnEdit,
  boatsNamed,
  renameBoats,
  type Decision,
} from 'regatta-core';
import { setCallObserver } from '../main/ipcHandlers/handle';
import { journalObserver } from '../main/functions/changeJournal';
import { loadLog } from '../main/functions/decisionStore';
import {
  FROM_FILE_NOTE,
  restoreEventSnapshot,
} from '../main/functions/eventSnapshot';
import convertEventsAtStartup from '../main/functions/startupConversion';
import type { EventSnapshotFile } from '../shared/eventSnapshot';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../main/database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

let db: any;
let dir: string;

const freshDb = () => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
};

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  require('../main/ipcHandlers/SailorHandler');
  require('../main/ipcHandlers/EventHandler');
  require('../main/ipcHandlers/HeatRaceHandler');
  setCallObserver(journalObserver);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-snapshot-'));
});
afterAll(() => {
  setCallObserver(null);
  fs.rmSync(dir, { recursive: true, force: true });
  jest.restoreAllMocks();
});
afterEach(() => {
  db?.close();
  mockDbHolder.current = null;
});

const one = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args);
const all = (sql: string, ...args: unknown[]) =>
  db.prepare(sql).all(...args) as any[];

const heatId = (eventId: number, name: string): number =>
  one(
    'SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?',
    eventId,
    name,
  ).heat_id;
const boatOf = (sail: number): number =>
  one('SELECT boat_id FROM Boats WHERE sail_number = ?', sail).boat_id;
const sailsIn = (heat: number): number[] =>
  all(
    `SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id
     WHERE hb.heat_id = ? ORDER BY b.sail_number`,
    heat,
  ).map((row) => Number(row.sail_number));
const raceOf = (heat: number): number =>
  one('SELECT race_id FROM Races WHERE heat_id = ? ORDER BY race_number', heat)
    .race_id;

/** Score a heat's next race: `places[i]` for the i-th boat by sail. */
async function score(eventId: number, heatName: string, places?: number[]) {
  const id = heatId(eventId, heatName);
  const sails = sailsIn(id);
  const result = await call('submitHeatRaceScoresAtomic', {
    heat_id: id,
    placeNumbers: sails.map((sail, i) => ({
      boatNumber: sail,
      place: places ? places[i] : i + 1,
      status: 'FINISHED',
    })),
  });
  expect(result.ok).toBe(true);
  return Number(result.raceId);
}

/**
 * Correct one boat's result as the leaderboard does: the race's column
 * through the edit rules, saved whole, her cell typed.
 */
async function correct(
  eventId: number,
  raceId: number,
  sail: number,
  newPosition: number,
  newStatus: string,
  extra: Record<string, unknown> = {},
) {
  const rows = all(
    `SELECT boat_id, position, points, COALESCE(status, 'FINISHED') AS status,
            held_place FROM Scores WHERE race_id = ? ORDER BY boat_id`,
    raceId,
  );
  const { heat_type: heatType } = one(
    'SELECT h.heat_type FROM Races r JOIN Heats h ON h.heat_id = r.heat_id WHERE r.race_id = ?',
    raceId,
  );
  const maxBoats = await call('getMaxHeatSize', eventId, heatType);
  const index = rows.findIndex((row) => row.boat_id === boatOf(sail));
  const cells = applyRaceColumnEdit(
    rows.map((row) => ({
      position: row.position,
      points: row.points,
      status: row.status,
      ...(row.held_place != null ? { heldPlace: row.held_place } : {}),
    })),
    {
      index,
      previousPosition: rows[index].position,
      previousStatus: rows[index].status,
      newPosition,
      newPoints: newPosition,
      newStatus,
      maxBoats,
    },
  );
  const result = await call('saveLeaderboardRaceResultsAtomic', eventId, [
    {
      raceId,
      cells: cells.map((cell, i) => ({
        boatId: rows[i].boat_id,
        position: cell.position,
        status: cell.status,
        edited: i === index,
        ...(/^(RDG|DPI)/.test(cell.status)
          ? { heldPlace: cell.heldPlace ?? null }
          : {}),
        ...(i === index ? extra : {}),
      })),
    },
  ]);
  expect(result.success).toBe(true);
}

const enter = (eventId: number, sail: number) =>
  call(
    'enterSailorInEvent',
    {
      name: `Sailor${sail}`,
      surname: 'Test',
      clubName: 'JK Split',
      country: 'CRO',
      sailNumber: String(sail),
      model: 'IOM',
      categoryId: null,
    },
    eventId,
  );

/** The event of every case: everything a backup must bring back. */
async function buildEvent(): Promise<number> {
  const eventId = Number(
    (
      await call(
        'insertEvent',
        'Kup Jadrana',
        'Split',
        '2026-05-01',
        '2026-05-03',
      )
    ).lastInsertRowid,
  );
  for (let sail = 1; sail <= 8; sail += 1) {
    // eslint-disable-next-line no-await-in-loop
    await enter(eventId, sail);
  }
  await call('createInitialHeatsAtomic', eventId, 2);
  // A tie at the finish (RRS A7): the 2nd and 3rd boats of A1 on place 2.
  const a1 = await score(eventId, 'Heat A1', [1, 2, 2, 4]);
  const b1 = await score(eventId, 'Heat B1');
  // A race-office correction: B1's winner was second.
  const [firstOfB1] = sailsIn(heatId(eventId, 'Heat B1'));
  await correct(eventId, b1, firstOfB1, 2, 'FINISHED');
  // The protest committee disqualifies A1's winner.
  const [firstOfA1] = sailsIn(heatId(eventId, 'Heat A1'));
  await correct(eventId, a1, firstOfA1, 1, 'DSQ');

  await call('createNewHeatsBasedOnLeaderboard', eventId);
  // A late entry joins Heat A2 before it races.
  const late = await enter(eventId, 9);
  await call('insertHeatBoat', heatId(eventId, 'Heat A2'), late.boatId);
  const a2 = await score(eventId, 'Heat A2');
  await score(eventId, 'Heat B2');
  // RDG2 for a boat of A2 that sailed round 1, on her round-1 race.
  const redressed = sailsIn(heatId(eventId, 'Heat A2')).find((sail) =>
    sailsIn(heatId(eventId, 'Heat A1')).includes(sail),
  )!;
  await correct(eventId, a2, redressed, 3, 'RDG2', { rdgRaceIds: [a1] });

  await call('startFinalSeriesAtomic', eventId);
  await score(eventId, 'Final Gold');
  return eventId;
}

/** The three standings, with the database's ids left out. */
async function standings(eventId: number) {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !/(^|_)ids?$|Id$/.test(key))
          .map(([key, v]) => [key, strip(v)]),
      );
    }
    return value;
  };
  return strip({
    qualifying: await call('readLeaderboard', eventId),
    final: await call('readFinalLeaderboard', eventId),
    overall: await call('readOverallLeaderboard', eventId),
  });
}

/** Save the event's backup file through the real handler; its contents. */
async function saveBackup(eventId: number, name: string) {
  const file = path.join(dir, name);
  (dialog.showSaveDialog as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    filePath: file,
  });
  const saved = await call('exportEventSnapshotToFile', eventId);
  expect(saved).toEqual({ success: true, filePath: file });
  return { file, contents: JSON.parse(fs.readFileSync(file, 'utf-8')) };
}

const pickFile = (file: string) =>
  (dialog.showOpenDialog as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    filePaths: [file],
  });

const writeFile = (name: string, contents: unknown) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(contents));
  return file;
};

const actions = () =>
  all('SELECT action_id, channel FROM ChangeActions ORDER BY action_id');
const eventLogRow = (eventId: number) =>
  one('SELECT * FROM EventLogs WHERE event_id = ?', eventId);
const decisionRows = (eventId: number) =>
  one('SELECT COUNT(*) AS n FROM Decisions WHERE event_id = ?', eventId).n;

const types = (log: Decision[]) => log.map((d) => d.type);

describe('a backup file with the decision log (schemaVersion 3)', () => {
  let eventId: number;
  let backup: { file: string; contents: EventSnapshotFile };
  let atBackup: unknown;

  beforeEach(async () => {
    freshDb();
    eventId = await buildEvent();
    atBackup = await standings(eventId);
    backup = await saveBackup(eventId, `kup-${Date.now()}.json`);
  });

  it('carries the log in force, everything the event is made of', () => {
    const { contents } = backup;
    expect(contents.schemaVersion).toBe(3);
    expect(contents.log).toEqual(loadLog(eventId));
    const log = contents.log as Decision[];
    // The event the file must bring back has every kind of decision.
    expect(types(log)).toEqual(
      expect.arrayContaining([
        'boatEntered',
        'heatsCreated',
        'raceScored',
        'raceCorrected',
        'protestDecided',
        'roundCreated',
        'boatAssigned',
        'finalSeriesStarted',
      ]),
    );
    const outcomes = log.flatMap((d) =>
      d.type === 'protestDecided' ? [d.outcome.kind] : [],
    );
    expect(outcomes).toEqual(expect.arrayContaining(['DSQ', 'RDG2']));
    expect(
      log.some(
        (d) => d.type === 'raceScored' && d.lines.some((line) => line.tied),
      ),
    ).toBe(true);
    expect(
      log.some((d) => d.type === 'raceScored' && d.race.heat === 'Gold'),
    ).toBe(true);
    // The tables are still written, for people and older versions.
    expect(contents.tables.Scores.length).toBeGreaterThan(0);
    expect(contents.people.Boats).toHaveLength(9);
  });

  it('restores into the same event: the log is the file’s, one action that can be gone back from', async () => {
    // Work after the backup: a Silver race, a correction, a new name.
    await score(eventId, 'Final Silver');
    const gold = raceOf(heatId(eventId, 'Final Gold'));
    const [goldWinner] = sailsIn(heatId(eventId, 'Final Gold'));
    await correct(eventId, gold, goldWinner, 1, 'DNF');
    await call(
      'updateEvent',
      eventId,
      'Renamed after the backup',
      'Zadar',
      '2026-05-01',
      '2026-05-03',
    );
    const logBefore = loadLog(eventId);
    const standingsBefore = await standings(eventId);
    expect(standingsBefore).not.toEqual(atBackup);
    const lastBefore = actions().at(-1).action_id;
    const conversion = eventLogRow(eventId);

    pickFile(backup.file);
    const restored = await call('restoreEventSnapshotFromFile', eventId);
    expect(restored).toEqual({ success: true, filePath: backup.file });

    expect(loadLog(eventId)).toEqual(backup.contents.log);
    expect(await standings(eventId)).toEqual(atBackup);
    expect(
      one(
        'SELECT event_name, event_location FROM Events WHERE event_id = ?',
        eventId,
      ),
    ).toEqual({
      event_name: 'Kup Jadrana',
      event_location: 'Split',
    });
    // One action: the decisions before withdrawn by it, the file's added.
    const after = actions().filter((a) => a.action_id > lastBefore);
    expect(after.map((a) => a.channel)).toEqual([
      'restoreEventSnapshotFromFile',
    ]);
    const restoreId = after[0].action_id;
    const { n: added } = one(
      'SELECT COUNT(*) AS n FROM Decisions WHERE event_id = ? AND action_id = ? AND withdrawn_by IS NULL',
      eventId,
      restoreId,
    );
    expect(added).toBe(backup.contents.log.length);
    const { n: withdrawn } = one(
      'SELECT COUNT(*) AS n FROM Decisions WHERE event_id = ? AND withdrawn_by = ?',
      eventId,
      restoreId,
    );
    expect(withdrawn).toBe(logBefore.length);
    // Nothing converted: the event's EventLogs row is as it was.
    expect(eventLogRow(eventId)).toEqual(conversion);

    // Going back to the entry before the restore brings the work back.
    await call('restoreEventToHistoryPoint', eventId, lastBefore);
    expect(loadLog(eventId)).toEqual(logBefore);
    expect(await standings(eventId)).toEqual(standingsBefore);
    expect(
      one('SELECT event_name FROM Events WHERE event_id = ?', eventId)
        .event_name,
    ).toBe('Renamed after the backup');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('imports as a new event on another computer: same standings, the log with the boats renamed', async () => {
    const original = backup.contents.log as Decision[];
    freshDb();
    // Another computer: other boats on file first, so every id differs.
    const other = Number(
      (await call('insertEvent', 'Other', 'Pula', '2026-04-01', '2026-04-02'))
        .lastInsertRowid,
    );
    for (let sail = 50; sail < 55; sail += 1) {
      // eslint-disable-next-line no-await-in-loop
      await enter(other, sail);
    }

    pickFile(backup.file);
    const imported = await call('importEventSnapshotFromFile');
    expect(imported).toMatchObject({ success: true, eventName: 'Kup Jadrana' });
    const newId = imported.eventId;

    expect(await standings(newId)).toEqual(atBackup);
    // The original log, each boat named by this computer's boat with her
    // letters and sail number.
    const fileBoats = new Map(
      backup.contents.people.Boats.map((b) => [
        String(b.boat_id),
        Number(b.sail_number),
      ]),
    );
    const names = Object.fromEntries(
      boatsNamed(original).map((id) => [
        id,
        String(boatOf(fileBoats.get(id)!)),
      ]),
    );
    expect(Object.keys(names).some((id) => names[id] !== id)).toBe(true);
    const renamed = renameBoats(original, names);
    expect(renamed.ok).toBe(true);
    expect(loadLog(newId)).toEqual(renamed.ok ? renamed.log : null);

    // Recorded as coming from a file: nothing converted, nothing to report,
    // and the start-up conversion leaves it alone.
    const record = eventLogRow(newId);
    expect(JSON.parse(record.notes)).toEqual([FROM_FILE_NOTE]);
    expect(JSON.parse(record.anomalies)).toEqual([]);
    expect(await call('readConversionReport', newId)).toBeNull();
    expect(convertEventsAtStartup()).toEqual({ converted: [], failed: [] });
    expect(actions().at(-1).channel).toBe('importEventSnapshotFromFile');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  describe('a log the library refuses', () => {
    /** The file with its first entry taken out: later decisions name her. */
    const refusedFile = () => {
      const log = backup.contents.log as Decision[];
      const first = log.findIndex((d) => d.type === 'boatEntered');
      return writeFile(`refused-${Date.now()}.json`, {
        ...backup.contents,
        log: log.filter((_, i) => i !== first),
      });
    };

    it('is not restored, and nothing changes', async () => {
      await score(eventId, 'Final Silver');
      const logBefore = loadLog(eventId);
      const before = await standings(eventId);
      const rows = decisionRows(eventId);
      const actionCount = actions().length;

      pickFile(refusedFile());
      await expect(
        call('restoreEventSnapshotFromFile', eventId),
      ).rejects.toThrow(
        /^The results in this backup file cannot be worked out, so nothing was restored: ./,
      );
      expect(loadLog(eventId)).toEqual(logBefore);
      expect(await standings(eventId)).toEqual(before);
      expect(decisionRows(eventId)).toBe(rows);
      expect(actions()).toHaveLength(actionCount);
    });

    it('is not imported, and nothing is added', async () => {
      const counts = () =>
        ['Events', 'Boats', 'Sailors', 'Decisions', 'EventLogs'].map(
          (table) => one(`SELECT COUNT(*) AS n FROM ${table}`).n,
        );
      const before = counts();
      pickFile(refusedFile());
      await expect(call('importEventSnapshotFromFile')).rejects.toThrow(
        /cannot be worked out, so nothing was imported/,
      );
      expect(counts()).toEqual(before);
    });

    it('a log that is not a list of decisions is damaged', () => {
      expect(() =>
        restoreEventSnapshot(eventId, { ...backup.contents, log: { a: 1 } }),
      ).toThrow(
        'This backup file is damaged (its results cannot be read), so nothing was restored.',
      );
    });
  });

  it('refuses a file whose boats are other boats here (same ids, another computer), changing nothing', () => {
    const boatId = Number(
      (backup.contents.people.Boats[0] as { boat_id: number }).boat_id,
    );
    mockDbHolder.current
      .prepare(
        "UPDATE Boats SET country = 'ZZZ', sail_number = '999' WHERE boat_id = ?",
      )
      .run(boatId);
    const logBefore = loadLog(eventId);
    expect(() => restoreEventSnapshot(eventId, backup.contents)).toThrow(
      /are not the boats on this computer .* use “Import from backup…”/,
    );
    expect(loadLog(eventId)).toEqual(logBefore);
  });

  it('remembers the backup files saved, with their full path, until the event is deleted', async () => {
    const second = await saveBackup(eventId, `kup-second-${Date.now()}.json`);
    const listed = await call('readBackupFiles', eventId);
    expect(listed.map((f: any) => f.filePath)).toEqual([
      second.file,
      backup.file,
    ]);
    expect(listed[0]).toMatchObject({
      fileName: path.basename(second.file),
      exists: true,
    });
    fs.unlinkSync(second.file);
    expect((await call('readBackupFiles', eventId))[0].exists).toBe(false);

    await call('deleteEvent', eventId);
    expect(await call('readBackupFiles', eventId)).toEqual([]);
  });

  it('refuses a file from a newer version of the app', async () => {
    pickFile(
      writeFile(`newer-${Date.now()}.json`, {
        ...backup.contents,
        schemaVersion: 4,
      }),
    );
    await expect(call('importEventSnapshotFromFile')).rejects.toThrow(
      /made by a newer version of the app, so nothing was imported/,
    );
  });

  describe('a version 2 file (no log) still opens from its tables', () => {
    const v2 = () => {
      const { log: _log, ...file } = backup.contents;
      return writeFile(`v2-${Date.now()}.json`, { ...file, schemaVersion: 2 });
    };

    it('restores, converting the tables to a log', async () => {
      await score(eventId, 'Final Silver');
      pickFile(v2());
      await call('restoreEventSnapshotFromFile', eventId);
      expect(await standings(eventId)).toEqual(atBackup);
      // Converted again: the log gives the same event as the file's.
      expect(types(loadLog(eventId))).toContain('finalSeriesStarted');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });

    it('imports as a new event', async () => {
      const file = v2();
      freshDb();
      pickFile(file);
      const imported = await call('importEventSnapshotFromFile');
      expect(await standings(imported.eventId)).toEqual(atBackup);
    });

    it('is what an event whose stored log no longer replays is saved as', async () => {
      // A decision the library refuses, stored by hand: the backup of a
      // broken event is when one matters, so it is written from the tables.
      db.prepare(
        `INSERT INTO Decisions (event_id, seq, body)
         SELECT event_id, MAX(seq) + 1, '{"type":"nonsense"}' FROM Decisions
         WHERE event_id = ?`,
      ).run(eventId);
      const { contents } = await saveBackup(
        eventId,
        `broken-${Date.now()}.json`,
      );
      expect(contents.schemaVersion).toBe(2);
      expect(contents).not.toHaveProperty('log');
      expect(contents.tables.Scores).toEqual(backup.contents.tables.Scores);
    });
  });
});
