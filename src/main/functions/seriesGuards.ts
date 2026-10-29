import { db } from '../../../public/Database/DBManager';
import { laterRoundHeatNames as sharedLaterRoundHeatNames } from '../../shared/heatNames';

/**
 * Server-side guards for writes that would contradict the shape of the series.
 *
 * The renderer hides or warns about these actions, but its state can be stale
 * and every channel is reachable on its own, so the main process re-checks
 * (the same reasoning as recreateInitialHeatsAtomic / removeBoatFromEvent).
 */

export interface HeatRow {
  heat_id: number;
  heat_name: string;
  event_id: number;
  heat_type: string;
}

export function hasFinalSeriesStarted(event_id: number): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM Heats
       WHERE event_id = ? AND heat_type = 'Final'`,
    )
    .get(event_id) as { count: number } | undefined;
  return (row?.count ?? 0) > 0;
}

/**
 * Names of the qualifying heats built AFTER `heat`'s round from the same base
 * letters — i.e. the rounds whose assignment was seeded from this one.
 */
export function laterRoundHeatNames(heat: HeatRow): string[] {
  const heats = db
    .prepare(
      `SELECT heat_name FROM Heats
       WHERE event_id = ? AND heat_type = 'Qualifying'`,
    )
    .all(heat.event_id) as { heat_name: string }[];
  return sharedLaterRoundHeatNames(heats, heat.heat_name);
}

/**
 * A qualifying heat's results may only be added or removed while they are
 * still the basis of nothing else:
 *  - once the Final Series has started, the fleets were split on the
 *    qualifying ranking (SHRS 4.2), so the qualifying series is closed;
 *  - once the next round was built from this round (SHRS 3.1(2)), changing
 *    which race this round sailed leaves that round seeded from results that
 *    no longer exist. Undo the redistribution first.
 *
 * Final heats are not affected: fleets may sail different numbers of races
 * (SHRS 4.5), and nothing is seeded from a final race.
 */
export function assertQualifyingHeatIsOpen(heat: HeatRow, action: string) {
  if (heat.heat_type !== 'Qualifying') return;

  if (hasFinalSeriesStarted(heat.event_id)) {
    throw new Error(
      `Cannot ${action} for "${heat.heat_name}": the Final Series has already started, so the qualifying series is closed.`,
    );
  }

  const later = laterRoundHeatNames(heat);
  if (later.length > 0) {
    throw new Error(
      `Cannot ${action} for "${heat.heat_name}": the next round (${later.join(', ')}) was already built from this round's results. Undo the heat redistribution first.`,
    );
  }
}
