import React from 'react';
import useHeatList from '../../hooks/useHeatList';
import { getLastHeats } from '../../utils/heatView';
import { getHeatRoundFromName } from '../../../shared/heatNames';

interface HeatsSummaryProps {
  eventId: number;
  /** Bump to load again (the history changed the event). */
  refreshToken?: number;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Where the racing stands, in one line, for the entries page. The heats
 * themselves (creating them, moving boats, the Final Series, backups) live
 * on the Scoring page only.
 */
export default function HeatsSummary({
  eventId,
  refreshToken = 0,
}: HeatsSummaryProps) {
  const { heats, heatsCreated, loadFailed, finalSeriesStarted } = useHeatList(
    eventId,
    refreshToken,
  );

  let text: string;
  if (loadFailed) {
    text = 'Could not load the heats. Open Scoring to see them.';
  } else if (!heatsCreated) {
    text =
      'No heats yet. When every boat is entered, create the heats on the Scoring page.';
  } else {
    const current = getLastHeats(heats);
    const scored = current.filter((heat) => heat.raceNumber > 0).length;
    if (finalSeriesStarted) {
      const races = Math.max(0, ...current.map((heat) => heat.raceNumber));
      text = `Final Series · ${plural(current.length, 'fleet', 'fleets')} · ${plural(races, 'race', 'races')} sailed`;
    } else {
      const round = current.length
        ? getHeatRoundFromName(current[0].heat_name)
        : null;
      text = `Qualifying${round ? ` round ${round}` : ''} · ${plural(current.length, 'heat', 'heats')} · ${scored} of ${current.length} scored`;
    }
  }

  return (
    <section className="heats-summary" aria-label="Heats">
      <i className="fa fa-flag" aria-hidden="true" />
      <p>
        <strong>Heats</strong>
        <span>{text}</span>
      </p>
    </section>
  );
}
