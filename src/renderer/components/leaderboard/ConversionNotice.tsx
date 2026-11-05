import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eventDB } from '../../api/db';
import { queries } from '../../api/queries';
import { useWrite } from '../../api/writes';
import { formatDateTimeShort } from '../../utils/formatDate';
import { reportError } from '../../utils/userFeedback';

/** SQLite's CURRENT_TIMESTAMP is UTC without a zone: say so. */
const utc = (at: string) =>
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at)
    ? `${at.replace(' ', 'T')}Z`
    : at;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Shown on the leaderboard of an event made before the app scored with
 * regatta-core, until the race officer confirms it: when the event was
 * moved, and every result the rules now score differently from what the
 * old app had stored (with the reason the records could not be kept
 * exactly, where there is one).
 */
export default function ConversionNotice({ eventId }: { eventId: number }) {
  // An older main process, or no report: nothing to show (a failed read too).
  const report = useQuery(queries.conversionReport(eventId)).data ?? null;
  const [open, setOpen] = useState(false);
  // The report is read again, and is then marked seen.
  const markSeen = useWrite(
    (id: number) => eventDB.markConversionReportSeen(id),
    (_result, [id]) => ({ eventId: id }),
  );

  if (!report || report.seen) return null;

  const confirm = async () => {
    try {
      await markSeen(eventId);
    } catch (error) {
      reportError('Could not note that you have read this.', error);
    }
  };

  const changed = report.points.length;
  return (
    <div className="conversion-notice" role="status">
      <i className="fa fa-circle-info" aria-hidden="true" />
      <div>
        <strong>
          This event was moved to the new scoring on{' '}
          {formatDateTimeShort(utc(report.convertedAt))}.
        </strong>{' '}
        {report.refused
          ? 'Its stored results could not be read by the rules; nothing was changed. '
          : ''}
        {changed > 0
          ? `${plural(changed, 'result is', 'results are')} now scored by the rules differently from what was stored before. `
          : 'Every stored result scores the same. '}
        {report.notes.length + report.heats.length > 0
          ? `${plural(report.notes.length + report.heats.length, 'thing', 'things')} in the old records could not be kept exactly.`
          : ''}
        <div className="conversion-notice-actions">
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide the details' : 'Show what changed'}
          </button>
          <button type="button" className="btn btn-success" onClick={confirm}>
            I have checked this
          </button>
        </div>
        {open && (
          <div className="conversion-notice-details">
            {report.refused && <p>{report.refused}</p>}
            {changed > 0 && (
              <table className="conversion-notice-table">
                <thead>
                  <tr>
                    <th scope="col">Race</th>
                    <th scope="col">Boat</th>
                    <th scope="col">Result</th>
                    <th scope="col">Points before</th>
                    <th scope="col">Points now</th>
                  </tr>
                </thead>
                <tbody>
                  {report.points.map((point) => (
                    <tr key={`${point.race}|${point.boat}`}>
                      <td>{point.race}</td>
                      <td>{point.boat}</td>
                      <td>
                        {point.status === 'FINISHED'
                          ? 'finished'
                          : point.status}
                      </td>
                      <td>{point.before}</td>
                      <td>{point.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(report.heats.length > 0 || report.notes.length > 0) && (
              <ul>
                {report.heats.map((heat) => (
                  <li key={heat.heat}>
                    {heat.heat}:{' '}
                    {heat.added.length > 0 &&
                      `${heat.added.join(', ')} put in it (she has results there)`}
                    {heat.added.length > 0 && heat.removed.length > 0 && '; '}
                    {heat.removed.length > 0 &&
                      `${heat.removed.join(', ')} no longer in it`}
                    .
                  </li>
                ))}
                {report.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
