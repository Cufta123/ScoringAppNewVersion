/**
 * Per-event SHRS configuration stored on the Events row: qualifying
 * assignment mode (3.1/3.2), heat overflow policy (2.3), and the
 * discard-profile lock that closes editing at the first warning signal (5.4).
 */
import { db } from '../../../public/Database/DBManager';
import {
  type HeatOverflowPolicy,
  type QualifyingAssignmentMode,
  normalizeHeatOverflowPolicy,
  normalizeQualifyingAssignmentMode,
} from '../../shared/eventSettings';

export const getEventQualifyingAssignmentMode = (
  event_id: number,
): QualifyingAssignmentMode => {
  const row = db
    .prepare(
      'SELECT shrs_qualifying_assignment_mode FROM Events WHERE event_id = ?',
    )
    .get(event_id) as { shrs_qualifying_assignment_mode?: string } | undefined;
  return normalizeQualifyingAssignmentMode(
    row?.shrs_qualifying_assignment_mode,
  );
};

export const getEventHeatOverflowPolicy = (
  event_id: number,
): HeatOverflowPolicy => {
  const row = db
    .prepare('SELECT shrs_heat_overflow_policy FROM Events WHERE event_id = ?')
    .get(event_id) as { shrs_heat_overflow_policy?: string } | undefined;
  return normalizeHeatOverflowPolicy(row?.shrs_heat_overflow_policy);
};

// Re-exported from the shared module so the renderer's heat-count default and
// the main process's cap cannot drift (SHRS 2.3).
export { SHRS_MAX_BOATS_PER_HEAT } from '../../shared/heatSizing';

export const lockDiscardProfileForRace = (race_id: number) => {
  const row = db
    .prepare(
      `SELECT h.event_id, h.heat_type
       FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE r.race_id = ?`,
    )
    .get(race_id) as { event_id: number; heat_type: string } | undefined;

  if (!row) {
    return;
  }

  if (row.heat_type === 'Qualifying') {
    db.prepare(
      'UPDATE Events SET shrs_discard_locked_qualifying = 1 WHERE event_id = ?',
    ).run(row.event_id);
  }

  if (row.heat_type === 'Final') {
    db.prepare(
      'UPDATE Events SET shrs_discard_locked_final = 1 WHERE event_id = ?',
    ).run(row.event_id);
  }
};
