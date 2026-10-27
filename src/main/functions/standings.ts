import { db } from '../../../public/Database/DBManager';
import { ensureCompleteRaceScoresForEvent } from './raceScoring';
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from './leaderboardRecompute';
import { hasFinalSeriesStarted } from './seriesGuards';

/**
 * Rebuild an event's standings from its scores. The Leaderboard and
 * FinalLeaderboard tables are a cache of this: anything that READS them for a
 * user (the standings screens, the score explanation) calls this first, so
 * what is shown can never be older than the scores. One event takes a few
 * milliseconds.
 */
export default function refreshStandings(event_id: number): void {
  db.transaction(() => {
    ensureCompleteRaceScoresForEvent(event_id, 'Qualifying');
    recomputeEventLeaderboard(event_id);
    if (hasFinalSeriesStarted(event_id)) {
      ensureCompleteRaceScoresForEvent(event_id, 'Final');
      recomputeFinalLeaderboard(event_id);
    }
  })();
}
