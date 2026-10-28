/**
 * Ordering boats for the next qualifying round (SHRS 3.1). Reads a race's
 * results and returns them in recording order (5.3), which is what the heat
 * movement tables consume.
 */
import { db } from '../../../public/Database/DBManager';
import { compareSeededRows, normalizeStatus } from './scoreStatus';

export function getLatestRaceRowsForHeats(
  latestHeats: { heat_name: string; heat_id: number }[],
) {
  const latestRaceByHeatQuery = db.prepare(
    `SELECT race_id, race_number
     FROM Races
     WHERE heat_id = ?
     ORDER BY race_number DESC, race_id DESC
     LIMIT 1`,
  );

  const raceRows = latestHeats.map((heat) => {
    const raceRow = latestRaceByHeatQuery.get(heat.heat_id);
    if (!raceRow) {
      throw new Error(
        `${heat.heat_name} has not raced yet. Score the current round before creating the next one.`,
      );
    }
    return { ...raceRow, heat_id: heat.heat_id, heat_name: heat.heat_name };
  });

  const raceNumbers = [...new Set(raceRows.map((row) => row.race_number))];
  if (raceNumbers.length > 1) {
    throw new Error(
      'Latest qualifying heats are not aligned on the same race number.',
    );
  }

  return raceRows;
}

export function getRankedBoatsInHeatForRace(heat_id: number, race_id: number) {
  const rowsByRaceQuery = db.prepare(
    `SELECT
      hb.boat_id,
      sc.position,
      sc.status,
      b.country,
      b.sail_number
     FROM Heat_Boat hb
     JOIN Boats b ON b.boat_id = hb.boat_id
     LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id
     WHERE hb.heat_id = ?`,
  );

  const rows: {
    boat_id: string;
    position: number | null;
    status: string;
    country: string | null;
    sail_number: string | number | null;
  }[] = rowsByRaceQuery
    .all(race_id, heat_id)
    .map(
      (row: {
        boat_id: string;
        position: number | null;
        status: string | null;
        country: string | null;
        sail_number: string | number | null;
      }) => ({
        boat_id: row.boat_id,
        position: row.position,
        status:
          normalizeStatus(row.status) || (row.position == null ? 'DNS' : ''),
        country: row.country,
        sail_number: row.sail_number,
      }),
    );

  rows.sort(compareSeededRows);

  return rows;
}

export function getOddEvenMovementAdvisory(
  numberOfHeats: number,
  totalBoats: number,
): string | null {
  // SHRS 2026 Heat Movement Tables end-note: "with entries of 10, 14, 18, 22,
  // 26, 30, 34 and 38 every second race will result in Heat 1 having 2 more
  // boats than Heat 2" — i.e. every N where N mod 4 = 2, starting at 10.
  // RULE-m1: the floor used to be 14, which silently skipped the 10-boat case
  // the rule names explicitly.
  if (numberOfHeats === 2 && totalBoats >= 10 && totalBoats % 4 === 2) {
    return (
      `SHRS advisory: with odd/even movement tables and ${totalBoats} boats in 2 heats, ` +
      'a temporary 2-boat imbalance between heats can occur and is expected.'
    );
  }
  return null;
}
