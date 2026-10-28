import { db } from '../../../public/Database/DBManager';
import handle from './handle';
import { findLatestHeatsBySuffix } from '../functions/creatingNewHeatsUtls';
import { getEventDiscardConfig } from '../functions/discardConfig';
import { fleetNameForIndex } from '../../shared/fleetNames';
import refreshStandings from '../functions/standings';
import { getRaceCountForHeat } from '../functions/heatQueries';
import { getEventHeatOverflowPolicy } from '../functions/eventSettings';
import planFinalFleets, {
  NO_QUALIFYING_RESULTS_REFUSAL,
  findWithdrawnBoatIds,
} from '../functions/finalFleetPlan';
import buildAdjustedFleetLeaderboard from '../functions/fleetTotals';
import prepareHeatWriters from '../functions/heatWriters';

handle(
  'startFinalSeriesAtomic',
  async (
    _event,
    raw_event_id,
    allow_oversize_confirm = false,
    apply_shrs43_temporary_second_discard = true,
  ) => {
    const event_id = Number(raw_event_id);
    const allHeats = db
      .prepare(
        'SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?',
      )
      .all(event_id) as {
      heat_id: number;
      heat_name: string;
      heat_type: string;
    }[];

    const finalHeats = allHeats.filter((heat) => heat.heat_type === 'Final');
    if (finalHeats.length > 0) {
      throw new Error(
        'The Final Series has already been started for this event.',
      );
    }

    const qualifyingHeats = allHeats.filter(
      (heat) => heat.heat_type === 'Qualifying',
    );

    const uniqueGroups = new Set(
      qualifyingHeats
        .map((heat) => {
          // Match the full base letters ("Heat AA1" -> "AA"), consistent with
          // getFinalSeriesEligibility / buildLatestHeatMapByBase elsewhere.
          // A single-letter match would collapse multi-letter bases together.
          const m = heat.heat_name.match(/Heat ([A-Z]+)/);
          return m ? m[1] : null;
        })
        .filter(Boolean),
    );
    const numFinalHeats = uniqueGroups.size;

    if (numFinalHeats < 2) {
      throw new Error(
        'The Final Series needs at least 2 qualifying heats. With a single heat, every boat is scored as one fleet and there is no Final Series.',
      );
    }

    const latestQualifyingHeats = findLatestHeatsBySuffix(
      qualifyingHeats.map((heat) => ({
        heat_name: heat.heat_name,
        heat_id: heat.heat_id,
      })),
    );

    const raceCounts = latestQualifyingHeats.map((heat) =>
      getRaceCountForHeat(heat.heat_id),
    );
    const uniqueRaceCounts = [...new Set(raceCounts)];
    if (uniqueRaceCounts.length > 1) {
      throw new Error(
        'Cannot start the Final Series yet: the heats of the current round have not all sailed the same number of races. Score the missing races first.',
      );
    }

    // Repair any missing score rows as DNS first so boats without scores
    // are ranked last instead of being dropped by the leaderboard join.
    // The fleet split below reads its boat list from Leaderboard, so a
    // repair must be followed by a recompute or a boat whose only scores
    // were just backfilled is left out of every final fleet.
    refreshStandings(Number(event_id));

    const leaderboard = db
      .prepare(
        `SELECT
          lb.boat_id,
          GROUP_CONCAT(sc.points ORDER BY r.race_number, r.race_id) AS race_points,
          GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number, r.race_id) AS race_statuses
        FROM Leaderboard lb
        LEFT JOIN Scores sc ON sc.boat_id = lb.boat_id
        LEFT JOIN Races r ON sc.race_id = r.race_id
        LEFT JOIN Heats h ON r.heat_id = h.heat_id
        JOIN CountedRaces cr ON cr.race_id = sc.race_id
        WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying'
          AND sc.race_id IS NOT NULL
        GROUP BY lb.boat_id
        -- Boats that remain tied share a place. No rule orders them for the
        -- fleet split, so fall back to boat_id purely to make the split
        -- repeatable (the same data always gives the same fleets).
        ORDER BY lb.place ASC, lb.boat_id ASC`,
      )
      .all(event_id, event_id) as Array<{
      boat_id: number;
      race_points: string | null;
      race_statuses: string | null;
    }>;

    if (leaderboard.length === 0) {
      throw new Error(NO_QUALIFYING_RESULTS_REFUSAL);
    }

    const qualifyingDiscardConfig = getEventDiscardConfig(
      event_id,
      'qualifying',
    );
    const adjustedLeaderboard = buildAdjustedFleetLeaderboard(
      leaderboard,
      qualifyingDiscardConfig,
      apply_shrs43_temporary_second_discard === true,
    );
    const overflowPolicy = getEventHeatOverflowPolicy(event_id);
    const plan = planFinalFleets(
      adjustedLeaderboard,
      findWithdrawnBoatIds(leaderboard),
      numFinalHeats,
      overflowPolicy,
      Boolean(allow_oversize_confirm),
    );
    if (!plan.ok) {
      throw new Error(plan.refusal);
    }

    const { insertHeatStmt, insertHeatBoatStmt } = prepareHeatWriters();
    const transaction = db.transaction(() => {
      const insertedFinalHeatIds = plan.fleets.map((_fleet, i) => {
        // SHRS 4.1 fleet naming, shared with the ranking precedence used by
        // the leaderboard reads so "Fleet 5" is always ranked 5th (RULE-m2).
        const insertResult = insertHeatStmt.run(
          event_id,
          `Final ${fleetNameForIndex(i)}`,
          'Final',
        );
        return Number(insertResult.lastInsertRowid);
      });

      plan.fleets.forEach((fleet, i) => {
        fleet.forEach((boatId) => {
          insertHeatBoatStmt.run(insertedFinalHeatIds[i], boatId);
        });
      });

      return {
        success: true,
        createdHeats: insertedFinalHeatIds.length,
        assignedBoats: adjustedLeaderboard.length,
        overflowPolicy,
      };
    });

    return transaction();
  },
);
