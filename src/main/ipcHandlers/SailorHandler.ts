import { db } from '../../../public/Database/DBManager';
import { applyToEvent } from '../functions/libraryWrite';
import { subgroupToCategoryName } from '../../shared/subgroups';
import handle from './handle';
import retryWhenBusy from '../functions/retryWhenBusy';
import type {
  ImportOwnerConflict,
  ImportSailorsSummary,
} from '../../shared/importSailors';
import {
  cleanEntry,
  enterSailor,
  findBoat,
  ownerConflict,
  type EntryInput,
  type EntryResult,
} from '../functions/sailorEntry';

handle('readAllSailors', () => {
  const rows = db
    .prepare(
      `
SELECT
s.sailor_id, s.name, s.surname, s.birthday, s.category_id, s.club_id,
b.sail_number, b.model,
c.club_name, cat.category_name
FROM Sailors s
LEFT JOIN Clubs c ON s.club_id = c.club_id
LEFT JOIN Categories cat ON s.category_id = cat.category_id
LEFT JOIN Boats b ON s.sailor_id = b.sailor_id
  `,
    )
    .all();
  return rows;
});

handle('readAllCategories', () => {
  const rows = db.prepare('SELECT * FROM Categories').all();
  return rows;
});

handle('readAllClubs', () => {
  const rows = db.prepare('SELECT * FROM Clubs').all();
  return rows;
});

handle('readAllBoats', () => {
  const rows = db
    .prepare(
      `SELECT
    b.boat_id, b.sail_number, b.country AS boat_country, b.model,
    s.name, s.surname,
    c.club_name, c.country AS club_country,
    cat.category_name
  FROM Boats b
  -- LEFT: a boat with no sailor, club or category must still be listed, or
  -- the add-sailor form (which looks here for a boat with the same sail
  -- number) would miss it and create a duplicate.
  LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
  LEFT JOIN Clubs c ON s.club_id = c.club_id
  LEFT JOIN Categories cat ON s.category_id = cat.category_id`,
    )
    .all();
  return rows;
});
/** What the sailor edit form sends (see SailorForm). */
interface SailorEdit {
  name: string;
  surname: string;
  category_name: string;
  club_name: string;
  originalClubName: string;
  boat_id: number;
  sail_number: string | number;
  country: string;
  model: string;
}

