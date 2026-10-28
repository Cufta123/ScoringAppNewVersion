import { db } from '../../../public/Database/DBManager';

/**
 * How the screen names a race and a boat, for messages: "Heat A2, race 3"
 * and "ITA 12" — never the database's internal numbers, which mean nothing
 * to the person reading them. Only used to word a refusal, so a lookup that
 * fails falls back to a general phrase instead of hiding the refusal.
 */

export function raceLabel(raceId: unknown): string {
  try {
    const row = db
      .prepare(
        `SELECT h.heat_name, r.race_number FROM Races r
         JOIN Heats h ON h.heat_id = r.heat_id WHERE r.race_id = ?`,
      )
      .get(Number(raceId)) as
      | { heat_name: string; race_number: number }
      | undefined;
    if (row) return `${row.heat_name}, race ${row.race_number}`;
  } catch {
    // Fall through to the general phrase.
  }
  return 'this race';
}

export function boatLabel(boatId: unknown): string {
  try {
    const row = db
      .prepare('SELECT sail_number, country FROM Boats WHERE boat_id = ?')
      .get(Number(boatId)) as
      | { sail_number: string | number; country: string | null }
      | undefined;
    if (row) return `${row.country ? `${row.country} ` : ''}${row.sail_number}`;
  } catch {
    // Fall through to the general phrase.
  }
  return 'A boat';
}
