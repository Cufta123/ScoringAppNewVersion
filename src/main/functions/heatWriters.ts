import { db } from '../../../public/Database/DBManager';

/** The two statements every heat builder uses; prepare once, run in loops. */
export default function prepareHeatWriters() {
  return {
    insertHeatStmt: db.prepare(
      'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
    ),
    insertHeatBoatStmt: db.prepare(
      'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
    ),
  };
}
