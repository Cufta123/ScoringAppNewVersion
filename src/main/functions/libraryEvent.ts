/**
 * Event facts the screens ask for, worked out by regatta-core from the
 * event's decision log: the largest heat (SHRS 5.2), and where the event
 * stands with what may be done now (`eventStatus`: the round bar, the heat
 * cards' buttons, Undo round, Start Final Series and its eligibility).
 */
import {
  eventStatus,
  type EventState,
  type FinalSeriesStatus,
  type Heat,
  type Offer,
} from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import type { FinalSeriesEligibility } from '../../shared/finalSeriesEligibility';
import type {
  EventStatusView,
  StatusAction,
  StatusNextStep,
} from '../../shared/eventStatus';
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
 * The library's verdict on the Final Series (SHRS 1.1, 4.1-4.3) in the
 * shape the Scoring page words its questions from. The library decides;
 * this only names the heats as the screen does.
 */
export function toEligibility(
  start: FinalSeriesStatus,
  round: number | null,
): FinalSeriesEligibility {
  const ran = start.completedRaces > 0;
  return {
    ok: start.ok,
    reason: start.check,
    numFinalHeats: start.check === 'NO_HEATS' ? 0 : start.fleets,
    completedQualifyingRaces: start.completedRaces,
    rule43Applies: start.ok && start.rule43,
    noRacesCompleted: !ran,
    latestRoundUnsailed: start.check === 'LATEST_ROUND_UNSAILED',
    latestRoundNumber: round,
    raceCountBreakdown: start.raceCounts.map((row) => ({
      name: `Heat ${row.heat}`,
      count: row.races,
    })),
    ...(start.ok ? {} : { message: start.reason }),
  };
}

/** The qualifying round the eligibility talks about (the latest one). */
const latestRound = (state: EventState) =>
  state.rounds.length > 0 ? state.rounds.length : null;

/** Whether the Final Series can start: `readEventStatus`'s `startFinal`. */
export function finalSeriesEligibility(
  eventId: number,
): FinalSeriesEligibility {
  const { state } = replayEvent(eventId);
  return toEligibility(eventStatus(state).startFinal, latestRound(state));
}

const heatName = (heat: Pick<Heat, 'id' | 'series'>) =>
  heat.series === 'final' ? `Final ${heat.id}` : `Heat ${heat.id}`;

const action = (offer: Offer): StatusAction =>
  offer.ok
    ? { ok: true, offered: offer.offered }
    : { ok: false, offered: offer.offered, reason: offer.reason };

/**
 * `readEventStatus`: regatta-core's `eventStatus` on the event's log, with
 * its heats named by the app's heat ids (the projection of the same log).
 */
export function readEventStatus(eventId: number): EventStatusView {
  const { state } = replayEvent(eventId);
  const status = eventStatus(state);
  const ids = new Map(
    (
      db
        .prepare('SELECT heat_id, heat_name FROM Heats WHERE event_id = ?')
        .all(eventId) as { heat_id: number; heat_name: string }[]
    ).map((row) => [row.heat_name, Number(row.heat_id)]),
  );
  const series = (id: string) =>
    status.heats.find((heat) => heat.heat === id)?.series ?? 'qualifying';
  const named = (id: string) => {
    const name = heatName({ id, series: series(id) });
    const heatId = ids.get(name);
    if (heatId === undefined) {
      throw new Error(
        `${name} is in the results but not in the heats on this computer. Reload the page.`,
      );
    }
    return { heat_id: heatId, heat_name: name };
  };
  const { next } = status;
  let nextStep: StatusNextStep;
  if (next.kind === 'score') {
    nextStep = { kind: 'score', ...named(next.heat), race: next.race };
  } else {
    nextStep = next;
  }
  return {
    series: status.series,
    round: status.round,
    heats: status.heats.map((heat) => ({
      ...named(heat.heat),
      boat_ids: heat.boats.map(Number),
      races: heat.races,
      score: action(heat.score),
      undoRace: action(heat.undoRace),
    })),
    next: nextStep,
    createRound: action(status.createRound),
    undoRound: action(status.undoRound),
    startFinal: {
      ...action(status.startFinal),
      eligibility: toEligibility(status.startFinal, latestRound(state)),
    },
  };
}
