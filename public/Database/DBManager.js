const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');
// Define the directory and filename for the database
const dataDir = path.join(__dirname, '..', '..', 'public', 'Database', 'data');
const dbFilename = 'scoring_app.db';
const dbPath = path.join(dataDir, dbFilename);

console.log(`Database directory: ${dataDir}`);
console.log(`Database path: ${dbPath}`);

// Ensure the data directory exists
if (!fs.existsSync(dataDir)) {
  console.log(`Data directory does not exist. Creating ${dataDir}`);
  fs.mkdirSync(dataDir, { recursive: true });
} else {
  console.log(`Data directory already exists: ${dataDir}`);
}

// Initialize the database
console.log('Initializing database...');
const db = new Database(dbPath); // Creates the database file when used
db.pragma('journal_mode = WAL');
console.log('Database initialized.');

// Function to initialize the database schema
const initializeSchema = () => {
  console.log('Initializing database schema...');

  const createEventsTable = `
    CREATE TABLE IF NOT EXISTS Events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      event_location TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_locked INTEGER DEFAULT 0
    );
  `;

  const createSailorsTable = `
    CREATE TABLE IF NOT EXISTS Sailors (
      sailor_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      surname TEXT NOT NULL,
      birthday TEXT NOT NULL,
      category_id INTEGER,
      club_id INTEGER,
      FOREIGN KEY (category_id) REFERENCES Categories(category_id),
      FOREIGN KEY (club_id) REFERENCES Clubs(club_id)
    );
  `;

  const createBoatsTable = `
    CREATE TABLE IF NOT EXISTS Boats (
      boat_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sail_number INTEGER NOT NULL UNIQUE,
      country TEXT NOT NULL,
      model TEXT NOT NULL,
      sailor_id INTEGER,
      FOREIGN KEY (sailor_id) REFERENCES Sailors(sailor_id)
    );
  `;

  const createClubsTable = `
    CREATE TABLE IF NOT EXISTS Clubs (
      club_id INTEGER PRIMARY KEY AUTOINCREMENT,
      club_name TEXT NOT NULL,
      country TEXT NOT NULL
    );
  `;

  const createCategoriesTable = `
  CREATE TABLE IF NOT EXISTS Categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL
  );
  INSERT INTO Categories (category_id, category_name) VALUES (1, 'KADET')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (2, 'JUNIOR')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (3, 'SENIOR')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (4, 'JUNIOR')
  ON CONFLICT(category_id) DO NOTHING;
  INSERT INTO Categories (category_id, category_name) VALUES (5, 'MASTER')
  ON CONFLICT(category_id) DO NOTHING;
`;

  const createBoatEventTable = `
    CREATE TABLE IF NOT EXISTS Boat_Event (
      boat_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER,
      event_id INTEGER,
      FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
      FOREIGN KEY (event_id) REFERENCES Events(event_id)
    );
    `;

  const createHeatsTable = `
  CREATE TABLE IF NOT EXISTS Heats (
    heat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    heat_name TEXT NOT NULL,
    heat_type TEXT NOT NULL, -- 'Qualifying' or 'Final'
    FOREIGN KEY (event_id) REFERENCES Events(event_id)
  );
`;

  const createRacesTable = `
  CREATE TABLE IF NOT EXISTS Races (
    race_id INTEGER PRIMARY KEY AUTOINCREMENT,
    heat_id INTEGER NOT NULL,
    race_number INTEGER NOT NULL,
    FOREIGN KEY (heat_id) REFERENCES Heats(heat_id)
  );
`;

  const createScoresTable = `
  CREATE TABLE IF NOT EXISTS Scores (
    score_id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id INTEGER NOT NULL,
    boat_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    points INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'DNF', 'RET', 'NSC', 'OCS', 'DNS', 'DNC', 'WTH', 'UFD', 'BFD', 'DSQ', 'DNE'
    FOREIGN KEY (race_id) REFERENCES Races(race_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );
`;
  const createHeatBoatTable = `
  CREATE TABLE IF NOT EXISTS Heat_Boat (
    heat_id INTEGER,
    boat_id INTEGER,
    FOREIGN KEY (heat_id) REFERENCES Heats(heat_id),
    FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
  );
`;

  const createLiderboardTable = `
  CREATE TABLE IF NOT EXISTS Leaderboard (
  boat_id INTEGER,
  total_points_event INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  place INTEGER,
  PRIMARY KEY (boat_id, event_id),
  FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
  FOREIGN KEY (event_id) REFERENCES Events(event_id)
);
`;

  const createGlobalLeaderboardTable = `
  CREATE TABLE IF NOT EXISTS GlobalLeaderboard (
  boat_id INTEGER PRIMARY KEY,
  total_points_global INTEGER NOT NULL,
  FOREIGN KEY (boat_id) REFERENCES Boats(boat_id)
);
`;

  const createFinalLeaderboardTable = `
  CREATE TABLE IF NOT EXISTS FinalLeaderboard (
  boat_id INTEGER,
  total_points_final INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  placement_group TEXT NOT NULL,
  place INTEGER,
  PRIMARY KEY (boat_id, event_id),
  FOREIGN KEY (boat_id) REFERENCES Boats(boat_id),
  FOREIGN KEY (event_id) REFERENCES Events(event_id)
);
`;

  try {
    console.log('Creating Events table...');
    db.exec(createEventsTable);
    console.log('Events table created or already exists.');

    console.log('Creating Sailors table...');
    db.exec(createSailorsTable);
    console.log('Sailors table created or already exists.');

    console.log('Creating Boats table...');
    db.exec(createBoatsTable);
    console.log('Boats table created or already exists.');

    console.log('Creating Clubs table...');
    db.exec(createClubsTable);
    console.log('Clubs table created or already exists.');

    console.log('Creating Categories table...');
    db.exec(createCategoriesTable);
    console.log('Categories table created or already exists.');

    console.log('Creating Boat_Event table...');
    db.exec(createBoatEventTable);
    console.log('Boat_Event table created or already exists.');

    console.log('Creating Heats table...');
    db.exec(createHeatsTable);
    console.log('Heats table created or already exists.');

    console.log('Creating Races table...');
    db.exec(createRacesTable);
    console.log('Races table created or already exists.');

    console.log('Creating Scores table...');
    db.exec(createScoresTable);
    console.log('Scores table created or already exists.');

    console.log('Creating Heat_Boat table...');
    db.exec(createHeatBoatTable);
    console.log('Heat_Boat table created or already exists.');

    console.log('Creating Leaderboard table...');
    db.exec(createLiderboardTable);
    console.log('Leaderboard table created or already exists.');

    console.log('Creating GlobalLeaderboard table...');
    db.exec(createGlobalLeaderboardTable);
    console.log('GlobalLeaderboard table created or already exists.');

    console.log('Creating FinalLeaderboard table...');
    db.exec(createFinalLeaderboardTable);
    console.log('FinalLeaderboard table created or already exists.');

    console.log('Database schema initialized successfully.');
  } catch (error) {
    console.error('Error initializing database schema:', error);
  }
};

// Function to check if the Events table exists
const checkEventsTable = () => {
  try {
    const stmt = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='Events';",
    );
    const result = stmt.get();
    if (result) {
      console.log('Events table exists.');
    } else {
      console.log('Events table does not exist.');
    }
  } catch (error) {
    console.error('Error checking Events table:', error);
  }
};

// Initialize the database schema
initializeSchema();

// Check if the Events table exists
checkEventsTable();

module.exports = { db };
