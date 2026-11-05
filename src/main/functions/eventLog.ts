/**
 * An event's tables as a regatta-core decision log, and the check that the
 * log gives back the same heats and scores.
 *
 * The tables keep the event's current state, not its history, so the log
 * built here is a record that leads to that state: the settings, the
 * entries, each round's heats as they were made, every race sheet, the
 * protest committee's decisions beside them, and the Final split. What the
 * tables do not say directly is read the way the app reads it:
 *
 * - The race office's sheet scores what the tables hold: finishers at their
 *   stored places (after any RRS A6.1 move-up), an RDG / DPI boat at the
 *   place she kept (held_place, A6.2), and a boat the committee
 *   disqualified put back at her place before the decision, from the SHRS
 *   3.1(5) freeze (RaceAssignmentSnapshots).
 * - DSQ / DNE / DGM with a frozen row are protest decisions (the app froze
 *   the order for them); without one they are the race office's code (an
 *   umpire's DSQ, SHRS 3.1(iii)). RDG and DPI are always the committee's.
 * - Boats level on a stored place tied at the finish (RRS A7); an RDG / DPI
 *   boat on that place was in the tie when the finisher's stored points
 *   are shared with her.
 * - A boat joins a heat before the first race she has a result in.
 * - The Final split is the rules' split with SHRS 4.3 on or off, whichever
 *   gives the stored fleets, else the fleets as made.
 *
 * `anomalies` lists what the rules cannot express exactly (a gap in the
 * places, a result for a boat listed in no heat, a kept place a later
 * correction gave to another boat): there the log's scores can differ from
 * the tables, and the migration must say so. `checkEventLog` replays the
 * log and compares every heat and every score with the tables.
 */
import {
  NO_PLACE_CODES,
  replay,
  qualifyingStandings,
  finalStandings,
  type Boat,
  type BoatId,
  type Decision,
  type DiscardProfile,
  type NoPlaceCode,
  type PenaltyCode,
  type ProtestOutcome,
  type RaceLine,
  type RaceRef,
} from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import {
  normalizeHeatOverflowPolicy,
  normalizeQualifyingAssignmentMode,
} from '../../shared/eventSettings';
import { normalizeDiscardConfig } from '../../shared/discardProfile';
import { getHeatRoundFromName } from '../../shared/heatNames';
import { fleetRank } from '../../shared/fleetNames';
import { normalizeScoreStatus } from './scoreStatus';

interface HeatRow {
  heat_id: number;
  heat_name: string;
  heat_type: string;
}
interface ScoreRow {
  race_id: number;
  boat_id: number;
  position: number;
  points: number;
  status: string;
  held_place: number | null;
  rdg_race_ids: string | null;
}

const PENALTIES = new Set(['ZFP', 'SCP', 'T1']);
const NO_PLACE = new Set<string>(NO_PLACE_CODES);
const COMMITTEE_DSQ = new Set(['DSQ', 'DNE', 'DGM']);
const REDRESS = new Set(['RDG1', 'RDG2', 'RDG3']);
const finisher = (status: string) =>
  status === 'FINISHED' || PENALTIES.has(status);

/** "Heat A1" -> "A1", "Final Gold" -> "Gold". */
export const coreHeatId = (name: string) =>
  name.replace(/^(Heat|Final)\s+/, '');

const id = (boatId: number) => String(boatId);

function discardProfile(stored: unknown): DiscardProfile {
  const config = normalizeDiscardConfig(stored);
  if (config.neverDiscard) return { kind: 'none' };
  if (config.thresholds && config.thresholds.length > 0) {
    return { kind: 'thresholds', at: [...config.thresholds] };
  }
  const { firstDiscardAt, secondDiscardAt, additionalEvery } = config;
  if (firstDiscardAt === 4 && secondDiscardAt === 8 && additionalEvery === 8) {
    return { kind: 'standard' };
  }
  return {
    kind: 'custom',
    first: firstDiscardAt,
    second: secondDiscardAt,
    every: additionalEvery,
  };
}

export interface EventLog {
  decisions: Decision[];
  /** How the record was read (no effect on any score). */
  notes: string[];
  /** What the rules cannot express exactly: scores there may differ. */
  anomalies: string[];
  /** App race ids behind the library's race names. */
  races: Map<number, RaceRef>;
}

