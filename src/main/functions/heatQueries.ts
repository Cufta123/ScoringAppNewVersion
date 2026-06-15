/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import { findLatestHeatsBySuffix } from './creatingNewHeatsUtls';

// Small shared read helpers for qualifying heats and their race counts. Used by
// both the IPC handlers and the Final Series eligibility check.

export function getLatestQualifyingHeats(event_id: any) {
  const existingHeatsQuery = db.prepare(
    `SELECT heat_name, heat_id FROM Heats WHERE event_id = ? AND heat_type = 'Qualifying'`,
  );
  const existingHeats = existingHeatsQuery.all(event_id);
  const latestHeats = findLatestHeatsBySuffix(existingHeats);
  if (latestHeats.length === 0) {
    throw new Error('No qualifying heats found for this event.');
  }
  return latestHeats;
}

export function getRaceCountForHeat(heat_id: number): number {
  const raceCountQuery = db.prepare(
    `SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?`,
  );
  return raceCountQuery.get(heat_id).race_count;
}
