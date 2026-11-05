import { qualifyingStandings, replay, type Decision } from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import handle from './handle';
import { findLatestHeatsBySuffix } from '../functions/creatingNewHeatsUtls';
import { countQualifyingGroups } from '../../shared/heatNames';
import { getRaceCountForHeat } from '../functions/heatQueries';
import {
  SHRS_MAX_BOATS_PER_HEAT,
  getEventHeatOverflowPolicy,
} from '../functions/eventSettings';
import { NO_QUALIFYING_RESULTS_REFUSAL } from '../functions/finalFleetPlan';
import { applyToEvent, currentEvent } from '../functions/libraryWrite';

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

    // Full base letters ("Heat AA1" -> "AA"): a single-letter match would
    // collapse multi-letter bases together.
    const numFinalHeats = countQualifyingGroups(qualifyingHeats);

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
    // Parity R7: the split is made from the round as sailed. A round
    // built but not sailed yet is taken back first.
    const { log, state } = currentEvent(event_id);
    const latest = state.rounds[state.rounds.length - 1] ?? [];
    if (
      state.rounds.length > 1 &&
      latest.every((heat) => heat.races.length === 0)
    ) {
      throw new Error(
        `Round ${state.rounds.length} has been built but not sailed. Undo that round first (Undo round on the Scoring page), then start the Final Series.`,
      );
    }
    if (qualifyingStandings(state).completedRaces === 0) {
      throw new Error(NO_QUALIFYING_RESULTS_REFUSAL);
    }

    // The split (SHRS 4.1-4.3) is regatta-core's. Fleets over 20 boats
    // (SHRS 2.3) need the race officer's word when the event asks for it.
    const decision: Decision = {
      type: 'finalSeriesStarted',
      rule43: apply_shrs43_temporary_second_discard === true,
    };
    const trial = replay([...log, decision]);
    if (!trial.ok) throw new Error(trial.reason);
    const overflowPolicy = getEventHeatOverflowPolicy(event_id);
    const oversize = (trial.state.fleets ?? []).some(
      (fleet) => fleet.boats.length > SHRS_MAX_BOATS_PER_HEAT,
    );
    if (oversize && !allow_oversize_confirm) {
      throw new Error(
        `Final fleets would exceed ${SHRS_MAX_BOATS_PER_HEAT} boats. Confirm oversize to continue or switch event policy to auto-increase heats.`,
      );
    }

    const { after } = applyToEvent(event_id, { decide: () => [decision] });
    const fleets = after.fleets ?? [];
    return {
      success: true,
      createdHeats: fleets.length,
      assignedBoats: fleets.reduce((n, fleet) => n + fleet.boats.length, 0),
      overflowPolicy,
    };
  },
);
