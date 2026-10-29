import { db } from '../../../public/Database/DBManager';
import handle from './handle';
import {
  OverallTiePacket,
  buildOverallTiePacket,
  rankOverallStandings,
} from '../functions/overallTieBreak';
import type { PendingRace } from '../../shared/raceProgress';
import { orderFinalLeaderboardRows } from '../functions/finalLeaderboardOrder';
import explainTieBreak from '../functions/explainTieBreak';
import explainBoatScore from '../functions/explainScore';
import refreshStandings from '../functions/standings';
import { getFinalSeriesEligibility } from '../functions/finalSeriesEligibility';
import { recomputeEventLeaderboard } from '../functions/leaderboardRecompute';
import { roundPoints } from '../../shared/points';
import {
  ensureCompleteRaceScoresForEvent,
  getMaxHeatSize,
} from '../functions/raceScoring';

/** The boat and sailor columns every leaderboard read returns. */
interface BoatStandingsColumns {
  boat_id: number;
  boat_number: string | number | null;
  boat_type: string | null;
  name: string | null;
  surname: string | null;
  country: string | null;
}

/** Per-race columns: comma-joined, in race order (see GROUP_CONCAT below). */
interface RaceColumns {
  race_positions: string | null;
  race_points: string | null;
  race_ids: string | null;
  race_statuses: string | null;
}

interface QualifyingReadRow extends BoatStandingsColumns, RaceColumns {
  total_points_event: number;
  place: number;
}

interface FinalReadRow extends BoatStandingsColumns, RaceColumns {
  total_points_final: number;
  event_id: number;
  placement_group: string;
  qualifying_points: number;
}

interface OverallReadRow extends BoatStandingsColumns {
  qualifying_points: number;
  final_points: number;
  overall_points: number;
  placement_group: string;
  final_place: number;
}

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

/**
 * Qualifying results of a round still being sailed: heats that have sailed a
 * race other heats of the round have not (see CountedRaces). Shown on the
 * leaderboard, greyed, and not counted until the round is complete.
 */
function readRacesInProgress(event_id: number) {
  const rows = db
    .prepare(
      `SELECT sc.boat_id, sc.race_id, sc.position, sc.points,
              COALESCE(sc.status, 'DNS') AS status, h.heat_name, r.race_number
       FROM Scores sc
       JOIN Races r ON r.race_id = sc.race_id
       JOIN Heats h ON h.heat_id = r.heat_id
       LEFT JOIN CountedRaces cr ON cr.race_id = sc.race_id
       WHERE h.event_id = ? AND h.heat_type = 'Qualifying' AND cr.race_id IS NULL
       ORDER BY r.race_number, r.race_id`,
    )
    .all(event_id) as PendingRace[];
  const byBoat = new Map<number, PendingRace[]>();
  rows.forEach((row) => {
    const list = byBoat.get(Number(row.boat_id)) ?? [];
    list.push(row);
    byBoat.set(Number(row.boat_id), list);
  });
  return { rows, byBoat };
}

