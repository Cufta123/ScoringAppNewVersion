import handle from './handle';
import { explainBoatScore, explainTieBreak } from '../functions/libraryExplain';
import {
  finalRows,
  overallRows,
  qualifyingRows,
} from '../functions/libraryStandings';
import { readEventStatus } from '../functions/libraryEvent';
import { getMaxHeatSize } from '../functions/raceScoring';

// SHRS 5.2: the boats in the largest heat, for the edit screen's points.
// Until the writes go through regatta-core (switch phase 3) this stays the
// count the writes score with, so the screen shows what Save stores.
handle('getMaxHeatSize', async (event, event_id, heat_type) => {
  return getMaxHeatSize(
    Number(event_id),
    heat_type ? String(heat_type) : undefined,
  );
});

// Explain the SHRS 5.7 tie-break between two boats for the compare panel.
// The winner is taken from the same comparator the ranking uses, so the panel
// can never disagree with the actual placement. Series flag selects the
// qualifying comparator vs the combined overall (final-series) comparator.
handle(
  'explainTieBreak',
  async (_event, event_id, boatAId, boatBId, isFinalSeries) => {
    // regatta-core works it out from the stored results, as the leaderboard
    // reads do (functions/libraryExplain.ts); complete them first.
    return explainTieBreak(
      Number(event_id),
      String(boatAId),
      String(boatBId),
      Boolean(isFinalSeries),
    );
  },
);

// "How was this score calculated?" for one boat: every race's points with the
// rule behind them, the discards, and how ties with other boats were broken.
handle('explainBoatScore', async (_event, event_id, boat_id) => {
  return explainBoatScore(Number(event_id), Number(boat_id));
});

// Where the event stands and what the race office may do now: the series,
// the round, its heats, the next step and every action of the round bar and
// the heat cards with the reason it is refused (regatta-core's eventStatus;
// with the Final Series eligibility the Start Final Series questions use).
handle('readEventStatus', async (_event, event_id) => {
  return readEventStatus(Number(event_id));
});

// The three leaderboard reads are worked out by regatta-core from the
// event's decision log (functions/libraryStandings.ts; decisionStore).
handle('readLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  return qualifyingRows(event_id);
});

handle('readFinalLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  return finalRows(event_id);
});

/**
 * SHRS 5.5: overall = qualifying + final; Gold before Silver, and so on.
 * SHRS 1.5: until a final race is sailed, the qualifying ranking.
 */
handle('readOverallLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  return overallRows(event_id);
});
