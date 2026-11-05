/**
 * Entering a sailor and her boat in an event: the one rule for the add form
 * (`enterSailorInEvent`) and the CSV import (`importSailors`).
 *
 * Identity, as everywhere in the app (one record per sailor and per boat):
 *  - a boat is her national letters + sail number. A boat already on file is
 *    reused, and she keeps her sailor; when the typed name is someone else,
 *    nothing is written until the user agrees to enter the boat under her
 *    registered sailor (`ownerConflict`).
 *  - a sailor is her name AND club (and birthday when both have one). Two
 *    "Ivan Horvat" of different clubs are two people; matching on the name
 *    alone gave the second one the first one's club and subgroup.
 *  - a club is its name AND country.
 *
 * The caller runs `enterSailor` inside one transaction: a refusal part-way
 * (a sail number the event already has) leaves no sailor, club or boat
 * behind. The form used to make these writes one IPC call at a time, so a
 * Cancel on the "sail already registered" question left a sailor with no boat.
 */
import { db } from '../../../public/Database/DBManager';
import { applyToEvent } from './libraryWrite';
import {
  findIndistinguishableBoats,
  type KeyedBoat,
} from '../../shared/boatKeys';
import type { EntryInput, EntryResult } from '../../shared/rows';

// What the add form sends and gets back (IPC enterSailorInEvent).
export type { EntryInput, EntryResult };

/** Categories seeded by the schema: 3 is SENIOR. */
const DEFAULT_CATEGORY_ID = 3;
/** The club of a sailor entered without one. */
const NO_CLUB = 'Unknown';

const text = (value: unknown) => String(value ?? '').trim();

/** Trimmed fields, country upper case. */
export function cleanEntry(raw: EntryInput): EntryInput {
  return {
    name: text(raw.name),
    surname: text(raw.surname),
    birthday: text(raw.birthday),
    clubName: text(raw.clubName),
    country: text(raw.country).toUpperCase(),
    sailNumber: text(raw.sailNumber),
    model: text(raw.model),
    categoryId:
      raw.categoryId == null || Number.isNaN(Number(raw.categoryId))
        ? null
        : Number(raw.categoryId),
  };
}

const sameText = (a: unknown, b: unknown) =>
  text(a).toLocaleLowerCase() === text(b).toLocaleLowerCase();

export interface RegisteredBoat {
  boat_id: number;
  sailor_id: number | null;
  name: string | null;
  surname: string | null;
}

/** The boat on file with these national letters and sail number. */
export function findBoat(
  sailNumber: unknown,
  country: string,
): RegisteredBoat | undefined {
  return db
    .prepare(
      `SELECT b.boat_id, b.sailor_id, s.name, s.surname
       FROM Boats b LEFT JOIN Sailors s ON s.sailor_id = b.sailor_id
       WHERE CAST(b.sail_number AS TEXT) = ? AND UPPER(b.country) = UPPER(?)
       ORDER BY b.boat_id
       LIMIT 1`,
    )
    .get(text(sailNumber), country) as RegisteredBoat | undefined;
}

/** Her registered sailor's name when that is not the typed one, else null. */
export function ownerConflict(
  boat: RegisteredBoat,
  entry: Pick<EntryInput, 'name' | 'surname'>,
): string | null {
  const owner = `${text(boat.name)} ${text(boat.surname)}`.trim();
  if (!owner) return null;
  return sameText(boat.name, entry.name) &&
    sameText(boat.surname, entry.surname)
    ? null
    : owner;
}

/** The club with this name in this country, created when missing. */
export function resolveClub(rawName: string, country: string): number {
  const clubName = text(rawName) || NO_CLUB;
  const existing = db
    .prepare('SELECT club_id FROM Clubs WHERE club_name = ? AND country = ?')
    .get(clubName, country) as { club_id: number } | undefined;
  if (existing) return existing.club_id;
  return Number(
    db
      .prepare('INSERT INTO Clubs (club_name, country) VALUES (?, ?)')
      .run(clubName, country).lastInsertRowid,
  );
}

/**
 * The sailor with this name in this club (and birthday, when both have one),
 * created when missing. A sailor found keeps one record; her subgroup becomes
 * the one entered now (sailors move up the age groups).
 */
export function resolveSailor(
  entry: EntryInput,
  clubId: number,
): { sailorId: number; created: boolean } {
  const candidates = db
    .prepare(
      `SELECT sailor_id, birthday, category_id FROM Sailors
       WHERE name = ? COLLATE NOCASE AND surname = ? COLLATE NOCASE
         AND club_id = ?
       ORDER BY sailor_id`,
    )
    .all(entry.name, entry.surname, clubId) as {
    sailor_id: number;
    birthday: string | null;
    category_id: number | null;
  }[];
  const birthday = text(entry.birthday);
  const match = candidates.find(
    (sailor) =>
      !birthday || !text(sailor.birthday) || text(sailor.birthday) === birthday,
  );
  if (match) {
    const categoryId = entry.categoryId ?? match.category_id;
    if (match.category_id !== categoryId || (birthday && !match.birthday)) {
      db.prepare(
        `UPDATE Sailors SET category_id = ?, birthday = COALESCE(NULLIF(birthday, ''), ?)
         WHERE sailor_id = ?`,
      ).run(categoryId, birthday, match.sailor_id);
    }
    return { sailorId: match.sailor_id, created: false };
  }
  const result = db
    .prepare(
      'INSERT INTO Sailors (name, surname, birthday, category_id, club_id) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      entry.name,
      entry.surname,
      birthday,
      entry.categoryId ?? DEFAULT_CATEGORY_ID,
      clubId,
    );
  return { sailorId: Number(result.lastInsertRowid), created: true };
}

