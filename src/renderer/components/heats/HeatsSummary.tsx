import React from 'react';
import useEventStatus from '../../hooks/useEventStatus';

interface HeatsSummaryProps {
  eventId: number;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Where the racing stands, in one line, for the entries page: worded from
 * the event status (regatta-core's eventStatus: the series, the round and
 * its heats). The heats themselves (creating them, moving boats, the Final
 * Series, backups) live on the Scoring page only.
 */
export default function HeatsSummary({ eventId }: HeatsSummaryProps) {
  const { status, loadFailed } = useEventStatus(
    eventId,
    'Could not load heats for this event.',
  );

  let text: string;
  if (loadFailed) {
    text = 'Could not load the heats. Open Scoring to see them.';
  } else if (!status) {
    text = '';
  } else if (status.series === 'entries') {
    text =
      'No heats yet. When every boat is entered, create the heats on the Scoring page.';
  } else {
    const { heats } = status;
    if (status.series === 'final') {
      const races = Math.max(0, ...heats.map((heat) => heat.races));
      text = `Final Series · ${plural(heats.length, 'fleet', 'fleets')} · ${plural(races, 'race', 'races')} sailed`;
    } else {
      const scored = heats.filter((heat) => heat.races > 0).length;
      text = `Qualifying round ${status.round} · ${plural(heats.length, 'heat', 'heats')} · ${scored} of ${heats.length} scored`;
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
