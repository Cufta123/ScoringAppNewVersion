/** @jest-environment node */
import {
  explainError,
  isTechnicalText,
  stripIpcWrapping,
} from '../shared/errors/explainError';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

/** An error shaped like better-sqlite3's SqliteError. */
class SqliteError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'SqliteError';
  }
}

describe('explainError: every failure in words the user can act on', () => {
  it('passes the app’s own refusals through unchanged', () => {
    const refusal = new Error(
      'Heat B3 has not raced yet. Score the current round before creating the next one.',
    );
    expect(explainError(refusal)).toEqual({
      kind: 'refusal',
      message: refusal.message,
    });
  });

  it.each([
    ['SQLITE_BUSY', 'database is locked', /open twice/],
    ['SQLITE_FULL', 'database or disk is full', /disk is full/],
    ['SQLITE_READONLY', 'attempt to write a readonly database', /read-only/],
    ['SQLITE_IOERR_WRITE', 'disk I/O error', /USB stick/],
    [
      'SQLITE_CORRUPT',
      'database disk image is malformed',
      /restore the latest backup/,
    ],
    ['SQLITE_NOTADB', 'file is not a database', /damaged/],
    [
      'SQLITE_CONSTRAINT_FOREIGNKEY',
      'FOREIGN KEY constraint failed',
      /no longer exists.*Reload the page/,
    ],
    [
      'SQLITE_CONSTRAINT_UNIQUE',
      'UNIQUE constraint failed: Boat_Event.boat_id, Boat_Event.event_id',
      /already entered in this event/,
    ],
    [
      'SQLITE_CONSTRAINT_NOTNULL',
      'NOT NULL constraint failed: Boats.sail_number',
      /The sail number is missing/,
    ],
  ])('explains %s', (code, message, expected) => {
    const explained = explainError(new SqliteError(message, code), 'REF1');
    expect(explained.kind).toBe('database');
    expect(explained.message).toMatch(expected);
    expect(isTechnicalText(explained.message)).toBe(false);
  });

  it('recognises the real database’s errors, not just their codes', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`CREATE TABLE Boats (boat_id INTEGER PRIMARY KEY,
                                 sail_number INTEGER NOT NULL);
             CREATE TABLE Scores (score_id INTEGER PRIMARY KEY,
                                  boat_id INTEGER REFERENCES Boats(boat_id));`);
    const failure = (sql: string) => {
      try {
        db.exec(sql);
      } catch (error) {
        return error;
      }
      throw new Error(`expected "${sql}" to fail`);
    };
    expect(
      explainError(failure('INSERT INTO Boats (sail_number) VALUES (NULL)'))
        .message,
    ).toMatch(/The sail number is missing/);
    expect(
      explainError(failure('INSERT INTO Scores (boat_id) VALUES (99)')).message,
    ).toMatch(/no longer exists/);
    db.close();
  });

  it.each([
    new TypeError("Cannot read properties of undefined (reading 'heat_id')"),
    new RangeError('Invalid array length'),
    new Error('Current result not found for race_id: 4, boat_id: 9'),
    new Error('Position must be a positive integer (received null).'),
    { weird: true },
    undefined,
  ])('calls a fault in the app unexpected, with a reference: %p', (error) => {
    const explained = explainError(error, 'K3F9QZ');
    expect(explained.kind).toBe('unexpected');
    expect(explained.ref).toBe('K3F9QZ');
    expect(explained.message).toContain('K3F9QZ');
    expect(explained.message).toMatch(/Open Error Log/);
    expect(isTechnicalText(explained.message)).toBe(false);
  });

  it('reads the reason out of Electron’s wrapping', () => {
    expect(
      stripIpcWrapping(
        "Error invoking remote method 'deleteEvent': Error: Event is locked.",
      ),
    ).toBe('Event is locked.');
    expect(
      explainError(
        new Error(
          "Error invoking remote method 'x': Error: The disk is full. Free some space on this computer.",
        ),
      ).kind,
    ).toBe('refusal');
  });
});
