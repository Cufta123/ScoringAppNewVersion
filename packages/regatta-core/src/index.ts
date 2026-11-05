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
 *
 * Undo = take the decision out of the log and replay; if a later decision
 * depended on it, replay says which and why.
 */
export * from './types';
export { replay, emptyEvent, MAX_HEATS } from './event/replay';
export type { ReplayResult } from './event/replay';
export type { EventState, Heat, Race } from './event/state';
export { scoreRace } from './event/score';
export type { BoatResult } from './event/score';
export { nextStep } from './event/nextStep';
export type { NextStep } from './event/nextStep';
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
export { results, resultsOf } from './results';
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
