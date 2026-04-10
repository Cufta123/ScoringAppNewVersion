/* eslint-disable camelcase */
import { ipcMain } from 'electron';
import { db } from '../../../public/Database/DBManager';

interface SqliteError extends Error {
  code: string;
}

const log = (message: string) => {
  console.log(message);
};

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pongSailor'));
});

ipcMain.handle('readAllSailors', () => {
  try {
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
  } catch (error) {
    log(`Error reading sailors: ${error}`);
    throw error;
  }
});

ipcMain.handle('insertClub', async (event, club_name, country) => {
  try {
    const result = db
      .prepare('INSERT INTO Clubs (club_name, country) VALUES (?, ?)')
      .run(club_name, country);
    return { lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    log(`Error inserting club: ${error}`);
    throw error;
  }
});

ipcMain.handle(
  'insertBoat',
  async (event, sail_number, country, model, sailor_id) => {
    try {
      const result = db
        .prepare(
          'INSERT INTO Boats (sail_number, country, model, sailor_id) VALUES (?, ?, ?, ?)',
        )
        .run(sail_number, country, model, sailor_id);
      return { lastInsertRowid: result.lastInsertRowid };
    } catch (error) {
      console.error(`Error inserting boat: ${error}`);
      throw error;
    }
  },
);

ipcMain.handle('readAllCategories', () => {
  try {
    const rows = db.prepare('SELECT * FROM Categories').all();
    return rows;
  } catch (error) {
    log(`Error reading categories: ${error}`);
    throw error;
  }
});

ipcMain.handle('readAllClubs', () => {
  try {
    const rows = db.prepare('SELECT * FROM Clubs').all();
    return rows;
  } catch (error) {
    log(`Error reading clubs: ${error}`);
    throw error;
  }
});

ipcMain.handle('readAllBoats', () => {
  try {
    const rows = db
      .prepare(
        `SELECT
      b.boat_id, b.sail_number, b.country AS boat_country, b.model,
      s.name, s.surname,
      c.club_name, c.country AS club_country,
      cat.category_name
    FROM Boats b
    JOIN Sailors s ON b.sailor_id = s.sailor_id
    JOIN Clubs c ON s.club_id = c.club_id
    JOIN Categories cat ON s.category_id = cat.category_id`,
      )
      .all();
    return rows;
  } catch (error) {
    log(`Error reading boats: ${error}`);
    throw error;
  }
});
ipcMain.handle('updateSailor', async (event, sailorData) => {
  const {
    originalName,
    originalSurname,
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

  console.log('Received sailorData:', sailorData); // Log the received data

  try {
    // Fetch sailor_id based on original name and surname
    const sailor = db
      .prepare('SELECT sailor_id FROM Sailors WHERE name = ? AND surname = ?')
      .get(originalName, originalSurname);
    if (!sailor)
      throw new Error(`Sailor not found: ${originalName} ${originalSurname}`);
    const { sailor_id } = sailor;

    // Fetch category_id based on category_name
    const category = db
      .prepare('SELECT category_id FROM Categories WHERE category_name = ?')
      .get(category_name);
    if (!category) throw new Error(`Category not found: ${category_name}`);
    const { category_id } = category;

    // Fetch club_id based on original club name
    let club = db
      .prepare('SELECT club_id FROM Clubs WHERE club_name = ?')
      .get(originalClubName);
    if (!club) throw new Error(`Club not found: ${originalClubName}`);
    let { club_id } = club;

    if (club_name !== originalClubName) {
      club = db
        .prepare('SELECT club_id FROM Clubs WHERE club_name = ?')
        .get(club_name);
      if (club) {
        club_id = club.club_id;
      } else {
        // Insert new club and get the new club_id
        const newClub = db
          .prepare('INSERT INTO Clubs (club_name, country) VALUES (?, ?)')
          .run(club_name, country);
        club_id = newClub.lastInsertRowid;
      }
    }

    // Update sailor information
    const sailorResult = db
      .prepare(
        'UPDATE Sailors SET name = ?, surname = ?, category_id = ?, club_id = ? WHERE sailor_id = ?',
      )
      .run(name, surname, category_id, club_id, sailor_id);
    console.log('Sailor update result:', sailorResult);

    // Update boat information
    const boatResult = db
      .prepare(
        'UPDATE Boats SET sail_number = ?, country = ?, model = ? WHERE boat_id = ?',
      )
      .run(sail_number, country, model, boat_id);
    console.log('Boat update result:', boatResult);

    return {
      sailorChanges: sailorResult.changes,
      boatChanges: boatResult.changes,
    };
  } catch (error) {
    log(`Error updating sailor or boat: ${error}`);
    throw error;
  }
});

ipcMain.handle(
  'insertSailor',
  async (event, name, surname, birthday, category_id, club_id) => {
    const maxRetries = 5;
    const delay = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    const insertSailorWithRetry = async (
      attempt: number,
    ): Promise<{ lastInsertRowid: number }> => {
      try {
        // Log the received parameters
        log(
          `Inserting sailor with parameters: ${name}, ${surname}, ${birthday}, ${category_id}, ${club_id}`,
        );

        const result = db
          .prepare(
            'INSERT INTO Sailors (name, surname, birthday, category_id, club_id) VALUES (?, ?, ?, ?, ?)',
          )
          .run(name, surname, birthday, category_id, club_id);
        return { lastInsertRowid: result.lastInsertRowid };
      } catch (error) {
        const sqliteError = error as SqliteError;
        if (sqliteError.code === 'SQLITE_BUSY' && attempt < maxRetries) {
          log(`Database is locked, retrying attempt ${attempt}...`);
          await delay(100 * attempt); // Exponential backoff
          return insertSailorWithRetry(attempt + 1);
        }
        log(`Error inserting sailor: ${error}`);
        throw error;
      }
    };

    return insertSailorWithRetry(1);
  },
);

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

ipcMain.handle('importSailors', (_event, rows: ImportRow[]) => {
  let created = 0;       // new boats added to DB
  let associated = 0;    // existing boats newly added to this event
  let alreadyInEvent = 0; // boats that were already in this event
  let invalid = 0;       // rows missing required fields
  const errors: string[] = [];

  const importAll = db.transaction(() => {
    for (const row of rows) {
      try {
        const { name, surname, birthday, sail_number, country, model, club_name, category_name, eventId } = row;

        if (!name || !surname || !sail_number || !country || !model) {
          invalid += 1;
          continue;
        }

        // Resolve category
        const catRow = db
          .prepare('SELECT category_id FROM Categories WHERE UPPER(category_name) = UPPER(?)')
          .get(category_name || 'SENIOR') as { category_id: number } | undefined;
        const category_id = catRow?.category_id ?? 3; // default SENIOR

        // Upsert club
        let club_id: number;
        const existingClub = db
          .prepare('SELECT club_id FROM Clubs WHERE club_name = ?')
          .get(club_name) as { club_id: number } | undefined;
        if (existingClub) {
          club_id = existingClub.club_id;
        } else {
          const clubResult = db
            .prepare('INSERT INTO Clubs (club_name, country) VALUES (?, ?)')
            .run(club_name || 'Unknown', country);
          club_id = clubResult.lastInsertRowid as number;
        }

        // Upsert sailor
        let sailor_id: number;
        const existingSailor = db
          .prepare('SELECT sailor_id FROM Sailors WHERE name = ? AND surname = ? AND birthday = ?')
          .get(name, surname, birthday) as { sailor_id: number } | undefined;
        if (existingSailor) {
          sailor_id = existingSailor.sailor_id;
        } else {
          const sailorResult = db
            .prepare('INSERT INTO Sailors (name, surname, birthday, category_id, club_id) VALUES (?, ?, ?, ?, ?)')
            .run(name, surname, birthday || '', category_id, club_id);
          sailor_id = sailorResult.lastInsertRowid as number;
        }

        // Upsert boat
        let boat_id: number;
        const existingBoat = db
          .prepare(
            'SELECT boat_id FROM Boats WHERE CAST(sail_number AS TEXT) = ? AND UPPER(country) = UPPER(?)',
          )
          .get(String(sail_number), country) as { boat_id: number } | undefined;
        if (existingBoat) {
          boat_id = existingBoat.boat_id;
        } else {
          const boatResult = db
            .prepare('INSERT INTO Boats (sail_number, country, model, sailor_id) VALUES (?, ?, ?, ?)')
            .run(String(sail_number), country, model, sailor_id);
          boat_id = boatResult.lastInsertRowid as number;
          created += 1;
        }

        // Associate boat with event if event_id provided
        if (eventId) {
          const event_id = Number(eventId);
          const inEvent = db
            .prepare('SELECT boat_event_id FROM Boat_Event WHERE boat_id = ? AND event_id = ?')
            .get(boat_id, event_id) as { boat_event_id: number } | undefined;
          if (!inEvent) {
            db.prepare('INSERT INTO Boat_Event (boat_id, event_id) VALUES (?, ?)')
              .run(boat_id, event_id);
            if (!existingBoat) {
              // already counted under created
            } else {
              associated += 1;
            }
          } else {
            alreadyInEvent += 1;
          }
        }
      } catch (err) {
        errors.push(`Row ${row.name} ${row.surname}: ${(err as Error).message}`);
        invalid += 1;
      }
    }
  });

  importAll();
  return { created, associated, alreadyInEvent, invalid, errors,
    // keep legacy fields so UI doesn't break
    imported: created + associated,
    skipped: alreadyInEvent + invalid,
  };
});
