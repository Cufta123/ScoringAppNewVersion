import {
  MAX_HEATS,
  MAX_HEAT_SIZE,
  fewestHeats,
  movementImbalanceExpected,
  undoLatestRound,
} from 'regatta-core';
import { db } from '../database/DBManager';
import handle from './handle';
import { applyToEvent } from '../functions/libraryWrite';
import { coreHeatId } from '../functions/eventLog';
import { requireHeat } from '../functions/heatQueries';
import { assertQualifyingHeatIsOpen } from '../functions/seriesGuards';
import {
  describeIndistinguishable,
  findIndistinguishableBoats,
} from '../../shared/boatKeys';
import type { HeatBoatRow, HeatRow, RaceRow } from '../../shared/rows';

handle('readAllHeats', async (event, event_id) => {
  const heats = db
    .prepare('SELECT * FROM Heats WHERE event_id = ?')
    .all(event_id) as HeatRow[];
  return heats;
});

handle('insertHeatBoat', async (event, heat_id, boat_id) => {
  const heatRow = requireHeat(heat_id);

  if (heatRow.heat_type === 'Final') {
    throw new Error(
      'Boats cannot be added to a Final Series fleet: fleets are fixed once the Final Series starts (SHRS 4.1).',
    );
  }
  assertQualifyingHeatIsOpen(heatRow, 'add a boat');
  const entered = db
    .prepare('SELECT 1 FROM Boat_Event WHERE boat_id = ? AND event_id = ?')
    .get(boat_id, heatRow.event_id);
  if (!entered) {
    throw new Error('That boat is not entered in this event.');
  }
  // A late entry joins a heat of the current round (boatAssigned), also
  // one that has raced: she is DNC for its races (RRS A5.1, parity R3).
  // regatta-core refuses a second heat this round and a 21st boat.
  applyToEvent(Number(heatRow.event_id), {
    decide: () => [
      {
        type: 'boatAssigned',
        boat: String(boat_id),
        heat: coreHeatId(heatRow.heat_name),
      },
    ],
  });
  const row = db
    .prepare('SELECT rowid FROM Heat_Boat WHERE heat_id = ? AND boat_id = ?')
    .get(heat_id, boat_id) as { rowid: number } | undefined;
  return { lastInsertRowid: row?.rowid ?? 0 };
});

/**
 * What the screen must hear before heats are drawn, in its own terms: the
 * heat count, entries to draw, boats it could not tell apart, and the
 * fewest heats for the entries (SHRS 2.3). The draw itself (SHRS 3.1(1)) is
 * regatta-core's.
 */
function checkInitialHeats(event_id: number, num_heats: unknown) {
  const numHeats = Number(num_heats);
  if (!Number.isInteger(numHeats) || numHeats < 1 || numHeats > MAX_HEATS) {
    throw new Error(`Number of heats must be between 1 and ${MAX_HEATS}.`);
  }

  const boats = db
    .prepare(
      `SELECT b.boat_id, b.sail_number, b.country
       FROM Boats b
       JOIN Boat_Event be ON b.boat_id = be.boat_id
       WHERE be.event_id = ?`,
    )
    .all(event_id) as Array<{
    boat_id: number;
    sail_number: string | number | null;
    country: string | null;
  }>;

  if (boats.length === 0) {
    throw new Error(
      'No boats are registered for this event yet — add entries before creating heats.',
    );
  }

  const indistinguishable = findIndistinguishableBoats(boats);
  if (indistinguishable.length > 0) {
    throw new Error(
      `Cannot create heats: ${describeIndistinguishable(indistinguishable)}.`,
    );
  }

  if (Math.ceil(boats.length / numHeats) > MAX_HEAT_SIZE) {
    throw new Error(
      `${boats.length} boats in ${numHeats} heat(s) would exceed ` +
        `${MAX_HEAT_SIZE} boats per heat (SHRS). ` +
        `Use at least ${fewestHeats(boats.length)} heats.`,
    );
  }
  return numHeats;
}

/** The first round, drawn by regatta-core (heatsCreated). */
function drawFirstRound(event_id: number, numHeats: number) {
  const { after } = applyToEvent(event_id, {
    decide: () => [{ type: 'heatsCreated', heatCount: numHeats }],
  });
  return {
    createdHeats: numHeats,
    assignedBoats: after.rounds[0].flatMap((heat) => heat.boats).length,
  };
}

/**
 * Server-side guard for anything that discards an event's heats. The renderer
 * blocks these once a race has happened, but that state can be stale — never
 * rely on it for a delete this destructive.
 */
function assertNoScoredRacesForEvent(event_id: number) {
  const scoredRaces = db
    .prepare(
      `SELECT COUNT(*) AS count FROM Races r
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ?`,
    )
    .get(event_id) as { count: number };
  if (scoredRaces.count > 0) {
    throw new Error(
      'Cannot delete heats because races have already been scored for this event. Undo the races first.',
    );
  }
}

handle('createInitialHeatsAtomic', async (_event, raw_event_id, num_heats) => {
  const event_id = Number(raw_event_id);
  const existingHeats = db
    .prepare('SELECT COUNT(*) AS count FROM Heats WHERE event_id = ?')
    .get(event_id) as { count: number };
  if (existingHeats.count > 0) {
    throw new Error('Heats already exist for this event.');
  }

  // Validation, SHRS 3 seeding order and the SHRS 3.1 serpentine assignment
  // all resolve before the transaction opens, so a failure writes nothing.
  const numHeats = checkInitialHeats(event_id, num_heats);
  return { success: true, ...drawFirstRound(event_id, numHeats) };
});

