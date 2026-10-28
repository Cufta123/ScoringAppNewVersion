import { db } from '../../../public/Database/DBManager';
import handle from './handle';
import { findLatestHeatsBySuffix } from '../functions/creatingNewHeatsUtls';
import { getEventDiscardConfig } from '../functions/discardConfig';
import { fleetNameForIndex } from '../../shared/fleetNames';
import refreshStandings from '../functions/standings';
import { getRaceCountForHeat } from '../functions/heatQueries';
import {
  SHRS_MAX_BOATS_PER_HEAT,
  getEventHeatOverflowPolicy,
} from '../functions/eventSettings';
import buildAdjustedFleetLeaderboard from '../functions/fleetTotals';
import prepareHeatWriters from '../functions/heatWriters';

handle(
  'startFinalSeriesAtomic',
  async (
    _event,
    event_id,
    allow_oversize_confirm = false,
    apply_shrs43_temporary_second_discard = true,
  ) => {
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
      throw new Error(
        'Cannot start the Final Series: there are no qualifying results yet. Score the qualifying races first.',
      );
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
    const withdrawnBoatIds = new Set(
      leaderboard
        .filter((boat) => {
          const statuses = boat.race_statuses
            ? boat.race_statuses.split(',')
            : [];
          return statuses.some((s) => s.trim().toUpperCase() === 'WTH');
        })
        .map((boat) => boat.boat_id),
    );

    adjustedLeaderboard.sort((left, right) => {
      const leftWithdrawn = withdrawnBoatIds.has(left.boat_id);
      const rightWithdrawn = withdrawnBoatIds.has(right.boat_id);
      if (leftWithdrawn !== rightWithdrawn) {
        return leftWithdrawn ? 1 : -1;
      }
      return left.totalPoints - right.totalPoints;
    });

    const overflowPolicy = getEventHeatOverflowPolicy(event_id);
    let finalHeatCount = numFinalHeats;
    if (adjustedLeaderboard.length > finalHeatCount * SHRS_MAX_BOATS_PER_HEAT) {
      if (overflowPolicy === 'auto-increase') {
        finalHeatCount = Math.ceil(
          adjustedLeaderboard.length / SHRS_MAX_BOATS_PER_HEAT,
        );
      } else if (!allow_oversize_confirm) {
        throw new Error(
          `Final fleets would exceed ${SHRS_MAX_BOATS_PER_HEAT} boats. Confirm oversize to continue or switch event policy to auto-increase heats.`,
        );
      }
    }

    // RULE-M23 / SHRS 4.1: never create more final fleets than there are
    // boats, and reduce the fleet count when withdrawals allow ("the number
    // of Final Series Fleets may be reduced"). Without this, `boatsPerFleet`
    // floors to 0 and the trailing fleets are created empty (0 boats), which
    // violates 4.1's "as equal as possible" and leaves stray empty final
    // heats.
    finalHeatCount = Math.min(finalHeatCount, adjustedLeaderboard.length);

    const boatsPerFleet = Math.floor(
      adjustedLeaderboard.length / finalHeatCount,
    );
    const extraBoats = adjustedLeaderboard.length % finalHeatCount;
    const { insertHeatStmt, insertHeatBoatStmt } = prepareHeatWriters();
    const transaction = db.transaction(() => {
      const insertedFinalHeatIds: number[] = [];
      for (let i = 0; i < finalHeatCount; i += 1) {
        // SHRS 4.1 fleet naming, shared with the ranking precedence used by
        // the leaderboard reads so "Fleet 5" is always ranked 5th (RULE-m2).
        const fleetName = fleetNameForIndex(i);
        const insertResult = insertHeatStmt.run(
          event_id,
          `Final ${fleetName}`,
          'Final',
        );
        insertedFinalHeatIds.push(Number(insertResult.lastInsertRowid));
      }

      let boatIndex = 0;
      for (let i = 0; i < insertedFinalHeatIds.length; i += 1) {
        const boatsInFleet = boatsPerFleet + (i < extraBoats ? 1 : 0);
        const fleetSlice = adjustedLeaderboard.slice(
          boatIndex,
          boatIndex + boatsInFleet,
        );
        boatIndex += boatsInFleet;

        fleetSlice.forEach((boat) => {
          insertHeatBoatStmt.run(insertedFinalHeatIds[i], boat.boat_id);
        });
      }

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