handle('readLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  // The stored standings are only a cache: rebuild them from the scores on
  // every read, so the screen can never show stale places (cheap: one event).
  db.transaction(() => {
    ensureCompleteRaceScoresForEvent(event_id, 'Qualifying');
    recomputeEventLeaderboard(event_id);
  })();

  const query =
    'SELECT ' +
    'lb.boat_id, ' +
    'lb.total_points_event, ' +
    'lb.place, ' +
    'b.sail_number AS boat_number, ' +
    'b.model AS boat_type, ' +
    's.name, ' +
    's.surname, ' +
    'b.country, ' +
    'GROUP_CONCAT(sc.position ORDER BY r.race_number, r.race_id) AS race_positions, ' +
    'GROUP_CONCAT(sc.points ORDER BY r.race_number, r.race_id) AS race_points, ' +
    'GROUP_CONCAT(r.race_id ORDER BY r.race_number, r.race_id) AS race_ids, ' +
    "GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number, r.race_id) AS race_statuses " +
    'FROM Leaderboard lb ' +
    'LEFT JOIN Boats b ON lb.boat_id = b.boat_id ' +
    'LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id ' +
    'LEFT JOIN Scores sc ON sc.boat_id = b.boat_id ' +
    'LEFT JOIN Races r ON sc.race_id = r.race_id ' +
    'LEFT JOIN Heats h ON r.heat_id = h.heat_id ' +
    // Only races every heat of the round has sailed (SHRS 1.1).
    'JOIN CountedRaces cr ON cr.race_id = sc.race_id ' +
    "WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying' " +
    'AND sc.race_id IS NOT NULL ' +
    'GROUP BY lb.boat_id ' +
    'ORDER BY lb.place ASC';
  const readQuery = db.prepare(query);
  const pending = readRacesInProgress(event_id);
  const results = (
    readQuery.all(event_id, event_id) as QualifyingReadRow[]
  ).map((row) => ({
    ...row,
    pending_races: pending.byBoat.get(Number(row.boat_id)) ?? [],
  }));
  return results;
});

handle('readFinalLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  // Rebuilt on every read, like readLeaderboard: never a stale table. The
  // query below also reads the QUALIFYING totals (the SHRS 1.5 fallback and
  // the qualifying column), so they are rebuilt too: refreshStandings does both.
  refreshStandings(event_id);

  // The final-score join is a LEFT JOIN onto a pre-filtered subquery so that
  // boats in fleets that have not raced yet (SHRS 4.5) still return a row —
  // with NULL race CSVs — instead of being dropped from the leaderboard.
  const query =
    'SELECT ' +
    'fl.boat_id, ' +
    'fl.total_points_final, ' +
    'fl.event_id, ' +
    'fl.placement_group, ' +
    // SHRS 1.5 needs the qualifying series score to rank by when the Final
    // Series has no completed races.
    'COALESCE(lb.total_points_event, 0) AS qualifying_points, ' +
    'b.sail_number AS boat_number, ' +
    'b.model AS boat_type, ' +
    's.name, ' +
    's.surname, ' +
    'b.country, ' +
    'GROUP_CONCAT(fs.position ORDER BY fs.race_number, fs.race_id) AS race_positions, ' +
    'GROUP_CONCAT(fs.points ORDER BY fs.race_number, fs.race_id) AS race_points, ' +
    'GROUP_CONCAT(fs.race_id ORDER BY fs.race_number, fs.race_id) AS race_ids, ' +
    "GROUP_CONCAT(COALESCE(fs.status, 'DNS') ORDER BY fs.race_number, fs.race_id) AS race_statuses " +
    'FROM FinalLeaderboard fl ' +
    'LEFT JOIN Boats b ON fl.boat_id = b.boat_id ' +
    'LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id ' +
    'LEFT JOIN Leaderboard lb ON lb.boat_id = fl.boat_id AND lb.event_id = fl.event_id ' +
    'LEFT JOIN (' +
    'SELECT sc.boat_id, sc.position, sc.points, sc.status, sc.race_id, r.race_number ' +
    'FROM Scores sc ' +
    'JOIN Races r ON sc.race_id = r.race_id ' +
    'JOIN Heats h ON r.heat_id = h.heat_id ' +
    "WHERE h.event_id = ? AND h.heat_type = 'Final'" +
    ') fs ON fs.boat_id = fl.boat_id ' +
    'WHERE fl.event_id = ? ' +
    'GROUP BY fl.boat_id';
  // Ordering is done in JS below: SHRS 5.5 fleet precedence has to cover the
  // "Fleet 5"+ overflow names (RULE-m2), and SHRS 1.5 switches the sort key
  // entirely when no final race has been completed. Encoding either in SQL
  // would need interpolated CASE arms, so the query stays unordered and one
  // comparator owns the rule.
  const readQuery = db.prepare(query);
  // SHRS 5.5 fleet precedence + SHRS 1.5 qualifying-score fallback — see
  // functions/finalLeaderboardOrder.ts.
  const results = orderFinalLeaderboardRows(
    readQuery.all(event_id, event_id) as FinalReadRow[],
  );
  return results;
});

