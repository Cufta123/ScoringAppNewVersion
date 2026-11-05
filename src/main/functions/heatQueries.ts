import { db } from '../../../public/Database/DBManager';
import type { HeatRow } from './seriesGuards';

// Small shared reads of heats and races for the IPC handlers.

/**
 * One heat by id, for a handler whose screen may be out of date: a heat that
 * is gone is a refusal the race officer can act on, not a crash.
 */
export function requireHeat(heat_id: unknown): HeatRow {
  const row = db
    .prepare(
      'SELECT heat_id, heat_name, event_id, heat_type FROM Heats WHERE heat_id = ?',
    )
    .get(heat_id) as HeatRow | undefined;
  if (!row) {
    throw new Error(
      'This heat no longer exists (it may have been removed in the meantime). Reload the page.',
    );
  }
  return row;
}

export interface LatestRace {
  race_id: number;
  race_number: number;
}

/**
 * A reader for "the latest race of a heat" (highest race number, newest first
 * on a tie). The statement is prepared once, so a caller looping over heats
 * does not prepare it per heat.
 */
export function latestRaceReader(): (
  heat_id: number,
) => LatestRace | undefined {
  const query = db.prepare(
    `SELECT race_id, race_number
     FROM Races
     WHERE heat_id = ?
     ORDER BY race_number DESC, race_id DESC
     LIMIT 1`,
  );
  return (heat_id) => query.get(heat_id) as LatestRace | undefined;
}

export function getLatestRaceForHeat(heat_id: number): LatestRace | undefined {
  return latestRaceReader()(heat_id);
}

// SHRS 5.2: the number of boats in the largest heat of a series — a single
// series-wide value (the max heat size across every heat generation), used to
// score non-finishers as (largest heat + 1). Shared so the leaderboard
// recompute can re-derive stale scores against the same value the handler uses.
