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
  MAX_HEAT_SIZE,
  fleetIndex,
  noPlacePoints,
  replay,
  qualifyingStandings,
  finalStandings,
  type Boat,
  type BoatId,
  type Decision,
  type DiscardProfile,
  type ProtestOutcome,
  type RaceRef,
} from 'regatta-core';
import { db } from '../database/DBManager';
import {
  normalizeHeatOverflowPolicy,
  normalizeQualifyingAssignmentMode,
} from '../../shared/eventSettings';
import { toDiscardProfile } from '../../shared/discardProfile';
import { getHeatRoundFromName } from '../../shared/heatNames';
import { normalizeScoreStatus } from './scoreStatus';
import { boatLabel } from './labels';
import {
  COMMITTEE_DSQ,
  REDRESS,
  sheetFromFrozen,
  sheetFromRows,
  type SheetRow,
} from './raceSheet';

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

/** "Heat A1" -> "A1", "Final Gold" -> "Gold". */
export const coreHeatId = (name: string) =>
  name.replace(/^(Heat|Final)\s+/, '');

const id = (boatId: number) => String(boatId);

/** SHRS 5.5 precedence of a stored fleet; a name 4.1 does not give last. */
const fleetPrecedence = (name: string) => {
  const index = fleetIndex(name);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

/** A stored discard setting as the library's SHRS 5.4 profile. */
export const discardProfile = (stored: unknown): DiscardProfile =>
  toDiscardProfile(stored);

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
      anomalies.push(`${boatLabel(boatId)} has results but is not entered.`);
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
  /** SHRS 5.2: the boats in the largest heat of the heat's series. */
  const largestOf = (of: HeatRow) =>
    heats
      .filter((other) => other.heat_type === of.heat_type)
      .reduce(
        (max, other) => Math.max(max, listed.get(other.heat_id)!.length),
        0,
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
              // Older versions kept every race's heat order as rank-only
              // rows (no frozen place, no frozen code): nothing was frozen
              // there, and the race is read from its places.
              `SELECT boat_id, frozen_position, frozen_status
               FROM RaceAssignmentSnapshots
               WHERE race_id = ?
                 AND (frozen_position IS NOT NULL OR frozen_status IS NOT NULL)`,
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
            `Heat ${coreHeatId(heat.heat_name)}: ${boatLabel(boatId)} has a result in it (${status}) but was not listed in the heat; she is put in it.`,
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
        // Older records did not keep the races the committee chose (no
        // rdg_race_ids; the app writes a list, empty or not, for every
        // RDG2). Averaging nothing would score her as a DNF for what the
        // records lost: she keeps the points the committee gave, as
        // points it set (RRS A9(c)).
        if (row.rdg_race_ids == null) {
          anomalies.push(
            `${boatLabel(row.boat_id)} has redress RDG2 (${Number(row.points)} points) without the races it averages; she keeps those points as the committee set them.`,
          );
          return { kind: 'RDG3', points: Number(row.points) };
        }
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

    const scoreRows = new Map<BoatId, ScoreRow>();
    const sheetRows: SheetRow[] = [];
    rows.forEach((row) => {
      const boatId = id(row.boat_id);
      const status = normalizeScoreStatus(row.status);
      if (!members.has(boatId)) {
        // A boat with no heat in this race: DNC, or redress for it (R12).
        if (REDRESS.has(status)) decide(ref, boatId, status, row);
        return;
      }
      const ice = frozen.get(boatId);
      scoreRows.set(boatId, row);
      sheetRows.push({
        boat: boatId,
        status,
        position: Number(row.position),
        points: Number(row.points),
        heldPlace: row.held_place,
        // A DSQ / DNE / DGM is the committee's only with a freeze (else an
        // umpire's, on the sheet); RDG / DPI always are.
        ...(ice &&
        (COMMITTEE_DSQ.has(status) || REDRESS.has(status) || status === 'DPI')
          ? {
              frozen: {
                position: ice.frozen_position,
                status: normalizeScoreStatus(ice.frozen_status),
              },
            }
          : {}),
      });
    });
    // A whole race frozen beside the results (a committee decision in it):
    // the sheet is read back exactly from the freeze.
    const wholeFreeze =
      sheetRows.length > 0 &&
      sheetRows.every((row) => frozen.has(row.boat)) &&
      [...frozen.keys()].every((boat) => scoreRows.has(boat));
    const sheet = wholeFreeze
      ? sheetFromFrozen(
          sheetRows.map((row) => {
            const ice = frozen.get(row.boat)!;
            return {
              ...row,
              frozen: {
                position: ice.frozen_position,
                status: normalizeScoreStatus(ice.frozen_status),
              },
            };
          }),
        )
      : sheetFromRows(
          sheetRows,
          noPlacePoints(largestOf(heat)),
          // As the screens name it: "Heat A2, race 1", "Final Gold, race 3".
          `${heat.heat_name}, race ${race}`,
          boatLabel,
          true,
        );
    notes.push(...sheet.notes);
    anomalies.push(...sheet.anomalies);
    sheet.committee.forEach((row) =>
      decide(ref, row.boat, row.status, scoreRows.get(row.boat)!),
    );
    const { lines } = sheet;
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
  const raceCount = (heatId: number) =>
    Number(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM Races WHERE heat_id = ?')
          .get(heatId) as { n: number }
      ).n,
    );
  const finals = heats
    .filter((h) => h.heat_type === 'Final')
    .filter((h) => {
      // A fleet with no boats and no race holds nothing (older records
      // could start the Final Series with no boats in it).
      const empty =
        (listed.get(h.heat_id)?.length ?? 0) === 0 &&
        raceCount(h.heat_id) === 0;
      if (empty) {
        anomalies.push(
          `The ${coreHeatId(h.heat_name)} fleet has no boats and no races; it is left out.`,
        );
      }
      return !empty;
    })
    .sort(
      (a, b) =>
        fleetPrecedence(coreHeatId(a.heat_name)) -
        fleetPrecedence(coreHeatId(b.heat_name)),
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
      heatsMade.forEach((boats, h) => {
        if (boats.length > MAX_HEAT_SIZE) {
          anomalies.push(
            `Heat ${coreHeatId(rounds.get(round)![h].heat_name)} has ${boats.length} boats; SHRS 2.3 allows ${MAX_HEAT_SIZE}. It is kept as it was sailed.`,
          );
        }
      });
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
          `${boatLabel(row.boat_id)} was entered after the Final Series started; she is in no fleet.`,
        );
      }
    });
  }
  flush(true);
  return { decisions, notes, anomalies, races: raceRefs };
}

