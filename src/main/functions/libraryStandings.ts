/**
 * The standings the leaderboard reads return, worked out by regatta-core
 * from the event's decision log (phase 2 of docs/regatta-core-switch.md).
 *
 * The rows keep the shape the screens read: the boat columns, and per race
 * the comma-joined place, points, race id, status and kept place. Places,
 * totals and every race's points come from the library; the place, status
 * and kept place shown in a race come from the stored result (what the
 * race office and the committee entered), which the library scores.
 */
import {
  finalStandings,
  overallStandings,
  qualifyingStandings,
  replay,
  type EventState,
  type RaceRef,
} from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import { eventToLog } from './eventLog';
import { getHeatRoundFromName } from '../../shared/heatNames';
import type { PendingRace } from '../../shared/raceProgress';

/** The event replayed from its tables, with the app's race ids. */
export function replayEvent(eventId: number) {
  const log = eventToLog(eventId);
  const result = replay(log.decisions);
  if (!result.ok) {
    throw new Error(
      `The results of this event cannot be worked out: ${result.reason}`,
    );
  }
  const raceIds = new Map<string, number>();
  log.races.forEach((ref, raceId) =>
    raceIds.set(`${ref.heat}#${ref.race}`, raceId),
  );
  return {
    state: result.state as EventState,
    log,
    raceIdOf: (ref: RaceRef) => raceIds.get(`${ref.heat}#${ref.race}`),
  };
}

interface StoredCell {
  race_id: number;
  position: number | null;
  status: string;
  held_place: number | null;
}

interface BoatColumns {
  boat_id: number;
  boat_number: string | number | null;
  boat_type: string | null;
  name: string | null;
  surname: string | null;
  country: string | null;
}

function boatColumns(eventId: number) {
  const rows = db
    .prepare(
      `SELECT b.boat_id, b.sail_number AS boat_number, b.model AS boat_type,
              s.name, s.surname, b.country
       FROM Boat_Event be
       JOIN Boats b ON b.boat_id = be.boat_id
       LEFT JOIN Sailors s ON s.sailor_id = b.sailor_id
       WHERE be.event_id = ?`,
    )
    .all(eventId) as BoatColumns[];
  const byId = new Map(rows.map((row) => [String(row.boat_id), row]));
  return (boat: string): BoatColumns =>
    byId.get(boat) ?? {
      boat_id: Number(boat),
      boat_number: null,
      boat_type: null,
      name: null,
      surname: null,
      country: null,
    };
}

/** Every stored result of the event, by race id and boat, and by round. */
function storedCells(eventId: number) {
  const rows = db
    .prepare(
      `SELECT sc.race_id, sc.boat_id, sc.position, COALESCE(sc.status, 'DNS') AS status,
              sc.held_place, r.race_number, h.heat_name, h.heat_type
       FROM Scores sc
       JOIN Races r ON r.race_id = sc.race_id
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE h.event_id = ?`,
    )
    .all(eventId) as (StoredCell & {
    boat_id: number;
    race_number: number;
    heat_name: string;
    heat_type: string;
  })[];
  const byRace = new Map<string, StoredCell>();
  const byRound = new Map<string, StoredCell>();
  rows.forEach((row) => {
    byRace.set(`${row.race_id}|${row.boat_id}`, row);
    if (row.heat_type === 'Qualifying') {
      const round = getHeatRoundFromName(row.heat_name) || 1;
      byRound.set(`${round}#${row.race_number}|${row.boat_id}`, row);
    }
  });
  return { byRace, byRound };
}

type Score = {
  ref: RaceRef | null;
  round: number;
  raceNumber: number;
  points: number;
};

/** The per-race columns for a boat's scores, in race order. */
function raceColumns(
  boat: string,
  scores: Score[],
  raceIdOf: (ref: RaceRef) => number | undefined,
  cells: ReturnType<typeof storedCells>,
) {
  const columns = scores.map((score) => {
    const raceId = score.ref ? raceIdOf(score.ref) : undefined;
    // A race she had no heat in: the app files her DNC under one of the
    // round's races.
    const cell =
      raceId !== undefined
        ? cells.byRace.get(`${raceId}|${boat}`)
        : cells.byRound.get(`${score.round}#${score.raceNumber}|${boat}`);
    return {
      race_id: cell?.race_id ?? raceId ?? '',
      position: cell?.position ?? '',
      status: cell?.status ?? 'DNC',
      held_place: cell?.held_place ?? '',
      points: score.points,
    };
  });
  const join = (key: keyof (typeof columns)[number]) =>
    columns.length === 0 ? null : columns.map((c) => c[key]).join(',');
  return {
    race_positions: join('position'),
    race_points: join('points'),
    race_ids: join('race_id'),
    race_statuses: join('status'),
    race_held_places: join('held_place'),
  };
}

/** readLeaderboard: the Qualifying Series (or the one-fleet event). */
export function qualifyingRows(eventId: number) {
  const { state, raceIdOf } = replayEvent(eventId);
  const boat = boatColumns(eventId);
  const cells = storedCells(eventId);
  const { standings, pending } = qualifyingStandings(state);
  return standings.map((standing) => ({
    ...boat(standing.boat),
    total_points_event: standing.total,
    place: standing.place,
    ...raceColumns(standing.boat, standing.scores, raceIdOf, cells),
    // Races of the round still being sailed (each boat sailed them in her
    // own heat, so each has a race).
    pending_races: (pending[standing.boat] ?? []).map((score): PendingRace => {
      const raceId = raceIdOf(score.ref!)!;
      const cell = cells.byRace.get(`${raceId}|${standing.boat}`);
      return {
        boat_id: Number(standing.boat),
        race_id: raceId,
        position: Number(cell?.position ?? 0),
        points: score.points,
        status: cell?.status ?? 'DNS',
        heat_name: `Heat ${score.ref!.heat}`,
        race_number: score.ref!.race,
      };
    }),
  }));
}

/** readFinalLeaderboard: every fleet, Gold first, each in its order. */
export function finalRows(eventId: number) {
  const { state, raceIdOf } = replayEvent(eventId);
  const boat = boatColumns(eventId);
  const cells = storedCells(eventId);
  const qualifying = new Map(
    qualifyingStandings(state).standings.map((s) => [s.boat, s.total]),
  );
  return finalStandings(state).flatMap((fleet) =>
    fleet.standings.map((standing) => ({
      ...boat(standing.boat),
      total_points_final: standing.total,
      event_id: eventId,
      placement_group: fleet.fleet,
      qualifying_points: qualifying.get(standing.boat) ?? 0,
      ...raceColumns(standing.boat, standing.scores, raceIdOf, cells),
    })),
  );
}

/** readOverallLeaderboard: qualifying until a final race is sailed (1.5). */
export function overallRows(eventId: number) {
  const { state } = replayEvent(eventId);
  const boat = boatColumns(eventId);
  const finalRaced = (state.fleets ?? []).some((f) => f.races.length > 0);
  if (!finalRaced) {
    return qualifyingStandings(state).standings.map((standing) => ({
      ...boat(standing.boat),
      overall_points: standing.total,
      place: standing.place,
      placement_group: 'Qualifying',
    }));
  }
  const fleetPlace = new Map(
    finalStandings(state).flatMap((fleet) =>
      fleet.standings.map((s) => [s.boat, s.place]),
    ),
  );
  return overallStandings(state).map((row) => ({
    ...boat(row.boat),
    qualifying_points: row.qualifying,
    final_points: row.final,
    overall_points: row.total,
    placement_group: row.fleet ?? '',
    final_place: fleetPlace.get(row.boat) ?? null,
    overall_rank: row.place,
  }));
}