/**
 * SHRS 5.4: A boat's overall series score = qualifying series score + final series score.
 * Gold fleet boats rank before Silver, Silver before Bronze, etc.
 * SHRS 1.5: If no races are completed in the Final Series, boats are ranked
 * according to their series score in the Qualifying Series.
 */
handle('readOverallLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  refreshStandings(event_id);
  // SHRS 1.5: "If no races are completed in the Final Series boats will be
  // ranked according to their series score in the Qualifying Series." A final
  // race is "completed" once it has been SAILED — i.e. once ANY boat has a
  // final-series score — not once every boat in the heat is scored. Counting
  // final score rows (rather than fully-scored races) keeps this in step with
  // finalLeaderboardOrder.hasNoCompletedFinalRaces, so the Final and Overall
  // tables never disagree on a partially-scored final race.
  const finalScoreCount = db
    .prepare(
      `SELECT COUNT(*) as cnt
     FROM Scores sc
     JOIN Races r ON sc.race_id = r.race_id
     JOIN Heats h ON r.heat_id = h.heat_id
     WHERE h.event_id = ? AND h.heat_type = 'Final'`,
    )
    .get(event_id) as { cnt: number };

  // SHRS 1.5: If no completed final races, rank by qualifying only.
  if (!finalScoreCount || finalScoreCount.cnt === 0) {
    const qualifyingResults = db
      .prepare(
        `SELECT
        lb.boat_id,
        lb.total_points_event AS overall_points,
        lb.place,
        'Qualifying' AS placement_group,
        b.sail_number AS boat_number,
        b.model AS boat_type,
        s.name,
        s.surname,
        b.country
      FROM Leaderboard lb
      LEFT JOIN Boats b ON lb.boat_id = b.boat_id
      LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
      WHERE lb.event_id = ?
      ORDER BY lb.place ASC`,
      )
      .all(event_id);
    return qualifyingResults;
  }

  // Combined overall series: qualifying score + final score.
  // The SQL orders only by points; SHRS 5.5 fleet precedence is applied by
  // the JS comparator below, which understands the "Fleet 5"+ overflow names
  // a fixed CASE cannot (RULE-m2).
  const overallQuery = db.prepare(
    `SELECT
      fl.boat_id,
      COALESCE(lb.total_points_event, 0) AS qualifying_points,
      fl.total_points_final AS final_points,
      COALESCE(lb.total_points_event, 0) + fl.total_points_final AS overall_points,
      fl.placement_group,
      fl.place AS final_place,
      b.sail_number AS boat_number,
      b.model AS boat_type,
      s.name,
      s.surname,
      b.country
    FROM FinalLeaderboard fl
    LEFT JOIN Leaderboard lb ON fl.boat_id = lb.boat_id AND lb.event_id = fl.event_id
    LEFT JOIN Boats b ON fl.boat_id = b.boat_id
    LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
    WHERE fl.event_id = ?
    ORDER BY overall_points ASC, fl.place ASC`,
  );

  // Normalise the SQL sums so equal overall totals compare equal (see
  // shared/points.ts) — otherwise a tie group below can be split by noise.
  const results = (overallQuery.all(event_id) as OverallReadRow[]).map(
    (row) => ({
      ...row,
      overall_points: roundPoints(Number(row.overall_points)),
    }),
  );

  const tiePacketCache = new Map<number, OverallTiePacket>();
  const getTiePacket = (boatId: number) => {
    if (!tiePacketCache.has(boatId)) {
      tiePacketCache.set(boatId, buildOverallTiePacket(event_id, boatId));
    }
    return tiePacketCache.get(boatId) as OverallTiePacket;
  };
  const ranked = rankOverallStandings(results, getTiePacket);

  return ranked;
});
