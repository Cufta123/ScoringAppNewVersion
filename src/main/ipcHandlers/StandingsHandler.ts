import handle from './handle';
import explainTieBreak from '../functions/explainTieBreak';
import explainBoatScore from '../functions/explainScore';
import refreshStandings from '../functions/standings';
import {
  finalRows,
  overallRows,
  qualifyingRows,
} from '../functions/libraryStandings';
import { getFinalSeriesEligibility } from '../functions/finalSeriesEligibility';
import { getMaxHeatSize } from '../functions/raceScoring';

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
  refreshStandings(Number(event_id));
  return explainBoatScore(Number(event_id), Number(boat_id));
});

// SHRS validation of whether the Final Series can start. The renderer renders
// prompts/messages from the returned reason; all the rule logic stays here.
handle('getFinalSeriesEligibility', async (_event, event_id) => {
  return getFinalSeriesEligibility(Number(event_id));
});

// The three leaderboard reads are worked out by regatta-core from the
// event's decision log (functions/libraryStandings.ts). refreshStandings
// first completes missing result rows (DNS / DNC) the conversion reads, and
// keeps the old standings tables for the readers not yet on the library.
handle('readLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  refreshStandings(event_id);
  return qualifyingRows(event_id);
});

handle('readFinalLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  refreshStandings(event_id);
  return finalRows(event_id);
});

/**
 * SHRS 5.5: overall = qualifying + final; Gold before Silver, and so on.
 * SHRS 1.5: until a final race is sailed, the qualifying ranking.
 */
handle('readOverallLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  refreshStandings(event_id);
  return overallRows(event_id);
});
