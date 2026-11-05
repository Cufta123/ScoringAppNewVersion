/**
 * Write an event as regatta-core worked it out into the app's tables
 * (phase 3 of docs/regatta-core-switch.md): the entries, the settings, the
 * heats with their boats, the races and every result row, in the shapes
 * the screens and the conversion (functions/eventLog.ts) read.
 *
 * The tables are a projection of the library's state: nothing here decides
 * anything. Rows keep their ids (matched by event + heat name, heat + race
 * number, race + boat), and only rows that change are written, so the
 * change journal records what really changed.
 *
 * Round trip: projecting a state and converting the tables back with
 * eventToLog gives a log that replays to the same heats and results
 * (checked in the tests). For that, the projection writes what the
 * conversion reads: a committee DSQ / DNE / DGM with her place before the
 * decision in RaceAssignmentSnapshots, an RDG / DPI with the place she kept
 * in held_place, and a DNC for a boat with no heat in a counted race.
 */
import {
  finalStandings,
  qualifyingStandings,
  scoreRace,
  type BoatId,
  type DiscardProfile,
  type EventState,
  type Heat,
  type Race,
  type RaceLine,
} from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import { normalizeDiscardConfigString } from '../../shared/discardProfile';
import { invalidateAssignmentSnapshotCache } from './raceAssignmentSnapshot';

type Row = Record<string, unknown>;

const heatName = (heat: Heat) =>
  heat.series === 'final' ? `Final ${heat.id}` : `Heat ${heat.id}`;
const heatType = (heat: Heat) =>
  heat.series === 'final' ? 'Final' : 'Qualifying';

function storedDiscards(profile: DiscardProfile): string {
  switch (profile.kind) {
    case 'none':
      return normalizeDiscardConfigString({ thresholds: [] });
    case 'thresholds':
      return normalizeDiscardConfigString({ thresholds: profile.at });
    case 'custom':
      return normalizeDiscardConfigString({
        firstDiscardAt: profile.first,
        secondDiscardAt: profile.second,
        additionalEvery: profile.every,
      });
    default:
      return normalizeDiscardConfigString({
        firstDiscardAt: 4,
        secondDiscardAt: 8,
        additionalEvery: 8,
      });
  }
}

/** The result row a boat gets in one race, as the app stores it. */
interface Cell {
  position: number;
  points: number;
  status: string;
  held_place: number | null;
  rdg_race_ids: string | null;
  /** SHRS 3.1(5): her sheet row before a committee decision moved her. */
  frozen?: { position: number; status: string };
}

/**
 * Every boat's row in one race. `settled` holds the points the standings
 * count (average redress worked out); `raceIds` maps races to app ids.
 */
function cellsOf(
  race: Race,
  largest: number,
  settled: Map<BoatId, number>,
  raceIdOf: (heat: string, race: number) => number | undefined,
): Map<BoatId, Cell> {
  const noPlace = largest + 1;
  const cells = new Map<BoatId, Cell>();
  const results = scoreRace(race, largest);
  // Sheet places (finishing slots, ties sharing the first).
  const sheetPlace = new Map<BoatId, number>();
  let slot = 0;
  race.lines.forEach((line: RaceLine) => {
    if (line.code) return;
    if (!line.tied) slot = sheetPlace.size + 1;
    sheetPlace.set(line.boat, slot);
  });
  results.forEach((result) => {
    const line = race.lines.find((l) => l.boat === result.boat)!;
    const decided = race.protests[result.boat];
    const points = settled.get(result.boat) ?? result.points;
    const sheetStatus = line.code ?? line.penalty ?? 'FINISHED';
    if (decided && ['DSQ', 'DNE', 'DGM'].includes(decided.kind)) {
      cells.set(result.boat, {
        position: noPlace,
        points,
        status: decided.kind,
        held_place: null,
        rdg_race_ids: null,
        frozen: {
          position: line.code ? noPlace : sheetPlace.get(result.boat)!,
          status: sheetStatus,
        },
      });
      return;
    }
    if (decided && decided.kind !== 'cleared') {
      // RDG / DPI: the points are the committee's; the place she kept
      // stays beside them (RRS A6.2). A boat with no place keeps her code.
      cells.set(result.boat, {
        position: points,
        points,
        status: decided.kind,
        held_place: line.code ? null : (result.place ?? null),
        rdg_race_ids:
          decided.kind === 'RDG2'
            ? JSON.stringify(
                decided.races
                  .map((ref) => raceIdOf(ref.heat, ref.race))
                  .filter((id) => id !== undefined),
              )
            : null,
        ...(line.code
          ? { frozen: { position: noPlace, status: line.code } }
          : {}),
      });
      return;
    }
    cells.set(result.boat, {
      position: result.place ?? noPlace,
      points,
      status: line.code ?? line.penalty ?? 'FINISHED',
      held_place: null,
      rdg_race_ids: null,
    });
  });
  // SHRS 3.1(5): with a committee decision in the race, every boat's sheet
  // row is kept beside the results (as the app always froze the whole
  // race), so the sheet is read back exactly: ties too, which the results
  // alone cannot tell from a move-up.
  if (Object.keys(race.protests).length > 0) {
    race.lines.forEach((line) => {
      cells.get(line.boat)!.frozen = {
        position: line.code ? noPlace : sheetPlace.get(line.boat)!,
        status: line.code ?? line.penalty ?? 'FINISHED',
      };
    });
  }
  return cells;
}