/**
 * "Recreate Heats": throw the current split away and seed a new one.
 *
 * This exists as ONE handler because the renderer used to call
 * deleteHeatsByEvent and then createInitialHeatsAtomic. The destructive call
 * ran first, so anything that made the second one fail — a duplicate sail
 * number added since the heats were built, an entry list that no longer fits
 * the chosen heat count — left the event with no heats at all. Worse, the
 * renderer's create step reports its own validation failures and returns
 * normally, so the recreate wrapper never saw an error and the user was told
 * only "Cannot create heats: …", which reads as though nothing happened.
 *
 * Planning before the wipe, inside one transaction, makes the whole thing
 * all-or-nothing: either the new heats exist or the old ones still do.
 */
handle(
  'recreateInitialHeatsAtomic',
  async (_event, raw_event_id, num_heats) => {
    const event_id = Number(raw_event_id);
    assertNoScoredRacesForEvent(event_id);
    const numHeats = checkInitialHeats(event_id, num_heats);
    // A new first round replaces the heats (regatta-core refuses once
    // racing has started); one transaction, so a refusal keeps the old ones.
    return { success: true, ...drawFirstRound(event_id, numHeats) };
  },
);

handle('readBoatsByHeat', async (event, heat_id) => {
  const boats = db
    .prepare(
      `
      SELECT
        b.boat_id,
        b.sail_number,
        b.country,
        b.model,
        s.name,
        s.surname,
        cat.category_name
      FROM Heat_Boat hb
      JOIN Boats b ON hb.boat_id = b.boat_id
      -- LEFT: Boats.sailor_id is nullable. A boat with no (or a missing)
      -- sailor is still in the heat and still scored, so it must still be
      -- listed; an inner join made it vanish from the screen.
      LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
      LEFT JOIN Categories cat ON s.category_id = cat.category_id
      WHERE hb.heat_id = ?
    `,
    )
    .all(heat_id) as HeatBoatRow[];
  return boats;
});
handle('readAllRaces', async (event, heat_id) => {
  const races = db
    .prepare('SELECT * FROM Races WHERE heat_id = ?')
    .all(heat_id) as RaceRow[];
  return races;
});

handle('createNewHeatsBasedOnLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  // The next round (SHRS 3.1 Heat Movement Table, or the 3.2 published
  // assignment) is regatta-core's: roundCreated. Replay refuses it, in the
  // words the Scoring page shows (`readEventStatus`'s createRound), once
  // the Final Series has started, with one heat, and until every heat with
  // boats has sailed the round (a heat left with no boats holds nothing up).
  const { after } = applyToEvent(event_id, {
    decide: () => [{ type: 'roundCreated' }],
  });
  const round = after.rounds[after.rounds.length - 1];
  const boats = round.reduce((n, heat) => n + heat.boats.length, 0);
  // The note under the SHRS Heat Movement Tables.
  return movementImbalanceExpected(round.length, boats)
    ? {
        success: true,
        advisory:
          `SHRS advisory: with odd/even movement tables and ${boats} boats in 2 heats, ` +
          'a temporary 2-boat imbalance between heats can occur and is expected.',
      }
    : { success: true };
});

handle('undoLatestHeatRedistribution', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  // Take the round out of the log (with the late entries assigned to it):
  // regatta-core builds that log (`undoLatestRound`) and refuses, in the
  // words the Scoring page shows (`readEventStatus`), the first round, a
  // round that has raced, and any round once the Final Series started.
  let removedAssignments = 0;
  let removedHeatNames: string[] = [];
  applyToEvent(event_id, {
    rewrite: (log, state) => {
      const undone = undoLatestRound(log);
      if (!undone.ok) throw new Error(undone.reason);
      const round = state.rounds[state.rounds.length - 1];
      removedAssignments = round.reduce((n, heat) => n + heat.boats.length, 0);
      removedHeatNames = round.map((heat) => `Heat ${heat.id}`);
      return undone.log;
    },
  });
  return {
    success: true,
    removedAssignments,
    removedHeats: removedHeatNames.length,
    removedHeatNames,
  };
});

handle(
  'transferBoatBetweenHeats',
  async (event, from_heat_id, to_heat_id, boat_id) => {
    // Dropping a boat back onto its own heat is a no-op, not a delete+insert
    // (which would shuffle the boat to the bottom of the heat's list).
    if (String(from_heat_id) === String(to_heat_id)) {
      return { success: true };
    }

    const fromHeat = requireHeat(from_heat_id);
    const toHeat = requireHeat(to_heat_id);
    if (fromHeat.event_id !== toHeat.event_id) {
      throw new Error(
        'A boat can only be moved between heats of the same event.',
      );
    }

    // The screen showed her in that heat, but she is not there any more
    // (the heats changed since): say so in the screen's terms.
    const inFrom = db
      .prepare('SELECT 1 FROM Heat_Boat WHERE heat_id = ? AND boat_id = ?')
      .get(from_heat_id, boat_id);
    if (!inFrom) {
      throw new Error(
        'That boat is no longer in the heat it was dragged from (the heats changed in the meantime). Nothing was moved; reload the page and try again.',
      );
    }

    // regatta-core decides (boatMoved): both heats in the current
    // qualifying round, neither raced, at most 20 boats (SHRS 2.3), no move
    // once the Final Series has started (4.1); the tables follow.
    applyToEvent(Number(fromHeat.event_id), {
      decide: () => [
        {
          type: 'boatMoved',
          boat: String(boat_id),
          from: coreHeatId(fromHeat.heat_name),
          to: coreHeatId(toHeat.heat_name),
        },
      ],
    });

    return { success: true };
  },
);