/**
 * Refuse a boat no screen could tell apart from one already entered (the same
 * national letters and sail number). ITA 12 and CRO 12 are fine.
 */
export function refuseIndistinguishableEntry(
  boatId: number,
  eventId: number,
): void {
  const boat = db
    .prepare(
      'SELECT boat_id, sail_number, country FROM Boats WHERE boat_id = ?',
    )
    .get(boatId) as KeyedBoat | undefined;
  if (!boat) return;
  const entered = db
    .prepare(
      `SELECT b.boat_id, b.sail_number, b.country FROM Boats b
       JOIN Boat_Event be ON be.boat_id = b.boat_id
       WHERE be.event_id = ? AND b.boat_id <> ?`,
    )
    .all(eventId, boatId) as KeyedBoat[];
  const clash = findIndistinguishableBoats([...entered, boat]).find((group) =>
    group.boatIds.some((id) => String(id) === String(boatId)),
  );
  if (clash && clash.name !== '') {
    throw new Error(
      `Sail ${clash.name} is already entered in this event. Check the sail number and country.`,
    );
  }
}

const isEntered = (boatId: number, eventId: number) =>
  Boolean(
    db
      .prepare('SELECT 1 FROM Boat_Event WHERE boat_id = ? AND event_id = ?')
      .get(boatId, eventId),
  );

/**
 * Enter an existing boat in the event: a boatEntered decision (regatta-core
 * refuses an entry once the Final Series has started, parity R1). A boat
 * already entered is left as she is.
 */
export function enterBoat(boatId: number, eventId: number): void {
  if (isEntered(boatId, eventId)) return;
  refuseIndistinguishableEntry(boatId, eventId);
  const row = db
    .prepare(
      `SELECT b.country, b.sail_number,
              TRIM(COALESCE(s.name, '') || ' ' || COALESCE(s.surname, '')) AS name
       FROM Boats b LEFT JOIN Sailors s ON s.sailor_id = b.sailor_id
       WHERE b.boat_id = ?`,
    )
    .get(boatId) as
    | { country: string | null; sail_number: unknown; name: string }
    | undefined;
  if (!row) throw new Error('That boat is not in the app any more.');
  applyToEvent(eventId, {
    decide: () => [
      {
        type: 'boatEntered',
        boat: {
          id: String(boatId),
          nat: String(row.country ?? '').trim(),
          sail: String(row.sail_number ?? '').trim(),
          ...(row.name ? { name: row.name } : {}),
        },
      },
    ],
  });
}

/**
 * Enter one sailor and boat (see the module comment). `eventId` null only
 * stores her (an import with no event). Run inside a transaction.
 */
export function enterSailor(
  raw: EntryInput,
  eventId: number | null,
  { useRegisteredSailor = false }: { useRegisteredSailor?: boolean } = {},
): EntryResult {
  const entry = cleanEntry(raw);
  const boat = findBoat(entry.sailNumber, entry.country);

  if (boat) {
    const ownerName = ownerConflict(boat, entry);
    if (ownerName && !useRegisteredSailor) {
      return { status: 'ownerConflict', boatId: boat.boat_id, ownerName };
    }
    if (eventId != null && isEntered(boat.boat_id, eventId)) {
      return { status: 'alreadyEntered', boatId: boat.boat_id };
    }
    let sailorId = boat.sailor_id;
    if (!ownerName && sailorId != null) {
      // Her own boat: what was entered now (club, subgroup) is her record;
      // what was left out stays as it was.
      if (entry.clubName) {
        db.prepare('UPDATE Sailors SET club_id = ? WHERE sailor_id = ?').run(
          resolveClub(entry.clubName, entry.country),
          sailorId,
        );
      }
      if (entry.categoryId != null) {
        db.prepare(
          'UPDATE Sailors SET category_id = ? WHERE sailor_id = ?',
        ).run(entry.categoryId, sailorId);
      }
    } else if (sailorId == null) {
      const clubId = resolveClub(entry.clubName, entry.country);
      sailorId = resolveSailor(entry, clubId).sailorId;
      db.prepare('UPDATE Boats SET sailor_id = ? WHERE boat_id = ?').run(
        sailorId,
        boat.boat_id,
      );
    }
    if (eventId != null) enterBoat(boat.boat_id, eventId);
    return {
      status: 'entered',
      boatId: boat.boat_id,
      sailorId: Number(sailorId),
      createdBoat: false,
      createdSailor: false,
    };
  }

  const clubId = resolveClub(entry.clubName, entry.country);
  const sailor = resolveSailor(entry, clubId);
  const boatId = Number(
    db
      .prepare(
        'INSERT INTO Boats (sail_number, country, model, sailor_id) VALUES (?, ?, ?, ?)',
      )
      .run(entry.sailNumber, entry.country, entry.model ?? '', sailor.sailorId)
      .lastInsertRowid,
  );
  if (eventId != null) enterBoat(boatId, eventId);
  return {
    status: 'entered',
    boatId,
    sailorId: sailor.sailorId,
    createdBoat: true,
    createdSailor: sailor.created,
  };
}