/** Make the event's tables what `state` says. Call inside a transaction. */
export default function projectEvent(eventId: number, state: EventState) {
  // ── Settings ────────────────────────────────────────────────────────
  const { settings } = state;
  const event = db
    .prepare(
      `SELECT shrs_qualifying_assignment_mode AS mode,
              shrs_discard_profile_qualifying AS q,
              shrs_discard_profile_final AS f,
              shrs_heat_overflow_policy AS overflow
       FROM Events WHERE event_id = ?`,
    )
    .get(eventId) as Row | undefined;
  if (!event) throw new Error(`There is no event ${eventId}.`);
  const wanted = {
    mode: settings.qualifyingMode,
    q: storedDiscards(settings.discards.qualifying),
    f: storedDiscards(settings.discards.final),
    overflow:
      settings.finalOverflow === 'add-fleets'
        ? 'auto-increase'
        : 'confirm-allow-oversize',
  };
  if (
    event.mode !== wanted.mode ||
    event.q !== wanted.q ||
    event.f !== wanted.f ||
    event.overflow !== wanted.overflow
  ) {
    db.prepare(
      `UPDATE Events SET shrs_qualifying_assignment_mode = ?,
         shrs_discard_profile_qualifying = ?, shrs_discard_profile_final = ?,
         shrs_heat_overflow_policy = ?
       WHERE event_id = ?`,
    ).run(wanted.mode, wanted.q, wanted.f, wanted.overflow, eventId);
  }

  // ── Entries ─────────────────────────────────────────────────────────
  const entered = new Set(
    (
      db
        .prepare('SELECT boat_id FROM Boat_Event WHERE event_id = ?')
        .all(eventId) as { boat_id: number }[]
    ).map((row) => String(row.boat_id)),
  );
  const boats = new Set(state.boats.map((boat) => boat.id));
  state.boats.forEach((boat) => {
    if (!entered.has(boat.id)) {
      db.prepare(
        'INSERT OR IGNORE INTO Boat_Event (boat_id, event_id) VALUES (?, ?)',
      ).run(Number(boat.id), eventId);
    }
  });

  // ── Heats, their boats, races and results ───────────────────────────
  const heats = [...state.rounds.flat(), ...(state.fleets ?? [])];
  const stored = new Map(
    (
      db
        .prepare('SELECT heat_id, heat_name FROM Heats WHERE event_id = ?')
        .all(eventId) as { heat_id: number; heat_name: string }[]
    ).map((row) => [row.heat_name, Number(row.heat_id)]),
  );
  const deleteRaces = (raceIds: number[]) => {
    if (raceIds.length === 0) return;
    const list = raceIds.join(',');
    db.prepare(
      `DELETE FROM RaceAssignmentSnapshots WHERE race_id IN (${list})`,
    ).run();
    db.prepare(`DELETE FROM Scores WHERE race_id IN (${list})`).run();
    db.prepare(`DELETE FROM Races WHERE race_id IN (${list})`).run();
  };

  const wantedNames = new Set(heats.map(heatName));
  stored.forEach((heatId, name) => {
    if (wantedNames.has(name)) return;
    deleteRaces(
      (
        db
          .prepare('SELECT race_id FROM Races WHERE heat_id = ?')
          .all(heatId) as { race_id: number }[]
      ).map((row) => Number(row.race_id)),
    );
    db.prepare('DELETE FROM Heat_Boat WHERE heat_id = ?').run(heatId);
    db.prepare('DELETE FROM Heats WHERE heat_id = ?').run(heatId);
    stored.delete(name);
  });

  const heatIdOf = new Map<string, number>();
  heats.forEach((heat) => {
    let heatId = stored.get(heatName(heat));
    if (heatId === undefined) {
      heatId = Number(
        db
          .prepare(
            'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
          )
          .run(eventId, heatName(heat), heatType(heat)).lastInsertRowid,
      );
    }
    heatIdOf.set(heat.id, heatId);
    const members = new Set(
      (
        db
          .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
          .all(heatId) as { boat_id: number }[]
      ).map((row) => String(row.boat_id)),
    );
    heat.boats.forEach((boat) => {
      if (!members.has(boat)) {
        db.prepare(
          'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
        ).run(heatId, Number(boat));
      }
    });
    members.forEach((boat) => {
      if (!heat.boats.includes(boat)) {
        db.prepare(
          'DELETE FROM Heat_Boat WHERE heat_id = ? AND boat_id = ?',
        ).run(heatId, Number(boat));
      }
    });
  });

  // Races: (heat, race number) keeps its id.
  const raceIdOfRef = new Map<string, number>();
  heats.forEach((heat) => {
    const heatId = heatIdOf.get(heat.id)!;
    const existing = new Map(
      (
        db
          .prepare('SELECT race_id, race_number FROM Races WHERE heat_id = ?')
          .all(heatId) as { race_id: number; race_number: number }[]
      ).map((row) => [Number(row.race_number), Number(row.race_id)]),
    );
    deleteRaces(
      [...existing]
        .filter(([n]) => n > heat.races.length)
        .map(([, raceId]) => raceId),
    );
    heat.races.forEach((race) => {
      const raceId =
        existing.get(race.ref.race) ??
        Number(
          db
            .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
            .run(heatId, race.ref.race).lastInsertRowid,
        );
      raceIdOfRef.set(`${heat.id}#${race.ref.race}`, raceId);
    });
  });
  const raceIdOf = (heat: string, race: number) =>
    raceIdOfRef.get(`${heat}#${race}`);

  // The points the standings count (average redress worked out).
  const settled = new Map<string, number>();
  const qualifying = qualifyingStandings(state);
  const noHeat: {
    boat: BoatId;
    round: number;
    race: number;
    points: number;
    code: string;
  }[] = [];
  qualifying.standings.forEach((standing) =>
    standing.scores.forEach((score) => {
      if (score.ref) {
        settled.set(
          `${score.ref.heat}#${score.ref.race}|${standing.boat}`,
          score.points,
        );
      } else {
        noHeat.push({
          boat: standing.boat,
          round: score.round,
          race: score.raceNumber,
          points: score.points,
          code: score.code ?? 'DNC',
        });
      }
    }),
  );
  Object.entries(qualifying.pending).forEach(([boat, scores]) =>
    scores.forEach((score) => {
      if (score.ref) {
        settled.set(
          `${score.ref.heat}#${score.ref.race}|${boat}`,
          score.points,
        );
      }
    }),
  );
  finalStandings(state).forEach((fleet) =>
    fleet.standings.forEach((standing) =>
      standing.scores.forEach((score) => {
        if (score.ref) {
          settled.set(
            `${score.ref.heat}#${score.ref.race}|${standing.boat}`,
            score.points,
          );
        }
      }),
    ),
  );

  const largest = (list: Heat[]) =>
    list.reduce((max, heat) => Math.max(max, heat.boats.length), 0);
  const largestQualifying = largest(state.rounds.flat());
  const largestFinal = largest(state.fleets ?? []);

  /** Make one race's rows `wantedCells`. */
  const writeCells = (raceId: number, wantedCells: Map<BoatId, Cell>) => {
    const existing = new Map(
      (
        db
          .prepare(
            `SELECT boat_id, position, points, status, held_place, rdg_race_ids
             FROM Scores WHERE race_id = ?`,
          )
          .all(raceId) as Row[]
      ).map((row) => [String(row.boat_id), row]),
    );
    wantedCells.forEach((cell, boat) => {
      const row = existing.get(boat);
      if (!row) {
        db.prepare(
          `INSERT INTO Scores (race_id, boat_id, position, points, status, held_place, rdg_race_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          raceId,
          Number(boat),
          cell.position,
          cell.points,
          cell.status,
          cell.held_place,
          cell.rdg_race_ids,
        );
      } else if (
        Number(row.position) !== cell.position ||
        Number(row.points) !== cell.points ||
        row.status !== cell.status ||
        (row.held_place ?? null) !== cell.held_place ||
        (row.rdg_race_ids ?? null) !== cell.rdg_race_ids
      ) {
        db.prepare(
          `UPDATE Scores SET position = ?, points = ?, status = ?, held_place = ?, rdg_race_ids = ?
           WHERE race_id = ? AND boat_id = ?`,
        ).run(
          cell.position,
          cell.points,
          cell.status,
          cell.held_place,
          cell.rdg_race_ids,
          raceId,
          Number(boat),
        );
      }
    });
    existing.forEach((_row, boat) => {
      if (!wantedCells.has(boat)) {
        db.prepare('DELETE FROM Scores WHERE race_id = ? AND boat_id = ?').run(
          raceId,
          Number(boat),
        );
      }
    });
    // SHRS 3.1(5): the committee's decisions beside the sheet (rewritten
    // only when they change).
    const frozen = [...wantedCells]
      .filter(([, cell]) => cell.frozen)
      .map(([boat, cell], i) => [
        i + 1,
        Number(boat),
        cell.frozen!.position,
        cell.frozen!.status,
      ]);
    const storedFrozen = (
      db
        .prepare(
          `SELECT rank, boat_id, frozen_position, frozen_status
           FROM RaceAssignmentSnapshots WHERE race_id = ? ORDER BY rank`,
        )
        .all(raceId) as Row[]
    ).map((row) => [
      Number(row.rank),
      Number(row.boat_id),
      Number(row.frozen_position),
      row.frozen_status,
    ]);
    if (JSON.stringify(frozen) !== JSON.stringify(storedFrozen)) {
      db.prepare('DELETE FROM RaceAssignmentSnapshots WHERE race_id = ?').run(
        raceId,
      );
      frozen.forEach((values) =>
        db
          .prepare(
            `INSERT INTO RaceAssignmentSnapshots (race_id, rank, boat_id, frozen_position, frozen_status)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(raceId, ...values),
      );
    }
  };

  const cellsByRace = new Map<number, Map<BoatId, Cell>>();
  heats.forEach((heat) => {
    const largestHere =
      heat.series === 'final' ? largestFinal : largestQualifying;
    heat.races.forEach((race) => {
      const raceId = raceIdOf(heat.id, race.ref.race)!;
      const raceSettled = new Map<BoatId, number>();
      race.lines.forEach((line) => {
        const points = settled.get(`${heat.id}#${race.ref.race}|${line.boat}`);
        if (points !== undefined) raceSettled.set(line.boat, points);
      });
      cellsByRace.set(
        raceId,
        cellsOf(race, largestHere, raceSettled, raceIdOf),
      );
    });
  });
  // A boat with no heat in a counted race: DNC (or redress for it), filed
  // under that race of the round's first heat that sailed it.
  noHeat.forEach(({ boat, round, race, points, code }) => {
    const anchor = state.rounds[round - 1]?.find(
      (heat) => heat.races[race - 1],
    );
    if (!anchor) return;
    const raceId = raceIdOf(anchor.id, race)!;
    const outcome = state.rounds[round - 1]
      .map((heat) => heat.races[race - 1]?.protests[boat])
      .find((decided) => decided !== undefined);
    cellsByRace.get(raceId)!.set(boat, {
      position: points,
      points,
      status: code,
      held_place: null,
      rdg_race_ids:
        outcome?.kind === 'RDG2'
          ? JSON.stringify(
              outcome.races
                .map((ref) => raceIdOf(ref.heat, ref.race))
                .filter((id) => id !== undefined),
            )
          : null,
    });
  });
  cellsByRace.forEach((cells, raceId) => writeCells(raceId, cells));
  invalidateAssignmentSnapshotCache();

  // ── Entries no longer in the event (after the heats lost them) ──────
  entered.forEach((boat) => {
    if (!boats.has(boat)) {
      db.prepare(
        'DELETE FROM Boat_Event WHERE event_id = ? AND boat_id = ?',
      ).run(eventId, Number(boat));
    }
  });
}
