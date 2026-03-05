/* eslint-disable prettier/prettier */
/* eslint-disable camelcase */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath =
  process.env.NODE_ENV === 'development'
    ? './data/scoring_app.db'
    : path.join(process.resourcesPath, './data/scoring_app.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');



const readAllEvents = () => {
  try {
    const query = `
      SELECT
        event_id, event_name, event_location, start_date, end_date
      FROM Events
    `;
    const readQuery = db.prepare(query);
    const results = readQuery.all();
    console.log('Raw results from readAllEvents:', results); // Log the raw results
    return results;
  } catch (err) {
    console.error('Error reading all events from the database:', err.message);
    return [];
  }
};

const insertEvent = (event_name, event_location, start_date, end_date) => {
  try {
    const insertQuery = db.prepare(
      `INSERT INTO Events (event_name, event_location, start_date, end_date)
       VALUES (?, ?, ?)`,
    );
    const info = insertQuery.run(event_name, event_location, start_date, end_date);
    console.log(
      `Inserted ${info.changes} row(s) with last ID ${info.lastInsertRowid} into Events.`,
    );
    return { lastInsertRowid: info.lastInsertRowid };
  } catch (err) {
    console.error('Error inserting event into the database:', err.message);
    throw err;
  }
};

const lockEvent = (event_id) => {
  try {
    const query = `UPDATE Events SET is_locked = 1 WHERE event_id = ?`;
    const updateQuery = db.prepare(query);
    updateQuery.run(event_id);
    console.log(`Event ${event_id} locked.`);
    return { success: true };
  } catch (error) {
    console.error('Error locking event:', error);
    throw error;
  }
};

const unlockEvent = (event_id) => {
  try {
    const query = `UPDATE Events SET is_locked = 0 WHERE event_id = ?`;
    const updateQuery = db.prepare(query);
    updateQuery.run(event_id);
    console.log(`Event ${event_id} unlocked.`);
    return { success: true };
  } catch (error) {
    console.error('Error unlocking event:', error);
    throw error;
  }
};

module.exports = {
  readAllEvents,
  insertEvent,
  lockEvent,
};
