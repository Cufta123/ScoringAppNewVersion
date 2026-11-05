import { db } from '../../../public/Database/DBManager';
import { compareNationalSail } from '../../shared/sailOrder';

/**
 * Rows in SHRS's order for boats the rules leave level: national letters,
 * then sail number (3, 3.1(iv), 5.3), boat_id last. The rankings keep their
 * input order wherever no rule decides, so this is the order for shared
 * places, for a 5.7 circle that plain RRS A8 cannot settle either, and for
 * the Final split; it used to be the database's row order. regatta-core
 * does the same (decided Nov 2026, R6).
 */
export default function inNationalSailOrder<T extends { boat_id: unknown }>(
  rows: T[],
): T[] {
  if (rows.length < 2) return rows;
  const ids = [...new Set(rows.map((row) => Number(row.boat_id)))];
  const found = db
    .prepare(
      `SELECT boat_id, country, sail_number FROM Boats WHERE boat_id IN (${ids
        .map(() => '?')
        .join(', ')})`,
    )
    .all(...ids) as
    | { boat_id: number; country: string; sail_number: number }[]
    | undefined;
  // Unit tests with a hand-made database may not answer this; keep the order.
  if (!Array.isArray(found) || found.length === 0) return rows;
  const boats = new Map(found.map((boat) => [Number(boat.boat_id), boat]));
  return [...rows].sort((a, b) => {
    const x = boats.get(Number(a.boat_id));
    const y = boats.get(Number(b.boat_id));
    return (
      (x && y ? compareNationalSail(x, y) : 0) ||
      String(a.boat_id).localeCompare(String(b.boat_id), undefined, {
        numeric: true,
      })
    );
  });
}
