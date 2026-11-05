import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, useReportQueryError } from '../api/queries';
import { hasFinalHeats, hasScoredRace } from '../utils/heatView';
import { countQualifyingGroups } from '../../shared/heatNames';
import type { HeatWithBoats } from '../utils/heatView';

const NO_HEATS: HeatWithBoats[] = [];

/**
 * An event's heats with their boats and race counts (one query, shared by
 * every screen that shows them), and what can be read off them: whether heats
 * exist, whether a race has been scored, how many qualifying groups there
 * are, whether the Final Series has started. Everything is derived from the
 * list, so it can never disagree with the list on screen; any write to the
 * event reads it again (api/writes.ts).
 *
 * The final-series flag follows the last SUCCESSFUL read (it can go back to
 * false when the history undoes the start) and is left alone when a read
 * fails: a failed read says nothing about the event, and the host page must
 * not be told the Final Series is over because of a dropped call.
 *
 * `eventId` null: no event yet (nothing is read).
 */
export default function useHeatList(eventId: number | null | undefined) {
  const query = useQuery({
    ...queries.heatList(eventId ?? -1),
    enabled: eventId != null,
  });
  useReportQueryError(query, 'Could not load heats for this event.');

  const loadFailed = query.isError;
  const heats = loadFailed ? NO_HEATS : (query.data ?? NO_HEATS);
  const finalSeriesStarted = useMemo(
    () => hasFinalHeats(query.data ?? NO_HEATS),
    [query.data],
  );
  const heatsCreated = heats.length > 0;
  const raceHappened = useMemo(() => hasScoredRace(heats), [heats]);
  const numQualifyingGroups = useMemo(
    () => countQualifyingGroups(heats),
    [heats],
  );

  return {
    heats,
    loadFailed,
    /** True while a read of the list is on its way (the first or a refresh). */
    loading: query.isFetching,
    /** The last list read successfully (undefined before the first one). */
    loadedHeats: query.data,
    heatsCreated,
    raceHappened,
    numQualifyingGroups,
    finalSeriesStarted,
  };
}
