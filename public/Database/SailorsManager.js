/* eslint-disable no-console */
/* eslint-disable camelcase */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath =
  process.env.NODE_ENV === 'development'
    ? './data/scoring_app.db'
    : path.join(process.resourcesPath, './data/scoring_app.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const readAllSailors = () => {
  try {
    const query = `
      SELECT
        s.sailor_id, s.name, s.surname, s.birthday, s.category_id, s.club_id,
        b.sail_number, b.model,
        c.club_name, cat.category_name
      FROM Sailors s
      LEFT JOIN Clubs c ON s.club_id = c.club_id
      LEFT JOIN Categories cat ON s.category_id = cat.category_id
      LEFT JOIN Boats b ON s.sailor_id = b.sailor_id
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all();
    console.log('Raw results from readAllSailors:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading all sailors from the database:', err.message);
    return [];
  }
};
const readAllBoats = () => {
  try {
    const query = `
    SELECT
      b.boat_id, b.sail_number, b.country, b.model, b.sailor_id,
      s.name, s.surname, s.club_id, c.club_name
    FROM Boats b
    LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
    LEFT JOIN Clubs c ON s.club_id = c.club_id
  `;
    const readQuery = db.prepare(query);
    const results = readQuery.all();
    console.log('Raw results from readAllBoats:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading all boats from the database:', err.message);
    return [];
  }
};

const insertClub = (club_name, country) => {
  try {
    // Check if the club already exists
    const existingClub = db
      .prepare('SELECT club_id FROM Clubs WHERE club_name = ?')
      .get(club_name);
    if (existingClub) {
      return { lastInsertRowid: existingClub.club_id };
    }

    const insertQuery = db.prepare(
      `INSERT INTO Clubs (club_name, country)
       VALUES (?, ?)`,
    );
    const info = insertQuery.run(club_name, country);
    console.log(
      `Inserted ${info.changes} row(s) with last ID ${info.lastInsertRowid} into Clubs.`,
    );
    return { lastInsertRowid: info.lastInsertRowid };
  } catch (err) {
    console.error('Error inserting club into the database:', err.message);
    throw err;
  }
};

const insertBoat = (sail_number, country, model, sailor_id) => {
  if (!sail_number || !model || !sailor_id) {
    throw new Error('Sail number, model, and sailor_id are required.');
  }

  try {
    const insertQuery = db.prepare(
      `INSERT INTO Boats (sail_number, country, model, sailor_id)
       VALUES (?, ?, ?, ?)`,
    );

    const info = insertQuery.run(sail_number, country, model, sailor_id);
    console.log(
      `Inserted ${info.changes} row(s) with last ID ${info.lastInsertRowid} into Boats.`,
    );
    return { lastInsertRowid: info.lastInsertRowid };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      console.error('Error: The sail number already exists.');
    } else {
      console.error('Error inserting boat into the database:', err.message);
    }
    throw err;
  }
};

module.exports = {
  readAllSailors,
  insertClub,
  insertBoat,
  readAllBoats,
};
