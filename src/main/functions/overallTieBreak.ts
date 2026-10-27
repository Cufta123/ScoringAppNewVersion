import { db } from '../../../public/Database/DBManager';
import {
  getEventDiscardConfig,
  getSeriesDiscardRaceCount,
} from './discardConfig';
import {
  OverallRaceScore,
  OverallTiePacket,
  overallTiePacketFromScores,
} from '../../shared/scoring/overall';

// Loads what the overall (qualifying + final) tie-break needs from the
// database. The rules themselves live in src/shared/scoring/overall.ts.

export type { OverallRaceScore, OverallTiePacket };
export {
  compareOverallTiePackets,
  rankOverallStandings,
  resolveOverallTieGroupSequentially,
} from '../../shared/scoring/overall';

export function buildOverallTiePacket(
  event_id: any,
  boat_id: any,
): OverallTiePacket {
  const scores = db
    .prepare(
      `SELECT s.race_id, r.race_number, s.points, h.heat_type, h.heat_name, COALESCE(s.status, 'FINISHED') as status
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       JOIN CountedRaces cr ON cr.race_id = s.race_id
       WHERE h.event_id = ? AND s.boat_id = ?
         AND h.heat_type IN ('Qualifying', 'Final')`,
    )
    .all(event_id, boat_id) as OverallRaceScore[];

  // SHRS 5.4: the final discard count is keyed off the boat's own fleet.
  const finalHeatName = scores.find(
    (row) => row.heat_type === 'Final',
  )?.heat_name;
  return overallTiePacketFromScores(scores, {
    qualifyingDiscardConfig: getEventDiscardConfig(event_id, 'qualifying'),
    finalDiscardConfig: getEventDiscardConfig(event_id, 'final'),
    qualifyingRaceCount: getSeriesDiscardRaceCount(event_id, 'Qualifying'),
    finalFleetRaceCount: finalHeatName
      ? getSeriesDiscardRaceCount(event_id, 'Final', finalHeatName)
      : 0,
  });
}
