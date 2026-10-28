// The heat/race IPC channels, registered by area. This module only exists so
// existing imports of HeatRaceHandler keep working; each area owns its channels:
//   HeatHandler        heats, boats in heats, next round, undo redistribution
//   ScoringHandler     submit a race, undo a race, leaderboard result edits
//   StandingsHandler   leaderboard reads, explanations, eligibility
//   FinalSeriesHandler starting the Final Series
//   SnapshotHandler    event snapshot export / restore
import './HeatHandler';
import './ScoringHandler';
import './StandingsHandler';
import './FinalSeriesHandler';
import './SnapshotHandler';
