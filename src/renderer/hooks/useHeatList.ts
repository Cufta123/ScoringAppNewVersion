import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { heatRaceDB } from '../api/db';
import { reportError } from '../utils/userFeedback';
import { hasFinalHeats, hasScoredRace } from '../utils/heatView';
import { countQualifyingGroups } from '../../shared/heatNames';
import type { HeatWithBoats } from '../utils/heatView';

/**
 * Loads an event's heats with their boats and race counts, and what can be
 * read off them: whether heats exist, whether a race has been scored, how
 * many qualifying groups there are, whether the Final Series has started.
 *
 * Only the list itself and the final-series flag are stored; the rest is
 * derived, so it can never disagree with the list on screen.
 *
 * The final-series flag follows every SUCCESSFUL load (it can go back to false
 * when the history undoes the start) but is left alone when a load fails: a
 * failed read says nothing about the event, and the host page must not be told
 * the Final Series is over because of a dropped call.
 */
export default function useHeatList(eventId: number, refreshToken: number) {
  const [heats, setHeats] = useState<HeatWithBoats[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  // Loads can overlap (the parent bumps refreshToken while one of our own
  // actions reloads). Only the newest answer may be applied, or an older, slower
  // read overwrites the fresh one — and one that finishes after unmount or an
  // event switch is dropped altogether.
  const latestLoad = useRef(0);

  const reload = useCallback(async () => {
    latestLoad.current += 1;
    const thisLoad = latestLoad.current;
    try {
      const heatRows = await heatRaceDB.readAllHeats(eventId);
      const details: HeatWithBoats[] = await Promise.all(
        heatRows.map(async (heat) => {
          const [boats, races] = await Promise.all([
            heatRaceDB.readBoatsByHeat(heat.heat_id),
            heatRaceDB.readAllRaces(heat.heat_id),
          ]);
          return { ...heat, boats, raceNumber: races.length };
        }),
      );
      if (thisLoad !== latestLoad.current) return;
      setHeats(details);
      setFinalSeriesStarted(hasFinalHeats(details));
      setLoadFailed(false);
    } catch (error) {
      if (thisLoad !== latestLoad.current) return;
      reportError('Could not load heats for this event.', error);
      setHeats([]);
      setLoadFailed(true);
    }
  }, [eventId]);

  // Re-fetch when the event changes or when the parent bumps `refreshToken`
  // (e.g. after creating new heats or undoing a redistribution). Driving this
  // through a dependency keeps child state intact instead of forcing a remount.
  useEffect(() => {
    reload();
  }, [reload, refreshToken]);

  useEffect(
    () => () => {
      latestLoad.current += 1;
    },
    [],
  );

  const markFinalSeriesStarted = useCallback(
    () => setFinalSeriesStarted(true),
    [],
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
    heatsCreated,
    raceHappened,
    numQualifyingGroups,
    finalSeriesStarted,
    /** The start was just confirmed: show it before the reload lands. */
    markFinalSeriesStarted,
    reload,
  };
}