handle('updateSailor', async (event, sailorData: SailorEdit) => {
  const {
    name,
    surname,
    category_name,
    club_name,
    originalClubName,
    boat_id,
    sail_number,
    country,
    model,
  } = sailorData;

  // One transaction: a new club, the sailor row and the boat row change
  // together or not at all. A failure part-way (e.g. on the boat update)
  // used to leave the sailor renamed and a stray club created.
  const applyEdit = db.transaction(() => {
    // Resolve the sailor via the boat being edited. boat_id is unique, so this
    // can never edit the wrong "John Doe" the way a name+surname lookup could.
    const boatRow = db
      .prepare(
        'SELECT s.sailor_id, s.club_id FROM Boats b JOIN Sailors s ON s.sailor_id = b.sailor_id WHERE b.boat_id = ?',
      )
      .get(boat_id) as { sailor_id: number; club_id: number } | undefined;
    if (!boatRow) {
      throw new Error(
        'This boat no longer exists (it may have been removed in the meantime). Reload the page.',
      );
    }
    const { sailor_id } = boatRow;

    // Fetch category_id based on category_name
    const category = db
      .prepare('SELECT category_id FROM Categories WHERE category_name = ?')
      .get(category_name);
    if (!category) {
      throw new Error(
        `"${category_name}" is not a category this app knows. Pick one from the list.`,
      );
    }
    const { category_id } = category;

    // Keep the sailor's current club unless the name actually changed. When it
    // does, match an existing club by name AND country (clubs with the same
    // name can exist in different countries) before creating a new one.
    let { club_id } = boatRow;
    if (club_name !== originalClubName) {
      const existingClub = db
        .prepare(
          'SELECT club_id FROM Clubs WHERE club_name = ? AND country = ?',
        )
        .get(club_name, country) as { club_id: number } | undefined;
      if (existingClub) {
        club_id = existingClub.club_id;
      } else {
        const newClub = db
          .prepare('INSERT INTO Clubs (club_name, country) VALUES (?, ?)')
          .run(club_name, country);
        club_id = newClub.lastInsertRowid as number;
      }
    }

    // Update sailor information
    const sailorResult = db
      .prepare(
        'UPDATE Sailors SET name = ?, surname = ?, category_id = ?, club_id = ? WHERE sailor_id = ?',
      )
      .run(name, surname, category_id, club_id, sailor_id);

    // Update boat information
    const boatResult = db
      .prepare(
        'UPDATE Boats SET sail_number = ?, country = ?, model = ? WHERE boat_id = ?',
      )
      .run(sail_number, country, model, boat_id);

    // Letters, sail number and name are part of every event she is entered
    // in (they order the seeding and SHRS's ties): a boatChanged decision
    // in each, which regatta-core refuses if another entry has them.
    (
      db
        .prepare('SELECT event_id FROM Boat_Event WHERE boat_id = ?')
        .all(boat_id) as { event_id: number }[]
    ).forEach(({ event_id }) =>
      applyToEvent(Number(event_id), {
        decide: (state) => {
          const before = state.boats.find((b) => b.id === String(boat_id));
          const changed = {
            nat: String(country ?? '').trim(),
            sail: String(sail_number ?? '').trim(),
            name: `${name ?? ''} ${surname ?? ''}`.trim(),
          };
          if (
            before &&
            before.nat === changed.nat &&
            before.sail === changed.sail &&
            (before.name ?? '') === changed.name
          ) {
            return [];
          }
          return [
            {
              type: 'boatChanged',
              boat: String(boat_id),
              nat: changed.nat,
              sail: changed.sail,
              ...(changed.name ? { name: changed.name } : {}),
            },
          ];
        },
      }),
    );

    return {
      sailorChanges: sailorResult.changes,
      boatChanges: boatResult.changes,
    };
  });
  return applyEdit();
});

interface ImportRow {
  name: string;
  surname: string;
  birthday: string;
  sail_number: string | number;
  country: string;
  model: string;
  club_name: string;
  category_name: string;
  eventId?: number | string;
}

/** What to do with a row whose boat is registered to someone else. */
interface ImportOptions {
  /**
   * 'skip' (the default) leaves those rows out; 'use-registered' enters the
   * boat under her registered sailor, as the add form does once asked.
   */
  ownerConflicts?: 'skip' | 'use-registered';
}

const text = (value: unknown) => String(value ?? '').trim();

/** The subgroup of a row: a code ("M") or a full name ("VETERAN"); null if none. */
function categoryIdForRow(categoryName: unknown): number | null {
  const given = text(categoryName);
  if (!given) return null;
  const name = subgroupToCategoryName(given) || given;
  const row = db
    .prepare(
      'SELECT category_id FROM Categories WHERE UPPER(category_name) = UPPER(?)',
    )
    .get(name) as { category_id: number } | undefined;
  return row?.category_id ?? null;
}

/** A CSV row as an entry, or null when a required field is missing. */
function entryOfRow(row: ImportRow): EntryInput | null {
  // model, birthday, club and subgroup are optional, as on the add form.
  if (
    !text(row.name) ||
    !text(row.surname) ||
    !text(row.sail_number) ||
    !text(row.country)
  ) {
    return null;
  }
  return {
    name: row.name,
    surname: row.surname,
    birthday: row.birthday,
    clubName: row.club_name,
    country: row.country,
    sailNumber: row.sail_number,
    model: row.model,
    categoryId: categoryIdForRow(row.category_name),
  };
}

const eventIdOfRow = (row: ImportRow): number | null =>
  row.eventId ? Number(row.eventId) : null;

