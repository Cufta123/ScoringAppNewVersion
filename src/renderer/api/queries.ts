import { useEffect, useRef } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { eventDB, heatRaceDB, sailorDB } from './db';
import { queryKeys } from './queryKeys';
import { reportError } from '../utils/userFeedback';
import type { HeatWithBoats } from '../utils/heatView';
import type { HeatType } from '../../shared/rows';

/**
 * Every read the screens make, as TanStack Query options: the key (from
 * api/queryKeys.ts) and the IPC call behind it, whose result type comes from
 * the contract (src/shared/ipc.ts). Screens read through `useQuery(…)` with
 * these; an action that needs an answer fresh at that moment (a check before
 * a write) uses `readNow`.
 *
 * A query's answer may not be `undefined`, so a list the main process (or a
 * test's mock) does not give is read as empty, as the screens always did.
 */

const listOf = <T>(rows: T[] | null | undefined): T[] =>
  Array.isArray(rows) ? rows : [];

export const queries = {
  events: () =>
    queryOptions({
      queryKey: queryKeys.events(),
      queryFn: async () => listOf(await eventDB.readAllEvents()),
    }),

  boatsOnFile: () =>
    queryOptions({
      queryKey: queryKeys.boatsOnFile(),
      queryFn: async () => listOf(await sailorDB.readAllBoats()),
    }),

  clubs: () =>
    queryOptions({
      queryKey: queryKeys.clubs(),
      queryFn: async () => listOf(await sailorDB.readAllClubs()),
    }),

  categories: () =>
    queryOptions({
      queryKey: queryKeys.categories(),
      queryFn: async () => {
        const rows = await sailorDB.readAllCategories();
        if (!rows) throw new Error('The category list came back empty.');
        return rows;
      },
    }),

  entries: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.entries(eventId),
      queryFn: async () => listOf(await eventDB.readBoatsByEvent(eventId)),
    }),

  heats: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.heats(eventId),
      queryFn: async () => listOf(await heatRaceDB.readAllHeats(eventId)),
    }),

  /** The heats, each with her boats and the number of races sailed. */
  heatList: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.heatList(eventId),
      queryFn: async (): Promise<HeatWithBoats[]> => {
        const heatRows = listOf(await heatRaceDB.readAllHeats(eventId));
        return Promise.all(
          heatRows.map(async (heat) => {
            const [boats, races] = await Promise.all([
              heatRaceDB.readBoatsByHeat(heat.heat_id),
              heatRaceDB.readAllRaces(heat.heat_id),
            ]);
            return {
              ...heat,
              boats: listOf(boats),
              raceNumber: listOf(races).length,
            };
          }),
        );
      },
    }),

  /** Has any race of the event been scored? (Entries are fixed then.) */
  raceHappened: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.raceHappened(eventId),
      queryFn: async () => {
        const heats = listOf(await heatRaceDB.readAllHeats(eventId));
        const races = await Promise.all(
          heats.map((heat) => heatRaceDB.readAllRaces(heat.heat_id)),
        );
        return races.some((raceArray) => listOf(raceArray).length > 0);
      },
    }),

  heatBoats: (eventId: number, heatId: number) =>
    queryOptions({
      queryKey: queryKeys.heatBoats(eventId, heatId),
      queryFn: async () => listOf(await heatRaceDB.readBoatsByHeat(heatId)),
    }),

  heatRaces: (eventId: number, heatId: number) =>
    queryOptions({
      queryKey: queryKeys.heatRaces(eventId, heatId),
      queryFn: async () => listOf(await heatRaceDB.readAllRaces(heatId)),
    }),

  qualifyingStandings: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.standings(eventId, 'qualifying'),
      queryFn: async () => listOf(await heatRaceDB.readLeaderboard(eventId)),
    }),

  finalStandings: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.standings(eventId, 'final'),
      queryFn: async () =>
        listOf(await heatRaceDB.readFinalLeaderboard(eventId)),
    }),

  overallStandings: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.standings(eventId, 'overall'),
      queryFn: async () =>
        listOf(await heatRaceDB.readOverallLeaderboard(eventId)),
    }),

  maxHeatSize: (eventId: number, heatType: HeatType) =>
    queryOptions({
      queryKey: queryKeys.maxHeatSize(eventId, heatType),
      queryFn: async () =>
        (await heatRaceDB.getMaxHeatSize(eventId, heatType)) || 0,
    }),

  finalSeriesEligibility: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.finalSeriesEligibility(eventId),
      queryFn: () => heatRaceDB.getFinalSeriesEligibility(eventId),
    }),

  scoreExplanation: (eventId: number, boatId: number) =>
    queryOptions({
      queryKey: queryKeys.scoreExplanation(eventId, boatId),
      queryFn: () => heatRaceDB.explainBoatScore(eventId, boatId),
    }),

  tieBreak: (
    eventId: number,
    boatA: number,
    boatB: number,
    finalSeries: boolean,
  ) =>
    queryOptions({
      queryKey: queryKeys.tieBreak(eventId, boatA, boatB, finalSeries),
      queryFn: async () =>
        (await heatRaceDB.explainTieBreak(
          eventId,
          boatA,
          boatB,
          finalSeries,
        )) ?? null,
    }),

  history: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.history(eventId),
      queryFn: async () => listOf(await eventDB.readEventHistory(eventId)),
    }),

  conversionReport: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.conversionReport(eventId),
      queryFn: async () =>
        (await eventDB.readConversionReport(eventId)) ?? null,
    }),

  exportLogo: (eventId: number) =>
    queryOptions({
      queryKey: queryKeys.exportLogo(eventId),
      queryFn: async () => (await eventDB.readEventExportLogo(eventId)) ?? null,
    }),
};

/**
 * Tell the user, in words, when a read fails (each failure once; nothing is
 * retried behind their back). `title` null: this screen shows the failure
 * itself, or the read is advisory.
 */
export function useReportQueryError(
  query: { error: unknown; errorUpdatedAt: number },
  title: string | null,
): void {
  const titleRef = useRef(title);
  titleRef.current = title;
  const { error, errorUpdatedAt } = query;
  useEffect(() => {
    if (error && titleRef.current) reportError(titleRef.current, error);
    // Once per failure: errorUpdatedAt changes with every new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUpdatedAt]);
}
