/**
 * Turns any error into something the person at the screen can act on.
 *
 * Three kinds of failure reach the user:
 *  - refusal: the app said no on purpose and its message already explains
 *    why and what to do ("Heat B3 has not raced yet. Score the current round
 *    first."). Shown as is.
 *  - database: the database could not do it (disk full, file read-only, the
 *    file is busy in another copy of the app, a row vanished). Explained in
 *    plain words by the SQLite error code.
 *  - unexpected: a fault in the app itself. The user is told that, given a
 *    short reference to quote, and the details go to the error log.
 *
 * Pure: used by the main process (src/main/ipcHandlers/handle.ts) before an
 * error crosses to the window, and by the window for its own errors.
 */

export type ErrorKind = 'refusal' | 'database' | 'unexpected';

export interface ExplainedError {
  kind: ErrorKind;
  /** What to tell the user. */
  message: string;
  /** Reference written to the error log, for unexpected failures. */
  ref?: string;
}

/** Text that only a developer can read; never shown as a reason. */
export const TECHNICAL_TEXT: RegExp[] = [
  /SQLITE/i,
  /constraint failed/i,
  /\b(Type|Reference|Syntax|Range|Eval)Error\b/,
  /Cannot read propert/i,
  /Cannot set propert/i,
  /is not a function/i,
  /is not defined/i,
  /is not iterable/i,
  /Unexpected token/i,
  /\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/,
  /\bat \S+ \(/, // a stack frame
  /Unknown IPC error/i,
  /Operation failed: /,
  /\b(race|boat|heat|event|sailor|club)_id\b/i,
];

/** Electron wraps errors from the main process; keep only the reason. */
export function stripIpcWrapping(text: string): string {
  return text
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(\w*Error:\s*)+/, '')
    .trim();
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return '';
}

export function isTechnicalText(text: string): boolean {
  return TECHNICAL_TEXT.some((pattern) => pattern.test(text));
}

/** A short code the user can read out and find in the error log. */
export function newErrorRef(now = Date.now()): string {
  const time = now.toString(36).slice(-4);
  const random = Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .padStart(2, '0');
  return `${time}${random}`.toUpperCase();
}

const NOT_SAVED = 'This was not saved.';

/** What each table is called on screen. */
const THING: Record<string, string> = {
  Events: 'event',
  Sailors: 'sailor',
  Boats: 'boat',
  Clubs: 'club',
  Categories: 'category',
  Boat_Event: 'entry',
  Heats: 'heat',
  Heat_Boat: 'heat assignment',
  Races: 'race',
  Scores: 'result',
  Leaderboard: 'standing',
  FinalLeaderboard: 'final standing',
};

/** What a required column is called on screen. */
const FIELD: Record<string, string> = {
  'Events.event_name': 'event name',
  'Events.event_location': 'event location',
  'Events.start_date': 'start date',
  'Events.end_date': 'end date',
  'Sailors.name': 'first name',
  'Sailors.surname': 'surname',
  'Sailors.birthday': 'birthday',
  'Boats.sail_number': 'sail number',
  'Boats.country': 'country',
  'Boats.model': 'boat model',
  'Clubs.club_name': 'club name',
  'Clubs.country': 'club country',
  'Heats.heat_name': 'heat name',
  'Scores.position': 'place',
  'Scores.points': 'points',
  'Scores.status': 'result code',
};

const UNIQUE: Record<string, string> = {
  Boat_Event: 'This boat is already entered in this event.',
  Heat_Boat: 'This boat is already in that heat.',
  Scores: 'This boat already has a result in this race.',
  Clubs: 'A club with this name already exists.',
};