/**
 * The rows whose boat is registered to someone else, for the import's
 * preview to ask about before anything is written. Reads only.
 */
handle('previewSailorImport', (_event, rows: ImportRow[]) => {
  const conflicts: ImportOwnerConflict[] = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const entry = entryOfRow(row);
    if (!entry) return;
    const clean = cleanEntry(entry);
    const boat = findBoat(clean.sailNumber, clean.country);
    const ownerName = boat ? ownerConflict(boat, clean) : null;
    if (ownerName) {
      conflicts.push({
        line: index + 2, // the header is line 1
        sail: `${clean.country} ${clean.sailNumber}`,
        fileName: `${clean.name} ${clean.surname}`,
        ownerName,
      });
    }
  });
  return { conflicts };
});

handle(
  'importSailors',
  (
    _event,
    rows: ImportRow[],
    options: ImportOptions = {},
  ): ImportSailorsSummary => {
    let created = 0; // new boats added to DB
    let associated = 0; // existing boats newly added to this event
    let alreadyInEvent = 0; // boats that were already in this event
    let invalid = 0; // rows missing required fields
    let ownerConflicts = 0; // rows left out: the boat is someone else's
    const errors: string[] = [];
    const useRegisteredSailor = options?.ownerConflicts === 'use-registered';

    // Each row is its own (nested) transaction: when one fails part-way, the
    // sailor, club and boat it already wrote are rolled back with it, and the
    // counters only change for rows that went through. The outer transaction
    // still makes the whole import all-or-nothing against a crash.
    const importRowAtomically = db.transaction(
      (entry: EntryInput, eventId: number | null) =>
        enterSailor(entry, eventId, { useRegisteredSailor }),
    );
    const importAll = db.transaction(() => {
      rows.forEach((row) => {
        const entry = entryOfRow(row);
        if (!entry) {
          invalid += 1;
          return;
        }
        try {
          const outcome = importRowAtomically(entry, eventIdOfRow(row));
          if (outcome.status === 'ownerConflict') {
            ownerConflicts += 1;
          } else if (outcome.status === 'alreadyEntered') {
            alreadyInEvent += 1;
          } else if (outcome.createdBoat) {
            created += 1;
          } else {
            associated += 1;
          }
        } catch (err) {
          errors.push(
            `Row ${text(row.name)} ${text(row.surname)}: ${(err as Error).message}`,
          );
          invalid += 1;
        }
      });
    });

    importAll();
    return {
      created,
      associated,
      alreadyInEvent,
      invalid,
      ownerConflicts,
      errors,
      // keep legacy fields so UI doesn't break
      imported: created + associated,
      skipped: alreadyInEvent + invalid + ownerConflicts,
    };
  },
);

/**
 * The add form's one call: club, sailor, boat and entry in one transaction
 * (see functions/sailorEntry.ts). Answers `ownerConflict` without writing
 * anything when the boat is registered to someone else; the form asks and
 * calls again with `useRegisteredSailor`.
 */
handle(
  'enterSailorInEvent',
  async (
    _event,
    entry: EntryInput,
    raw_event_id,
    options: { useRegisteredSailor?: boolean } = {},
  ): Promise<EntryResult> => {
    const eventId = Number(raw_event_id);
    const exists = db
      .prepare('SELECT 1 FROM Events WHERE event_id = ?')
      .get(eventId);
    if (!exists) {
      throw new Error(
        'This event no longer exists, so the sailor was not added. Go back to the event list.',
      );
    }
    const clean = cleanEntry(entry ?? ({} as EntryInput));
    if (!clean.name || !clean.surname || !clean.sailNumber || !clean.country) {
      throw new Error(
        'The sailor was not added: first name, surname, sail number and country are needed.',
      );
    }
    // A backup copy running at that moment can hold the file for a moment.
    return retryWhenBusy(() =>
      db.transaction(() =>
        enterSailor(clean, eventId, {
          useRegisteredSailor: Boolean(options?.useRegisteredSailor),
        }),
      )(),
    );
  },
);
