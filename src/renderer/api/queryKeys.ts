import type { HeatType } from '../../shared/rows';

/**
 * Every query key of the renderer, in one place.
 *
 * Everything about one event sits under `['event', eventId, …]`, so one
 * invalidation of `queryKeys.event(eventId)` refreshes all of it: entries,
 * heats, races, the three standings, explanations, history, the logo… (the
 * one refresh rule, api/writes.ts). Data that is not one event's — the list
 * of events (its rows carry flags worked out from the races) and the sailors,
 * boats and clubs on file — has its own root.
 *
 * Each key names what it holds; the reads behind them are in api/queries.ts,
 * typed by the IPC contract (src/shared/ipc.ts).
 */

export type StandingsSeries = 'qualifying' | 'final' | 'overall';

export const queryKeys = {
  /** readAllEvents */
  events: () => ['events'] as const,

  /** Sailors, boats, clubs and categories on file (every event's). */
  onFile: () => ['onFile'] as const,
  /** readAllBoats: every boat on file. */
  boatsOnFile: () => ['onFile', 'boats'] as const,
  /** readAllClubs */
  clubs: () => ['onFile', 'clubs'] as const,
  /** readAllCategories */
  categories: () => ['onFile', 'categories'] as const,

  /** Everything about one event: invalidate this after any write to it. */
  event: (eventId: number) => ['event', eventId] as const,
  /** readBoatsByEvent: the entries. */
  entries: (eventId: number) => ['event', eventId, 'entries'] as const,
  /** readAllHeats */
  heats: (eventId: number) => ['event', eventId, 'heats'] as const,
  /** The heats with their boats and the number of races each has sailed. */
  heatList: (eventId: number) => ['event', eventId, 'heatList'] as const,
  /** Whether any race of the event has been scored. */
  raceHappened: (eventId: number) =>
    ['event', eventId, 'raceHappened'] as const,
  /** readBoatsByHeat */
  heatBoats: (eventId: number, heatId: number) =>
    ['event', eventId, 'heat', heatId, 'boats'] as const,
  /** readAllRaces */
  heatRaces: (eventId: number, heatId: number) =>
    ['event', eventId, 'heat', heatId, 'races'] as const,
  /** readLeaderboard / readFinalLeaderboard / readOverallLeaderboard */
  standings: (eventId: number, series: StandingsSeries) =>
    ['event', eventId, 'standings', series] as const,
  /** getMaxHeatSize */
  maxHeatSize: (eventId: number, heatType: HeatType) =>
    ['event', eventId, 'maxHeatSize', heatType] as const,
  /** readEventStatus: where the event stands and what may be done now. */
  eventStatus: (eventId: number) => ['event', eventId, 'status'] as const,
  /** explainBoatScore */
  scoreExplanation: (eventId: number, boatId: number) =>
    ['event', eventId, 'scoreExplanation', boatId] as const,
  /** explainTieBreak */
  tieBreak: (
    eventId: number,
    boatA: number,
    boatB: number,
    finalSeries: boolean,
  ) => ['event', eventId, 'tieBreak', boatA, boatB, finalSeries] as const,
  /** readEventHistory */
  history: (eventId: number) => ['event', eventId, 'history'] as const,
  /** readBackupFiles */
  backupFiles: (eventId: number) => ['event', eventId, 'backupFiles'] as const,
  /** readConversionReport */
  conversionReport: (eventId: number) =>
    ['event', eventId, 'conversionReport'] as const,
  /** readEventExportLogo */
  exportLogo: (eventId: number) => ['event', eventId, 'exportLogo'] as const,
};
