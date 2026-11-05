/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';

// A problem report built from a real (in-memory) database: the event's data
// with the people it uses, the history in words, the error log, the
// screenshot, and refusals for an incomplete form.

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');

const mockDbHolder: { current: any } = { current: null };
jest.mock('../main/database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

const mockHistory: { current: unknown[] } = { current: [] };
jest.mock('../main/functions/changeJournal', () => ({
  readEventHistory: () => mockHistory.current,
}));

// eslint-disable-next-line import/first, import/order
import { EVENT_LIFECYCLE_SCHEMA } from './fixtures/eventLifecycleSchema';
// eslint-disable-next-line import/first
import {
  buildProblemReport,
  newestHistoryWithin,
  readErrorLog,
} from '../main/functions/problemReport';
// eslint-disable-next-line import/first
import type { ProblemReportRequest } from '../shared/problemReport';

const decode = (content: string) =>
  Buffer.from(content, 'base64').toString('utf8');

const request = (
  overrides: Partial<ProblemReportRequest> = {},
): ProblemReportRequest => ({
  form: {
    kind: 'wrong-results',
    area: 'leaderboard',
    happenedAt: '2026-11-04T14:30',
    problem: '  CRO 12 has the wrong points in Q3.  ',
    doing: 'Saved a DSQ',
    expected: '',
    reporterName: 'Race office',
    reporterContact: '',
  },
  includes: { snapshot: true, history: true, errorLog: true, screenshot: true },
  context: {
    route: '#/event/Kup/leaderboard',
    eventId: 1,
    windowSize: '1366x705',
  },
  screenshot: 'data:image/jpeg;base64,/9j/AAAA',
  ...overrides,
});

describe('buildProblemReport', () => {
  let db: any;
  let logDir: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(EVENT_LIFECYCLE_SCHEMA);
    db.exec(`
      ALTER TABLE Events ADD COLUMN export_logo TEXT;
      ALTER TABLE Sailors ADD COLUMN club_id INTEGER;
      CREATE TABLE Clubs (club_id INTEGER PRIMARY KEY, club_name TEXT, country TEXT);
      CREATE TABLE Categories (category_id INTEGER PRIMARY KEY, category_name TEXT);
      INSERT INTO Categories VALUES (3, 'SENIOR');
      INSERT INTO Clubs VALUES (1, 'JK Split', 'CRO'), (2, 'Other club', 'ITA');
      INSERT INTO Events (event_id, event_name, export_logo)
        VALUES (1, 'Kup', 'data:image/png;base64,AAAA'), (2, 'Other', NULL);
      INSERT INTO Sailors (sailor_id, name, surname, club_id)
        VALUES (1, 'Ana', 'A', 1), (2, 'Bor', 'B', 2);
      INSERT INTO Boats (boat_id, sail_number, country, model, sailor_id)
        VALUES (1, 12, 'CRO', 'IOM', 1), (2, 7, 'ITA', 'IOM', 2);
      INSERT INTO Boat_Event (boat_id, event_id) VALUES (1, 1), (2, 2);
    `);
    mockDbHolder.current = db;
    mockHistory.current = [
      {
        action_id: 3,
        channel: 'submitHeatRaceScoresAtomic',
        at: '2026-11-04T13:00:00.000Z',
        changes: [],
      },
    ];
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-log-'));
    fs.writeFileSync(path.join(logDir, 'errors.log'), 'ref ABC123 | boom\n');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  const build = (req = request()) =>
    buildProblemReport(req, {
      reportId: 'R-AAAAA001',
      createdAt: new Date('2026-11-04T13:31:00Z'),
      system: { appVersion: '1.2.3', os: 'Windows_NT 10' },
      errorLogDir: logDir,
    });

  it('carries the cleaned form, the event name and every attachment', () => {
    const report = build();
    expect(report.form.problem).toBe('CRO 12 has the wrong points in Q3.');
    expect(report.form.kindLabel).toMatch(/Wrong results/);
    expect(report.context.eventName).toBe('Kup');
    expect(report.attachments.map((a) => a.filename)).toEqual([
      'event-snapshot.json',
      'history.txt',
      'history.json',
      'errors.log',
      'screenshot.jpg',
    ]);
    expect(report.system).toEqual({ appVersion: '1.2.3', os: 'Windows_NT 10' });
    expect(report.notes).toEqual([]);
  });

  it("includes only this event's boats, sailors and clubs, and not the logo", () => {
    const snapshot = JSON.parse(decode(build().attachments[0].content));
    expect(snapshot.people.Boats.map((b: any) => b.boat_id)).toEqual([1]);
    expect(snapshot.people.Sailors.map((s: any) => s.name)).toEqual(['Ana']);
    expect(snapshot.people.Clubs.map((c: any) => c.club_name)).toEqual([
      'JK Split',
    ]);
    expect(snapshot.tables.Events[0].export_logo).toBe('[logo left out]');
  });

  it('words the history as the History window does', () => {
    const history = build().attachments.find(
      (a) => a.filename === 'history.txt',
    );
    expect(decode(history!.content)).toContain('2026-11-04T13:00:00.000Z');
  });

  it('leaves out what was switched off, and the computer with the picture', () => {
    const report = build(
      request({
        includes: {
          snapshot: false,
          history: false,
          errorLog: false,
          screenshot: false,
        },
      }),
    );
    expect(report.attachments).toEqual([]);
    expect(report.system).toEqual({ appVersion: '1.2.3' });
  });

  it('has no event data when no event was open', () => {
    const report = build(
      request({ context: { route: '#/', eventId: null, windowSize: '' } }),
    );
    expect(report.included.snapshot).toBe(false);
    expect(report.attachments.map((a) => a.filename)).toEqual([
      'errors.log',
      'screenshot.jpg',
    ]);
  });

  it('notes a screenshot that is not a picture instead of sending it', () => {
    const report = build(request({ screenshot: 'data:text/html;base64,PGI+' }));
    expect(report.attachments.map((a) => a.filename)).not.toContain(
      'screenshot.jpg',
    );
    expect(report.notes).toContain('No screenshot could be taken.');
  });

  it('still sends the words when an attachment cannot be read', () => {
    db.exec('DROP TABLE Heat_Boat');
    const report = build();
    expect(report.notes.join(' ')).toMatch(/event data could not be added/);
    expect(report.form.problem).toMatch(/CRO 12/);
  });

  it('refuses an incomplete form in words', () => {
    expect(() =>
      build(request({ form: { ...request().form, problem: 'bad' } })),
    ).toThrow(/The report was not sent: Describe what went wrong/);
  });
});

describe('report size limits', () => {
  it('keeps the newest history entries that fit', () => {
    const actions = [1, 2, 3].map((id) => ({
      action_id: id,
      channel: 'x',
      at: '',
      changes: [],
    }));
    const one = JSON.stringify(actions[0]).length;
    const { actions: kept, leftOut } = newestHistoryWithin(actions, one * 2);
    expect(kept.map((a) => a.action_id)).toEqual([1, 2]);
    expect(leftOut).toBe(1);
  });

  it('reads the newest end of a long error log, previous file first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-log-'));
    fs.writeFileSync(path.join(dir, 'errors.1.log'), 'old entry\n');
    fs.writeFileSync(path.join(dir, 'errors.log'), 'new entry\n');
    expect(readErrorLog(dir)).toBe('old entry\n\nnew entry\n');
    expect(readErrorLog(null)).toBe('');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
