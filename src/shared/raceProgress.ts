/**
 * A qualifying result of a round still being sailed: its heat has sailed the
 * race, other heats of the round have not (SHRS 1.1: a race consists of all
 * its heats). Shown on the leaderboard, not counted in the standings.
 */
export interface PendingRace {
  boat_id: number;
  race_id: number;
  position: number;
  points: number;
  status: string;
  heat_name: string;
  race_number: number;
}
