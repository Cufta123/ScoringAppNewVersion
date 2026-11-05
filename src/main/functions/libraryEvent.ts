/**
 * Event facts the screens ask for, worked out by regatta-core from the
 * event's decision log (phase 2 of docs/regatta-core-switch.md): the
 * largest heat (SHRS 5.2) and whether the Final Series can start.
 */
import { qualifyingStandings } from 'regatta-core';
import type { FinalSeriesEligibility } from '../../shared/finalSeriesEligibility';
import { replayEvent } from './libraryStandings';

/** SHRS 5.2: the boats in the largest heat of the series (or of both). */
export function largestHeat(eventId: number, heatType?: string): number {
  const { state } = replayEvent(eventId);
  let heats = [...state.rounds.flat(), ...(state.fleets ?? [])];
  if (heatType === 'Final') heats = state.fleets ?? [];
  if (heatType === 'Qualifying') heats = state.rounds.flat();
  return heats.reduce((max, heat) => Math.max(max, heat.boats.length), 0);
}

/**
 * Whether the Final Series can start (SHRS 1.1, 4.1-4.3), in the shape the
 * Scoring page reads. A heat with no boats holds nothing (as in the
 * standings): it does not make a round's race counts unequal.
 */
export function finalSeriesEligibility(
  eventId: number,
): FinalSeriesEligibility {
  const empty = {
    numFinalHeats: 0,
    completedQualifyingRaces: 0,
    rule43Applies: false,
    noRacesCompleted: true,
    latestRoundUnsailed: false,
    latestRoundNumber: null as number | null,
    raceCountBreakdown: [] as { name: string; count: number }[],
  };
  const { state } = replayEvent(eventId);
  if (state.rounds.length === 0) {
    return { ok: false, reason: 'NO_HEATS', ...empty };
  }
  const round = state.rounds[state.rounds.length - 1];
  const numFinalHeats = round.length;
  if (numFinalHeats < 2) {
    return { ok: false, reason: 'SINGLE_FLEET', ...empty, numFinalHeats };
  }
  const sailing = round.filter((heat) => heat.boats.length > 0);
  const raceCountBreakdown = sailing.map((heat) => ({
    name: `Heat ${heat.id}`,
    count: heat.races.length,
  }));
  const counts = [...new Set(raceCountBreakdown.map((row) => row.count))];
  if (counts.length > 1) {
    return {
      ok: false,
      reason: 'UNEQUAL_RACE_COUNTS',
      ...empty,
      numFinalHeats,
      raceCountBreakdown,
    };
  }
  const completedQualifyingRaces = qualifyingStandings(state).completedRaces;
  if (completedQualifyingRaces === 0) {
    return {
      ok: false,
      reason: 'NO_RACES_COMPLETED',
      ...empty,
      numFinalHeats,
      raceCountBreakdown,
    };
  }
  const latestRoundUnsailed = (counts[0] ?? 0) === 0;
  if (latestRoundUnsailed) {
    // Parity R7: the fleets are split from the qualifying series as sailed;
    // a round built but not sailed is undone (or sailed) first.
    return {
      ok: false,
      reason: 'LATEST_ROUND_UNSAILED',
      ...empty,
      numFinalHeats,
      completedQualifyingRaces,
      noRacesCompleted: false,
      latestRoundUnsailed: true,
      latestRoundNumber: round[0]?.round ?? null,
      raceCountBreakdown,
    };
  }
  return {
    ok: true,
    reason: 'OK',
    numFinalHeats,
    completedQualifyingRaces,
    // SHRS 4.3: more than five but less than eight completed races.
    rule43Applies: completedQualifyingRaces > 5 && completedQualifyingRaces < 8,
    noRacesCompleted: false,
    latestRoundUnsailed: false,
    latestRoundNumber: round[0]?.round ?? null,
    raceCountBreakdown,
  };
}