/** The SQLite code, from better-sqlite3 (code) or node:sqlite (errstr). */
function sqliteCode(error: unknown, text: string): string | null {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && code.startsWith('SQLITE_')) return code;
  const match = text.match(/\bSQLITE_[A-Z_]+/);
  if (match) return match[0];
  if (/UNIQUE constraint failed/i.test(text)) {
    return 'SQLITE_CONSTRAINT_UNIQUE';
  }
  if (/FOREIGN KEY constraint failed/i.test(text)) {
    return 'SQLITE_CONSTRAINT_FOREIGNKEY';
  }
  if (/NOT NULL constraint failed/i.test(text)) {
    return 'SQLITE_CONSTRAINT_NOTNULL';
  }
  if (/CHECK constraint failed/i.test(text)) return 'SQLITE_CONSTRAINT_CHECK';
  if (/database is locked/i.test(text)) return 'SQLITE_BUSY';
  if (/database or disk is full/i.test(text)) return 'SQLITE_FULL';
  if (/readonly database/i.test(text)) return 'SQLITE_READONLY';
  if (/database disk image is malformed/i.test(text)) return 'SQLITE_CORRUPT';
  if (/file is not a database/i.test(text)) return 'SQLITE_NOTADB';
  if (/disk I\/O error/i.test(text)) return 'SQLITE_IOERR';
  return null;
}

function explainDatabase(code: string, text: string): string | null {
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) {
    return `The database is busy, probably because IOM Regatta Manager is open twice. Close the other window and try again. ${NOT_SAVED}`;
  }
  if (code.startsWith('SQLITE_FULL')) {
    return `The disk is full. Free some space on this computer (for example empty the Recycle Bin), then try again. ${NOT_SAVED}`;
  }
  if (code.startsWith('SQLITE_READONLY')) {
    return `The app is not allowed to write its data file (the folder or drive is read-only). Check the drive, or restart the app. ${NOT_SAVED}`;
  }
  if (code.startsWith('SQLITE_IOERR') || code.startsWith('SQLITE_CANTOPEN')) {
    return `The computer could not read or write the data file. If the data is on a USB stick or network drive, check that it is still connected, then try again. ${NOT_SAVED}`;
  }
  if (code.startsWith('SQLITE_CORRUPT') || code.startsWith('SQLITE_NOTADB')) {
    return 'The data file is damaged. Stop entering results, close the app and restore the latest backup (Help menu > Open Backups Folder).';
  }
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return `Something this refers to no longer exists (it was removed in the meantime). Reload the page and try again. ${NOT_SAVED}`;
  }
  if (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  ) {
    const table = text.match(/failed:\s*(\w+)\./)?.[1];
    return `${(table && UNIQUE[table]) || 'This already exists.'} ${NOT_SAVED}`;
  }
  if (code === 'SQLITE_CONSTRAINT_NOTNULL') {
    const column = text.match(/failed:\s*(\w+\.\w+)/)?.[1];
    const field = column ? FIELD[column] : null;
    if (field) return `The ${field} is missing. Fill it in and try again.`;
    const table = column?.split('.')[0];
    const thing = (table && THING[table]) || 'item';
    return `A required detail of this ${thing} is missing. ${NOT_SAVED}`;
  }
  return null;
}

/**
 * What to tell the user about an error. `fallbackRef` is used for an
 * unexpected failure (tests pass a fixed one).
 */
export function explainError(
  error: unknown,
  fallbackRef: string = newErrorRef(),
): ExplainedError {
  const text = stripIpcWrapping(messageOf(error));
  const code = sqliteCode(error, text);
  if (code) {
    const message = explainDatabase(code, text);
    if (message) return { kind: 'database', message, ref: fallbackRef };
  }
  const deliberate =
    error instanceof Error
      ? Object.getPrototypeOf(error) === Error.prototype
      : typeof error === 'string';
  if (deliberate && text && text.length <= 600 && !isTechnicalText(text)) {
    return { kind: 'refusal', message: text };
  }
  return {
    kind: 'unexpected',
    message: unexpectedMessage(fallbackRef),
    ref: fallbackRef,
  };
}

export function unexpectedMessage(ref: string): string {
  return `The app ran into an unexpected problem, so this may not have been saved. Check the screen before going on. If it happens again, note the code ${ref} and send the error log (Help menu > Open Error Log).`;
}
