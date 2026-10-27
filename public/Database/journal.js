/**
 * Change journal: an append-only record of every change to an event's data.
 *
 * SQLite triggers write one ChangeLog row per inserted, updated or deleted row
 * of the tables below, so every code path is recorded without having to know
 * about the journal. Each row keeps the whole row before and after the change
 * (`old_row` / `new_row`, JSON) and, in `context`, the labels a person needs to
 * read it (sail number, heat, race) as they were at that moment, so the entry
 * still reads correctly after the heat or boat is gone.
 *
 * The IPC layer then groups the rows written by one user action under a
 * ChangeActions row (src/main/functions/changeJournal.ts).
 *
 * The standings (Leaderboard, FinalLeaderboard) are not journalled: they are
 * rebuilt from the journalled tables.
 *
 * Deleting an event deletes its history with it.
 *
 * The triggers list each table's columns, read when they are installed. A
 * migration that adds a column to a journalled table must call
 * installJournalTriggers again, or the new column is left out of the history.
 */

const JOURNAL_TABLES = `
  CREATE TABLE IF NOT EXISTS ChangeActions (
    action_id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- Set when this action undid an earlier one (from the history).
    reverts_action_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS ChangeLog (
    change_id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id INTEGER,
    event_id INTEGER,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    table_name TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
    row_key TEXT NOT NULL,
    old_row TEXT,
    new_row TEXT,
    context TEXT,
    FOREIGN KEY (action_id) REFERENCES ChangeActions(action_id)
  );

  CREATE INDEX IF NOT EXISTS idx_changelog_event
    ON ChangeLog (event_id, change_id);
  CREATE INDEX IF NOT EXISTS idx_changelog_action
    ON ChangeLog (action_id);
`;

const sailOf = (row) =>
  `(SELECT b.country || ' ' || b.sail_number FROM Boats b WHERE b.boat_id = ${row}.boat_id)`;

/**
 * How each journalled table is keyed, which event a row belongs to, and the
 * labels stored with it. `X` stands for OLD or NEW.
 */
const JOURNALLED = [
  { table: 'Events', key: 'X.event_id', eventId: 'X.event_id' },
  {
    table: 'Boat_Event',
    key: 'X.boat_event_id',
    eventId: 'X.event_id',
    context: (x) => `'sail', ${sailOf(x)}`,
  },
  { table: 'Heats', key: 'X.heat_id', eventId: 'X.event_id' },
  {
    table: 'Heat_Boat',
    key: "X.heat_id || ':' || X.boat_id",
    eventId: '(SELECT event_id FROM Heats WHERE heat_id = X.heat_id)',
    context: (x) =>
      `'sail', ${sailOf(x)},
       'heat_name', (SELECT heat_name FROM Heats WHERE heat_id = ${x}.heat_id)`,
  },
  {
    table: 'Races',
    key: 'X.race_id',
    eventId: '(SELECT event_id FROM Heats WHERE heat_id = X.heat_id)',
    context: (x) =>
      `'heat_name', (SELECT heat_name FROM Heats WHERE heat_id = ${x}.heat_id),
       'heat_type', (SELECT heat_type FROM Heats WHERE heat_id = ${x}.heat_id)`,
  },
  {
    // SHRS 3.1.5 frozen heat-assignment places. Not shown in the history, but
    // journalled so undoing a protest decision restores them exactly.
    table: 'RaceAssignmentSnapshots',
    key: "X.race_id || ':' || X.rank",
    eventId: `(SELECT h.event_id FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
               WHERE r.race_id = X.race_id)`,
  },
  {
    table: 'Scores',
    key: 'X.score_id',
    eventId: `(SELECT h.event_id FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
               WHERE r.race_id = X.race_id)`,
    context: (x) =>
      `'sail', ${sailOf(x)},
       'heat_name', (SELECT h.heat_name FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
                     WHERE r.race_id = ${x}.race_id),
       'heat_type', (SELECT h.heat_type FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
                     WHERE r.race_id = ${x}.race_id),
       'race_number', (SELECT race_number FROM Races WHERE race_id = ${x}.race_id)`,
  },
];

const columnsOf = (db, table) =>
  db
    .prepare(`PRAGMA table_info('${table}')`)
    .all()
    .map((row) => row.name);

const rowJson = (columns, x) =>
  `json_object(${columns.map((c) => `'${c}', ${x}.${c}`).join(', ')})`;

const triggerName = (table, op) => `journal_${table}_${op}`;

function triggersFor(db, spec) {
  const columns = columnsOf(db, spec.table);
  const on = (x, expr) => expr.replace(/\bX\./g, `${x}.`);
  const context = (x) =>
    spec.context ? `json_object(${spec.context(x)})` : 'NULL';
  const insertLog = (op, x, oldRow, newRow) => `
    INSERT INTO ChangeLog (event_id, table_name, op, row_key, old_row, new_row, context)
    VALUES (${on(x, spec.eventId)}, '${spec.table}', '${op}', ${on(x, spec.key)},
            ${oldRow}, ${newRow}, ${context(x)});`;

  const changed = columns.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
  const triggers = [
    `CREATE TRIGGER ${triggerName(spec.table, 'insert')}
     AFTER INSERT ON ${spec.table} BEGIN
       ${insertLog('insert', 'NEW', 'NULL', rowJson(columns, 'NEW'))}
     END;`,
    `CREATE TRIGGER ${triggerName(spec.table, 'update')}
     AFTER UPDATE ON ${spec.table} WHEN ${changed} BEGIN
       ${insertLog('update', 'NEW', rowJson(columns, 'OLD'), rowJson(columns, 'NEW'))}
     END;`,
  ];
  if (spec.table === 'Events') {
    // Deleting an event deletes its history (everything else of the event has
    // been deleted, and journalled, just before).
    triggers.push(`CREATE TRIGGER ${triggerName(spec.table, 'delete')}
      AFTER DELETE ON Events BEGIN
        DELETE FROM ChangeLog WHERE event_id = OLD.event_id;
        DELETE FROM ChangeActions WHERE action_id NOT IN (
          SELECT action_id FROM ChangeLog WHERE action_id IS NOT NULL
        );
      END;`);
  } else {
    triggers.push(`CREATE TRIGGER ${triggerName(spec.table, 'delete')}
      AFTER DELETE ON ${spec.table} BEGIN
        ${insertLog('delete', 'OLD', rowJson(columns, 'OLD'), 'NULL')}
      END;`);
  }
  return triggers;
}

/** (Re)create the journal triggers from the tables' current columns. */
function installJournalTriggers(db) {
  JOURNALLED.forEach((spec) => {
    ['insert', 'update', 'delete'].forEach((op) =>
      db.exec(`DROP TRIGGER IF EXISTS ${triggerName(spec.table, op)};`),
    );
    triggersFor(db, spec).forEach((sql) => db.exec(sql));
  });
}

/** Create the journal tables and triggers. Safe to run again. */
function installJournal(db) {
  db.exec(JOURNAL_TABLES);
  installJournalTriggers(db);
}

module.exports = {
  JOURNALLED_TABLES: JOURNALLED.map((spec) => spec.table),
  installJournal,
  installJournalTriggers,
};