/** A race result the converted log scores differently from the tables. */
export interface PointsDifference {
  raceId: number;
  heat: string;
  race: number;
  boat: number;
  status: string;
  /** What the tables held (the old app's points). */
  before: number;
  /** What regatta-core gives. */
  after: number;
  /** The race's stored rows, for the test reports. */
  stored: string;
}

export interface HeatDifference {
  heat: string;
  stored: string[];
  log: string[] | null;
}

export interface LogDifferences {
  /** The log is refused (it cannot be replayed at all). */
  refused: string | null;
  heats: HeatDifference[];
  points: PointsDifference[];
}

/**
 * Replay `log` and compare it with the tables: every heat's boats and
 * every boat's points in every race.
 */
export function logDifferences(eventId: number, log: EventLog): LogDifferences {
  const result = replay(log.decisions);
  if (!result.ok) {
    return {
      refused: `Decision ${result.at} refused: ${result.reason}`,
      heats: [],
      points: [],
    };
  }
  const { state } = result;
  const differences: LogDifferences = { refused: null, heats: [], points: [] };
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
    const ours = mine ? [...mine.boats].sort() : null;
    if (JSON.stringify(ours) !== JSON.stringify(stored)) {
      differences.heats.push({ heat: name, stored, log: ours });
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
      differences.points.push({
        raceId,
        heat: ref.heat,
        race: ref.race,
        boat: Number(row.boat_id),
        status: normalizeScoreStatus(row.status),
        before: Number(row.points),
        after: points.get(key(ref, id(row.boat_id)))!,
        stored,
      }),
    );
  });
  return differences;
}

/**
 * The differences between `log` and the tables in words, for the tests
 * (empty: the log is the event as the tables hold it).
 */
export function checkEventLog(eventId: number, log: EventLog): string[] {
  const { refused, heats, points } = logDifferences(eventId, log);
  if (refused) return [refused];
  return [
    ...heats.map((heat) =>
      heat.log === null
        ? `${heat.heat} is not in the log.`
        : `${heat.heat}: tables [${heat.stored.join(',')}], log [${heat.log.join(',')}].`,
    ),
    ...points.map(
      (p) =>
        `${p.heat} race ${p.race}, ${p.boat} (${p.status}): tables ${p.before}, log ${p.after}. Stored: ${p.stored}`,
    ),
  ];
}