/** The event's tables as a decision log. */
export function eventToLog(eventId: number): EventLog {
  const notes: string[] = [];
  const anomalies: string[] = [];
  const decisions: Decision[] = [];

  const event = db
    .prepare(
      `SELECT shrs_qualifying_assignment_mode AS mode,
              shrs_discard_profile_qualifying AS q,
              shrs_discard_profile_final AS f,
              shrs_heat_overflow_policy AS overflow
       FROM Events WHERE event_id = ?`,
    )
    .get(eventId) as
    | { mode: string; q: string; f: string; overflow: string }
    | undefined;
  if (!event) throw new Error(`There is no event ${eventId}.`);
  decisions.push({
    type: 'settingsChanged',
    settings: {
      qualifyingMode: normalizeQualifyingAssignmentMode(event.mode),
      discards: {
        qualifying: discardProfile(event.q),
        final: discardProfile(event.f),
      },
      finalOverflow:
        normalizeHeatOverflowPolicy(event.overflow) === 'auto-increase'
          ? 'add-fleets'
          : 'allow-oversize',
    },
  });

  const entries = db
    .prepare(
      `SELECT b.boat_id, b.country, b.sail_number,
              TRIM(COALESCE(s.name, '') || ' ' || COALESCE(s.surname, '')) AS name
       FROM Boat_Event be
       JOIN Boats b ON b.boat_id = be.boat_id
       LEFT JOIN Sailors s ON s.sailor_id = b.sailor_id
       WHERE be.event_id = ?
       ORDER BY be.boat_event_id`,
    )
    .all(eventId) as {
    boat_id: number;
    country: string;
    sail_number: number | string;
    name: string;
  }[];
  const boatOf = new Map<BoatId, Boat>(
    entries.map((row) => [
      id(row.boat_id),
      {
        id: id(row.boat_id),
        nat: String(row.country ?? '').trim(),
        sail: String(row.sail_number ?? '').trim(),
        ...(row.name ? { name: row.name } : {}),
      },
    ]),
  );
  const entered = new Set<BoatId>();
  const enter = (boatId: BoatId) => {
    if (entered.has(boatId)) return;
    const boat = boatOf.get(boatId);
    if (!boat) {
      anomalies.push(`${boatId} has results but is not entered.`);
      return;
    }
    entered.add(boatId);
    decisions.push({ type: 'boatEntered', boat });
  };

  const heats = db
    .prepare(
      `SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?
       ORDER BY heat_id`,
    )
    .all(eventId) as HeatRow[];
  const listed = new Map<number, BoatId[]>(
    heats.map((heat) => [
      heat.heat_id,
      (
        db
          .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
          .all(heat.heat_id) as { boat_id: number }[]
      ).map((row) => id(row.boat_id)),
    ]),
  );
  const racesOf = (heatId: number) =>
    db
      .prepare(
        'SELECT race_id, race_number FROM Races WHERE heat_id = ? ORDER BY race_number',
      )
      .all(heatId) as { race_id: number; race_number: number }[];
  const scoresOf = (raceId: number) =>
    db
      .prepare(
        `SELECT race_id, boat_id, position, points, status, held_place, rdg_race_ids
         FROM Scores WHERE race_id = ?`,
      )
      .all(raceId) as ScoreRow[];
  const frozenOf = (raceId: number) => {
    try {
      return new Map(
        (
          db
            .prepare(
              `SELECT boat_id, frozen_position, frozen_status
               FROM RaceAssignmentSnapshots WHERE race_id = ?`,
            )
            .all(raceId) as {
            boat_id: number;
            frozen_position: number | null;
            frozen_status: string | null;
          }[]
        ).map((row) => [id(row.boat_id), row]),
      );
    } catch {
      return new Map(); // an older database without the table
    }
  };

  /**
   * A heat's boats and, for each, the first of its races she has a result
   * in (0: none). A boat with a result other than DNC or redress in a heat
   * she is not listed in sailed it as far as the results say: she is one
   * of its boats here.
   */
  const crewOf = (heat: HeatRow) => {
    const races = racesOf(heat.heat_id);
    const first = new Map<BoatId, number>(
      listed.get(heat.heat_id)!.map((b) => [b, 0]),
    );
    races.forEach((raceRow, n) =>
      scoresOf(raceRow.race_id).forEach((row) => {
        const boatId = id(row.boat_id);
        const status = normalizeScoreStatus(row.status);
        if (!first.has(boatId)) {
          if (status === 'DNC' || REDRESS.has(status)) return; // no heat
          anomalies.push(
            `${coreHeatId(heat.heat_name)}: ${boatId} has a result in it (${status}) but is not listed in the heat; the log puts her in it.`,
          );
          first.set(boatId, n + 1);
          return;
        }
        if (first.get(boatId) === 0) first.set(boatId, n + 1);
      }),
    );
    return { races, first };
  };

  const raceRefs = new Map<number, RaceRef>();
  const pending: { make: () => Decision; after: Set<number> }[] = [];

  function rdgRaces(row: ScoreRow): number[] {
    if (!row.rdg_race_ids) return [];
    try {
      const parsed = JSON.parse(row.rdg_race_ids);
      return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
      return [];
    }
  }

  function outcomeOf(status: string, row: ScoreRow): ProtestOutcome {
    switch (status) {
      case 'RDG1':
        return { kind: 'RDG1' };
      case 'RDG2':
        // A chosen race that no longer exists (undone) is left out, as the
        // app's average does.
        return {
          kind: 'RDG2',
          races: rdgRaces(row)
            .map((raceId) => raceRefs.get(raceId))
            .filter((ref): ref is RaceRef => ref !== undefined),
        };
      case 'RDG3':
        return { kind: 'RDG3', points: Number(row.points) };
      case 'DPI':
        return { kind: 'DPI', points: Number(row.points) };
      default:
        return { kind: status as 'DSQ' | 'DNE' | 'DGM' };
    }
  }

  /** A committee decision, emitted once every race it names is in the log. */
  const decide = (
    ref: RaceRef,
    boatId: string,
    status: string,
    row: ScoreRow,
  ) =>
    pending.push({
      make: () => ({
        type: 'protestDecided',
        race: ref,
        boat: boatId,
        outcome: outcomeOf(status, row),
      }),
      after: new Set([row.race_id, ...rdgRaces(row)]),
    });

  const flush = (all = false) => {
    for (let i = 0; i < pending.length; ) {
      const { make, after } = pending[i];
      if (all || [...after].every((raceId) => raceRefs.has(raceId))) {
        const decision = make();
        // A boat with no heat at all is entered before her first decision.
        if (decision.type === 'protestDecided') enter(decision.boat);
        decisions.push(decision);
        pending.splice(i, 1);
      } else {
        i += 1;
      }
    }
  };

  /** One race: the race office's sheet, the committee's decisions beside. */
  const scoreRace = (
    heat: HeatRow,
    raceId: number,
    race: number,
    members: Set<BoatId>,
  ) => {
    const ref: RaceRef = { heat: coreHeatId(heat.heat_name), race };
    raceRefs.set(raceId, ref);
    const frozen = frozenOf(raceId);
    const rows = scoresOf(raceId);

    type Entry = {
      boat: string;
      place: number;
      penalty?: string;
      points: number;
      /** At her stored place (not put back after a committee DSQ). */
      live: boolean;
      /** RDG / DPI: her points are the committee's, not the place's. */
      committee?: boolean;
    };
    const live: Entry[] = [];
    const putBack: Entry[] = [];
    const coded: { boat: string; code: string }[] = [];
    rows.forEach((row) => {
      const boatId = id(row.boat_id);
      const status = normalizeScoreStatus(row.status);
      if (!members.has(boatId)) {
        // A boat with no heat in this race: DNC, or redress for it (R12).
        if (REDRESS.has(status)) decide(ref, boatId, status, row);
        return;
      }
      const ice = frozen.get(boatId);
      const was = ice ? normalizeScoreStatus(ice.frozen_status) : undefined;
      const points = Number(row.points);
      if (COMMITTEE_DSQ.has(status) && ice) {
        if (was && finisher(was)) {
          putBack.push({
            boat: boatId,
            place: Number(ice.frozen_position),
            ...(PENALTIES.has(was) ? { penalty: was } : {}),
            points,
            live: false,
          });
        } else {
          coded.push({
            boat: boatId,
            code: was && NO_PLACE.has(was) ? was : 'DNF',
          });
        }
        decide(ref, boatId, status, row);
      } else if (REDRESS.has(status) || status === 'DPI') {
        const kept =
          row.held_place ??
          (ice && was && finisher(was) ? ice.frozen_position : null);
        if (kept != null) {
          live.push({
            boat: boatId,
            place: Number(kept),
            points,
            live: true,
            committee: true,
          });
        } else if (was && NO_PLACE.has(was)) {
          coded.push({ boat: boatId, code: was });
        } else {
          notes.push(
            `${ref.heat} race ${race}: ${boatId} has ${status} with no result recorded before it; DNF on the sheet (her points are the committee's).`,
          );
          coded.push({ boat: boatId, code: 'DNF' });
        }
        decide(ref, boatId, status, row);
      } else if (finisher(status)) {
        live.push({
          boat: boatId,
          place: Number(row.position),
          ...(PENALTIES.has(status) ? { penalty: status } : {}),
          points,
          live: true,
        });
      } else if (NO_PLACE.has(status)) {
        coded.push({ boat: boatId, code: status });
      } else {
        anomalies.push(
          `${ref.heat} race ${race}: ${boatId} has the unknown result ${status}; DNF on the sheet.`,
        );
        coded.push({ boat: boatId, code: 'DNF' });
      }
    });

    // Finishers level on a place tied (RRS A7). An RDG / DPI boat on the
    // same place was in the tie if the finishers' stored points are shared
    // with her; otherwise a later correction gave her kept place to them,
    // and she follows the finishers.
    const byPlace = new Map<number, Entry[]>();
    live.forEach((entry) =>
      byPlace.set(entry.place, [...(byPlace.get(entry.place) ?? []), entry]),
    );
    const tiedWith = new Map<Entry, boolean>();
    byPlace.forEach((group, place) => {
      const plain = group.filter((e) => !e.committee);
      const committee = group.filter((e) => e.committee);
      const scored = plain.find((e) => !e.penalty);
      const size = scored
        ? Math.round(2 * (scored.points - place) + 1)
        : plain.length;
      const join = Math.max(0, Math.min(committee.length, size - plain.length));
      committee.forEach((entry, i) => {
        if (plain.length > 0 && i >= join) {
          anomalies.push(
            `${ref.heat} race ${race}: ${entry.boat}'s kept place ${place} went to another boat in a later correction; she follows the finishers on the sheet.`,
          );
          // eslint-disable-next-line no-param-reassign
          entry.place = Number.MAX_SAFE_INTEGER;
        }
      });
      group.forEach((entry) => tiedWith.set(entry, group.length > 1));
    });
    const order: (Entry & { at: number })[] = live
      .sort(
        (a, b) =>
          a.place - b.place ||
          Number(Boolean(a.committee)) - Number(Boolean(b.committee)) ||
          a.boat.localeCompare(b.boat, undefined, { numeric: true }),
      )
      .map((entry) => ({ ...entry, at: entry.place }));
    putBack
      .sort((a, b) => a.place - b.place)
      .forEach((entry) => {
        const index = order.findIndex((other) => other.at >= entry.place);
        const at = index === -1 ? order.length : index;
        order.splice(at, 0, { ...entry, at: entry.place });
        for (let j = at + 1; j < order.length; j += 1) order[j].at += 1;
      });

    // Stored places with a gap the sheet cannot hold (older records).
    let expected = 1;
    order.forEach((entry, i) => {
      const above = order[i - 1];
      if (entry.live && entry.place !== Number.MAX_SAFE_INTEGER) {
        const levelAbove =
          above !== undefined && above.live && above.place === entry.place;
        if (!levelAbove && entry.at !== expected) {
          anomalies.push(
            `${ref.heat} race ${race}: the stored places skip from ${expected - 1} to ${entry.at}; the sheet has no gap.`,
          );
        }
      }
      expected = i + 2;
    });

    const lines: RaceLine[] = [
      ...order.map((entry, i) => {
        const above = order[i - 1];
        const tied =
          entry.live &&
          above !== undefined &&
          above.live &&
          above.place === entry.place &&
          entry.place !== Number.MAX_SAFE_INTEGER &&
          tiedWith.get(live.find((e) => e.boat === entry.boat)!) === true;
        return {
          boat: entry.boat,
          ...(entry.penalty ? { penalty: entry.penalty as PenaltyCode } : {}),
          ...(tied ? { tied: true } : {}),
        };
      }),
      ...coded.map((line) => ({
        boat: line.boat,
        code: line.code as NoPlaceCode,
      })),
    ];
    decisions.push({ type: 'raceScored', race: ref, lines });
  };

  /**
   * One round (or the Final Series): its heats as made, each boat joining
   * before her first race in it, then every race in race order.
   */
  const sailRound = (
    stored: HeatRow[],
    create: (heats: BoatId[][]) => void,
  ) => {
    const crews = stored.map(crewOf);
    create(
      crews.map(({ races, first }) =>
        [...first]
          .filter(([, n]) => n === 1 || races.length === 0)
          .map(([b]) => b),
      ),
    );
    const members = crews.map(
      ({ first, races }) =>
        new Set(
          [...first]
            .filter(([, n]) => n === 1 || races.length === 0)
            .map(([b]) => b),
        ),
    );
    const most = Math.max(0, ...crews.map(({ races }) => races.length));
    for (let n = 1; n <= most; n += 1) {
      stored.forEach((heat, h) => {
        const raceRow = crews[h].races[n - 1];
        if (!raceRow) return;
        crews[h].first.forEach((at, b) => {
          if (at === n && n > 1) {
            enter(b);
            decisions.push({
              type: 'boatAssigned',
              boat: b,
              heat: coreHeatId(heat.heat_name),
            });
            members[h].add(b);
          }
        });
        scoreRace(heat, raceRow.race_id, n, members[h]);
      });
      flush();
    }
    // Boats that joined after the heat's last race.
    stored.forEach((heat, h) =>
      crews[h].first.forEach((at, b) => {
        if (at === 0 && crews[h].races.length > 0) {
          enter(b);
          decisions.push({
            type: 'boatAssigned',
            boat: b,
            heat: coreHeatId(heat.heat_name),
          });
        }
      }),
    );
  };

  const qualifying = heats.filter((h) => h.heat_type === 'Qualifying');
  const finals = heats
    .filter((h) => h.heat_type === 'Final')
    .sort(
      (a, b) =>
        fleetRank(coreHeatId(a.heat_name)) - fleetRank(coreHeatId(b.heat_name)),
    );
  const rounds = new Map<number, HeatRow[]>();
  qualifying.forEach((heat) => {
    const round = getHeatRoundFromName(heat.heat_name) || 1;
    rounds.set(round, [...(rounds.get(round) ?? []), heat]);
  });
  const roundNumbers = [...rounds.keys()].sort((a, b) => a - b);
  roundNumbers.forEach((round, i) => {
    if (round !== i + 1) anomalies.push(`Round ${i + 1} is missing.`);
    rounds.get(round)!.sort((a, b) => a.heat_name.localeCompare(b.heat_name));
  });

  roundNumbers.forEach((round, i) =>
    sailRound(rounds.get(round)!, (heatsMade) => {
      heatsMade.flat().forEach(enter);
      decisions.push(
        i === 0
          ? {
              type: 'heatsCreated',
              heatCount: heatsMade.length,
              heats: heatsMade,
            }
          : { type: 'roundCreated', heats: heatsMade },
      );
    }),
  );

  // Entered boats that never had a heat: entered once the heats exist.
  if (finals.length === 0) entries.forEach((row) => enter(id(row.boat_id)));
  flush(true);

  if (finals.length > 0) {
    const stored = finals.map((heat) => [...listed.get(heat.heat_id)!].sort());
    // Boats in a fleet but entered nowhere before it (none in the tables
    // the app writes, but the split must know every fleet boat).
    stored.flat().forEach(enter);
    const split = (rule43: boolean) => {
      const result = replay([
        ...decisions,
        { type: 'finalSeriesStarted', rule43 },
      ]);
      return (
        result.ok &&
        result.state.fleets !== null &&
        result.state.fleets.length === finals.length &&
        result.state.fleets.every(
          (fleet, i) =>
            JSON.stringify([...fleet.boats].sort()) ===
            JSON.stringify(stored[i]),
        )
      );
    };
    const rule43 = [true, false].find(split);
    if (rule43 !== undefined) {
      decisions.push({ type: 'finalSeriesStarted', rule43 });
    } else {
      notes.push(
        'The final fleets are not the split the rules give from the results as they stand (results corrected after the split, or a split made before the round was complete); they are recorded as made.',
      );
      decisions.push({
        type: 'finalSeriesStarted',
        fleets: finals.map((heat) => [...listed.get(heat.heat_id)!]),
      });
    }
    const crews = finals.map(crewOf);
    const members = crews.map(({ first }) => new Set(first.keys()));
    const most = Math.max(0, ...crews.map(({ races }) => races.length));
    for (let n = 1; n <= most; n += 1) {
      finals.forEach((heat, h) => {
        const raceRow = crews[h].races[n - 1];
        if (raceRow) scoreRace(heat, raceRow.race_id, n, members[h]);
      });
    }
    // Boats entered after the split (older records allow it): no fleet.
    entries.forEach((row) => {
      if (!entered.has(id(row.boat_id))) {
        anomalies.push(
          `${id(row.boat_id)} was entered after the Final Series started; she is in no fleet.`,
        );
      }
    });
  }
  flush(true);
  return { decisions, notes, anomalies, races: raceRefs };
}

