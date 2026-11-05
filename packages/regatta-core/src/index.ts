/**
 * regatta-core: an SHRS 2026-1 heat-racing event as a log of decisions in,
 * heats, scores and standings out. No database, no UI, no clock: the same
 * log gives the same results anywhere.
 *
 *   const result = replay(log);           // the event, or the first refusal
 *   qualifyingStandings(result.state);
 *   finalStandings(result.state);
 *   overallStandings(result.state);
 *   nextStep(result.state);
 *   eventStatus(result.state);             // what may be done now, and why not
 *
 * Undo = take the decision out of the log and replay; if a later decision
 * depended on it, replay says which and why.
 */
export * from './types';
export { replay, emptyEvent } from './event/replay';
export type { ReplayResult } from './event/replay';
/** The same log with the boats given other ids (another database's). */
export { boatsNamed, renameBoats } from './event/renameBoats';
export type { RenameResult } from './event/renameBoats';
export type { EventState, Heat, Race } from './event/state';
export { scoreRace } from './event/score';
/**
 * Point arithmetic: RRS 44.3(c) / A9 tenths, SHRS 5.2 no-place points, A9
 * averages, and totals without floating-point noise.
 */
export {
  exact as exactPoints,
  noPlacePoints,
  penaltyPoints,
  redressAverage,
  sum as sumPoints,
  toTenth,
} from './rules/points';
/** SHRS 5.4 discards. */
export { discardCount, excludedScores, NOT_EXCLUDABLE } from './rules/discards';
export type { Discardable } from './rules/discards';
/** SHRS 2 (heats), 4.1 / 5.5 (fleet names and precedence). */
export {
  MAX_HEATS,
  fewestHeats,
  movementImbalanceExpected,
} from './rules/heats';
export { MAX_HEAT_SIZE, fleetIndex, fleetName } from './rules/fleets';
/** SHRS 3 / 5.3: boat order and recording order. */
export {
  codeRank,
  compareBoats,
  inRecordingOrder,
  sameBoat,
} from './rules/seeding';
/** A result corrected in a race written as a column (a results table). */
export {
  FINISHED,
  applyRaceColumnEdit,
  holdsPlace,
  keepsProvidedPoints,
  scoreRaceColumn,
  slotOf,
} from './rules/correction';
export type { RaceCell, RaceColumnEdit } from './rules/correction';
export type { BoatResult } from './event/score';
export { hasRaceToSail, nextInRound, nextStep } from './event/nextStep';
export type { HeatProgress, NextStep, RoundStep } from './event/nextStep';
/** Where the event stands and what may be done now, with the reasons. */
export { eventStatus } from './event/status';
export type {
  EventStatus,
  FinalSeriesCheck,
  FinalSeriesStatus,
  HeatStatus,
  Offer,
  Verdict,
} from './event/status';
/** Undo as a new log: a heat's last race, the latest round. */
export {
  undoLastRace,
  undoLatestRound,
  undoRaceVerdict,
  undoRoundVerdict,
} from './event/undo';
export type { Undone } from './event/undo';
export {
  qualifyingStandings,
  qualifyingTieBreak,
} from './standings/qualifying';
export type { QualifyingStandings } from './standings/qualifying';
export {
  finalStandings,
  overallStandings,
  overallTieBreak,
} from './standings/final';
export type { FleetStandings, OverallStanding } from './standings/final';
export type { Score, Standing } from './standings/series';
export { FORMAT_VERSION, readEventFile, results, resultsOf } from './results';
export type {
  EventFile,
  Results,
  RaceScore,
  SeriesStanding,
  FleetResults,
  OverallResult,
  HeatSummary,
  Refusal,
} from './results';
export { explainScore, explainTie } from './explain';
export type {
  BoatExplanation,
  ExplainedRace,
  Reason,
  SeriesExplanation,
  TieExplanation,
} from './explain';
