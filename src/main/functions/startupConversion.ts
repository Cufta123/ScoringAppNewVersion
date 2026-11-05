/**
 * Every event made before the switch to regatta-core gets its decision log
 * when the app starts, instead of the first time it is opened, so what the
 * conversion changed is recorded (and shown on its leaderboard) before
 * anyone works on it. Each event's conversion is its own action in the
 * history ("Moved to the new scoring"), as it would have been inside the
 * first call that used it.
 *
 * One event that cannot be converted is logged and left as it is; the
 * others go on. Opening that event later tries again and shows the reason.
 */
import { replay } from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import { ensureEventLog, eventsWithoutLog, loadLog } from './decisionStore';
import projectEvent from './projectEvent';
import { lastChangeId, tagChanges } from './changeJournal';
import { logError } from '../errorLog';

export const CONVERSION_CHANNEL = 'convertEventLog';

export default function convertEventsAtStartup(): {
  converted: number[];
  failed: number[];
} {
  const converted: number[] = [];
  const failed: number[] = [];
  eventsWithoutLog().forEach((eventId) => {
    const mark = lastChangeId();
    try {
      db.transaction(() => {
        ensureEventLog(eventId);
        // The tables are the log's projection: write them from it now, so
        // what the screens show (places as well as points) is the rules'
        // from the start. A log the rules refuse is left for its report.
        const result = replay(loadLog(eventId));
        if (result.ok) projectEvent(eventId, result.state);
      })();
      converted.push(eventId);
    } catch (error) {
      failed.push(eventId);
      logError(`Moving event ${eventId} to the new scoring`, error);
    } finally {
      // Whatever the conversion wrote (the log, missing DNS / DNC rows, the
      // tables from the log) is one action; a failed conversion rolled
      // back and wrote nothing.
      tagChanges(mark, CONVERSION_CHANNEL);
    }
  });
  return { converted, failed };
}