/**
 * Replay `log` and compare it with the tables: every heat's boats and
 * every boat's points in every race. Returns the differences in words
 * (empty: the log is the event as the tables hold it).
 */
export function checkEventLog(eventId: number, log: EventLog): string[] {
  const result = replay(log.decisions);
  if (!result.ok) {
    return [`Decision ${result.at} refused: ${result.reason}`];
  }
  const { state } = result;
  const problems: string[] = [];
  const heats = db
    .prepare('SELECT heat_id, heat_name FROM Heats WHERE event_id = ?')
    .all(eventId) as { heat_id: number; heat_name: string }[];
  const libraryHeats = [...state.rounds.flat(), ...(state.fleets ?? [])];
  heats.forEach((heat) => {
    const name = coreHeatId(heat.heat_name);
    const mine = libraryHeats.find((h) => h.id === name);
    const stored = (
      db
        .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
        .all(heat.heat_id) as { boat_id: number }[]
    )
      .map((row) => id(row.boat_id))
      .sort();
    if (!mine) {
      problems.push(`${name} is not in the log.`);
      return;
    }
    const ours = [...mine.boats].sort();
    if (JSON.stringify(ours) !== JSON.stringify(stored)) {
      problems.push(
        `${name}: tables [${stored.join(',')}], log [${ours.join(',')}].`,
      );
    }
  });

  // Points, as the standings count them (redress averages settled).
  const points = new Map<string, number>();
  const key = (ref: RaceRef, b: string) => `${ref.heat}#${ref.race}|${b}`;
  const qualifying = qualifyingStandings(state);
  qualifying.standings.forEach((s) =>
    s.scores.forEach((score) => {
      if (score.ref) points.set(key(score.ref, s.boat), score.points);
    }),
  );
  Object.entries(qualifying.pending).forEach(([b, scores]) =>
    scores.forEach((score) => {
      if (score.ref) points.set(key(score.ref, b), score.points);
    }),
  );
  finalStandings(state).forEach((fleet) =>
    fleet.standings.forEach((s) =>
      s.scores.forEach((score) => {
        if (score.ref) points.set(key(score.ref, s.boat), score.points);
      }),
    ),
  );
  log.races.forEach((ref, raceId) => {
    const rows = db
      .prepare(
        'SELECT boat_id, position, points, status, held_place FROM Scores WHERE race_id = ? ORDER BY position, boat_id',
      )
      .all(raceId) as {
      boat_id: number;
      position: number;
      points: number;
      status: string;
      held_place: number | null;
    }[];
    const wrong = rows.filter((row) => {
      const mine = points.get(key(ref, id(row.boat_id)));
      // A no-heat DNC is counted by its round, not filed under a race.
      return mine !== undefined && Math.abs(mine - Number(row.points)) > 1e-9;
    });
    if (wrong.length === 0) return;
    const stored = rows
      .map(
        (row) =>
          `${row.boat_id}:${row.position}/${row.status}${row.held_place != null ? `@${row.held_place}` : ''}=${row.points}`,
      )
      .join(' ');
    wrong.forEach((row) =>
      problems.push(
        `${ref.heat} race ${ref.race}, ${row.boat_id} (${row.status}): tables ${row.points}, log ${points.get(key(ref, id(row.boat_id)))}. Stored: ${stored}`,
      ),
    );
  });
  return problems;
}
