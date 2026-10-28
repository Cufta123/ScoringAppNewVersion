import { db } from '../../../public/Database/DBManager';
import handle from './handle';
import {
  assignBoatsToInitialHeatsSerpentine,
  checkRaceCountForLatestHeats,
  compareByCountryThenSail,
} from '../functions/creatingNewHeatsUtls';
import { clearAssignmentSnapshotsForHeat } from '../functions/raceAssignmentSnapshot';
import {
  getLatestQualifyingHeats,
  getRaceCountForHeat,
  requireHeat,
} from '../functions/heatQueries';
import { getHeatRoundFromName } from '../functions/scoreStatus';
import {
  SHRS_MAX_BOATS_PER_HEAT,
  getEventQualifyingAssignmentMode,
} from '../functions/eventSettings';
import {
  getLatestRaceRowsForHeats,
  getOddEvenMovementAdvisory,
} from '../functions/raceSeeding';
import { getAssignmentRowsForHeatRace } from '../functions/assignmentShield';
import { assertQualifyingHeatIsOpen } from '../functions/seriesGuards';
import {
  describeIndistinguishable,
  findIndistinguishableBoats,
} from '../../shared/boatKeys';
import prepareHeatWriters from '../functions/heatWriters';
import planNextRound, {
  type PreAssignedBoat,
} from '../functions/nextRoundPlan';

handle('readAllHeats', async (event, event_id) => {
  const heats = db
    .prepare('SELECT * FROM Heats WHERE event_id = ?')
    .all(event_id);
  return heats;
});

handle('insertHeatBoat', async (event, heat_id, boat_id) => {
  const heatRow = requireHeat(heat_id);

  // Used to place a late entry (UnassignedEntriesNotice). Only safe where it
  // cannot rewrite a result: an entered boat, into a qualifying heat of the
  // current round that has not raced, and not already in that round.
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
  if (getRaceCountForHeat(Number(heat_id)) > 0) {
    throw new Error(
      `"${heatRow.heat_name}" has already raced, so a boat cannot join it. Add her to a heat that has not raced yet.`,
    );
  }
  const round = getHeatRoundFromName(heatRow.heat_name);
  const alreadyInRound = (
    db
      .prepare(
        `SELECT h.heat_name FROM Heat_Boat hb
         JOIN Heats h ON h.heat_id = hb.heat_id
         WHERE hb.boat_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying'`,
      )
      .all(boat_id, heatRow.event_id) as { heat_name: string }[]
  ).find(
    (row) =>
      getHeatRoundFromName(row.heat_name) === round &&
      row.heat_name !== heatRow.heat_name,
  );
  if (alreadyInRound) {
    throw new Error(
      `That boat is already in ${alreadyInRound.heat_name} this round.`,
    );
  }

  const boatsInHeat = db
    .prepare('SELECT COUNT(*) as count FROM Heat_Boat WHERE heat_id = ?')
    .get(heat_id) as { count: number };

  if (boatsInHeat.count >= SHRS_MAX_BOATS_PER_HEAT) {
    throw new Error(
      `Cannot assign more than ${SHRS_MAX_BOATS_PER_HEAT} boats to one heat.`,
    );
  }

  // BK-1: OR IGNORE so re-adding a boat already in this heat is a benign no-op
  // rather than a UNIQUE-constraint throw now that (heat_id, boat_id) is unique.
  const result = db
    .prepare('INSERT OR IGNORE INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')
    .run(heat_id, boat_id);
  return { lastInsertRowid: result.lastInsertRowid };
});

/**
 * Validate an initial-heat split and work out where every boat goes, WITHOUT
 * writing anything. Separated from the insert so "recreate" can prove the new
 * split is buildable before it throws the current heats away.
 */
function planInitialHeats(event_id: number, num_heats: unknown) {
  const numHeats = Number(num_heats);
  if (!Number.isInteger(numHeats) || numHeats < 1 || numHeats > 26) {
    throw new Error('Number of heats must be between 1 and 26.');
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

  // Boats are placed by boat_id, so ITA 12 and CRO 12 are fine; only two
  // boats no one could tell apart in scoring (same letters and number) stop
  // the heats from being made.
  const indistinguishable = findIndistinguishableBoats(boats);
  if (indistinguishable.length > 0) {
    throw new Error(
      `Cannot create heats: ${describeIndistinguishable(indistinguishable)}.`,
    );
  }

  if (Math.ceil(boats.length / numHeats) > SHRS_MAX_BOATS_PER_HEAT) {
    const minHeats = Math.ceil(boats.length / SHRS_MAX_BOATS_PER_HEAT);
    throw new Error(
      `${boats.length} boats in ${numHeats} heat(s) would exceed ` +
        `${SHRS_MAX_BOATS_PER_HEAT} boats per heat (SHRS). ` +
        `Use at least ${minHeats} heats.`,
    );
  }

  boats.sort(compareByCountryThenSail);
  const heatIndices = assignBoatsToInitialHeatsSerpentine(
    boats.length,
    numHeats,
  );
  return { numHeats, boats, heatIndices };
}

/** Write a plan from `planInitialHeats`. Caller supplies the transaction. */
function insertPlannedInitialHeats(
  event_id: number,
  plan: ReturnType<typeof planInitialHeats>,
) {
  const { insertHeatStmt, insertHeatBoatStmt } = prepareHeatWriters();
  const heatIds: number[] = [];
  for (let i = 0; i < plan.numHeats; i += 1) {
    const heatName = `Heat ${String.fromCharCode(65 + i)}1`;
    const inserted = insertHeatStmt.run(event_id, heatName, 'Qualifying');
    heatIds.push(Number(inserted.lastInsertRowid));
  }
  plan.boats.forEach((boat, i) => {
    insertHeatBoatStmt.run(heatIds[plan.heatIndices[i]], boat.boat_id);
  });
  return { createdHeats: plan.numHeats, assignedBoats: plan.boats.length };
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

/** Drop an event's heats and their assignments. Caller supplies the transaction. */
function wipeHeatsForEvent(event_id: number) {
  try {
    db.prepare(
      `DELETE FROM RaceAssignmentSnapshots WHERE race_id IN (
        SELECT r.race_id FROM Races r
        JOIN Heats h ON r.heat_id = h.heat_id
        WHERE h.event_id = ?
      )`,
    ).run(event_id);
  } catch (_snapshotError) {
    // Older databases may not have RaceAssignmentSnapshots yet.
  }

  db.prepare(
    `DELETE FROM Scores WHERE race_id IN (
      SELECT r.race_id FROM Races r
      JOIN Heats h ON r.heat_id = h.heat_id
      WHERE h.event_id = ?
    )`,
  ).run(event_id);

  db.prepare(
    `DELETE FROM Races WHERE heat_id IN (
      SELECT heat_id FROM Heats WHERE event_id = ?
    )`,
  ).run(event_id);

  const heatBoats = db
    .prepare(
      'DELETE FROM Heat_Boat WHERE heat_id IN (SELECT heat_id FROM Heats WHERE event_id = ?)',
    )
    .run(event_id);

  const heatRows = db
    .prepare('DELETE FROM Heats WHERE event_id = ?')
    .run(event_id);

  return {
    heatBoatsChanges: heatBoats.changes,
    heatsChanges: heatRows.changes,
  };
}

// First-round heat creation, atomically: validates up front (boats exist, the
// SHRS 20-boat cap holds), seeds boats by SHRS 3 order and assigns them with
// the SHRS 3.1 serpentine — all in one transaction so a failure can never
// leave half-created heats behind (the old renderer-side per-row IPC loop
// could die at the 21st boat of a heat with no rollback).
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
  const plan = planInitialHeats(event_id, num_heats);
  const createHeats = db.transaction(() =>
    insertPlannedInitialHeats(event_id, plan),
  );
  return { success: true, ...createHeats() };
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
    const plan = planInitialHeats(event_id, num_heats);

    const recreate = db.transaction(() => {
      wipeHeatsForEvent(event_id);
      return insertPlannedInitialHeats(event_id, plan);
    });
    return { success: true, ...recreate() };
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
      JOIN Sailors s ON b.sailor_id = s.sailor_id
      LEFT JOIN Categories cat ON s.category_id = cat.category_id
      WHERE hb.heat_id = ?
    `,
    )
    .all(heat_id);
  return boats;
});
handle('readAllRaces', async (event, heat_id) => {
  const races = db
    .prepare('SELECT * FROM Races WHERE heat_id = ?')
    .all(heat_id);
  return races;
});

handle('createNewHeatsBasedOnLeaderboard', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  const latestHeats = getLatestQualifyingHeats(event_id);
  checkRaceCountForLatestHeats(latestHeats, db);
  const raceRows = getLatestRaceRowsForHeats(latestHeats);

  // All reads first, then plan, then one transaction of writes.
  const mode = getEventQualifyingAssignmentMode(event_id);
  const boatsByHeatId = new Map<number, PreAssignedBoat[]>();
  const rankedBoatIdsByHeatId = new Map<number, number[]>();
  if (mode === 'pre-assigned') {
    const boatsInHeatQuery = db.prepare(
      `SELECT hb.boat_id, b.country, b.sail_number
       FROM Heat_Boat hb
       JOIN Boats b ON b.boat_id = hb.boat_id
       WHERE hb.heat_id = ?`,
    );
    latestHeats.forEach((heat) => {
      boatsByHeatId.set(
        heat.heat_id,
        boatsInHeatQuery.all(heat.heat_id) as PreAssignedBoat[],
      );
    });
  } else {
    raceRows.forEach((row) => {
      rankedBoatIdsByHeatId.set(
        row.heat_id,
        getAssignmentRowsForHeatRace(row.heat_id, row.race_id).map(
          (boat) => boat.boat_id,
        ),
      );
    });
  }

  const plan = planNextRound({
    latestHeats,
    mode,
    boatsByHeatId,
    rankedBoatIdsByHeatId,
  });
  if (!plan.ok) {
    throw new Error(plan.refusal);
  }

  // Persist the new heats and their boat assignments atomically so a failure
  // can never leave half-created heats behind.
  const { insertHeatStmt, insertHeatBoatStmt } = prepareHeatWriters();
  const persistNewHeats = db.transaction(() => {
    const heatIds = plan.heatNames.map((heatName) =>
      Number(
        insertHeatStmt.run(event_id, heatName, 'Qualifying').lastInsertRowid,
      ),
    );
    plan.assignments.forEach(({ heatIndex, boatId }) => {
      insertHeatBoatStmt.run(heatIds[heatIndex], boatId);
    });
  });
  persistNewHeats();

  const advisory = getOddEvenMovementAdvisory(
    plan.heatCount,
    plan.assignments.length,
  );

  return advisory ? { success: true, advisory } : { success: true };
});

handle('undoLatestHeatRedistribution', async (event, raw_event_id) => {
  const event_id = Number(raw_event_id);
  const latestHeats = getLatestQualifyingHeats(event_id);

  // Guard against deleting the first round: "undo redistribution" must only
  // remove a round that was created from a previous one. First-round heats end
  // in suffix 1 (e.g. "Heat A1"); if nothing has a higher suffix there is no
  // redistribution to undo and deleting would wipe the original heat setup.
  const maxSuffix = latestHeats.reduce((max, heat) => {
    const match = heat.heat_name.match(/(\d+)$/);
    const suffix = match ? parseInt(match[1], 10) : 0;
    return suffix > max ? suffix : max;
  }, 0);
  if (maxSuffix <= 1) {
    throw new Error(
      'There is no heat redistribution to undo — these are the first-round heats.',
    );
  }

  const hasRaceQuery = db.prepare(
    'SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?',
  );

  const heatsWithRaces = latestHeats.filter(
    (heat) => hasRaceQuery.get(heat.heat_id).race_count > 0,
  );

  if (heatsWithRaces.length > 0) {
    throw new Error(
      'Cannot undo heat redistribution because the latest heats already contain races. Undo the last race first.',
    );
  }

  const deleteHeatBoatQuery = db.prepare(
    'DELETE FROM Heat_Boat WHERE heat_id = ?',
  );
  const deleteHeatQuery = db.prepare('DELETE FROM Heats WHERE heat_id = ?');

  const transaction = db.transaction(() => {
    let removedAssignments = 0;
    let removedHeats = 0;

    latestHeats.forEach((heat) => {
      removedAssignments += deleteHeatBoatQuery.run(heat.heat_id).changes;
      removedHeats += deleteHeatQuery.run(heat.heat_id).changes;
    });

    return { removedAssignments, removedHeats };
  });

  const result = transaction();
  return {
    success: true,
    removedAssignments: result.removedAssignments,
    removedHeats: result.removedHeats,
    removedHeatNames: latestHeats.map((heat) => heat.heat_name),
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

    // SHRS 4.1: "Boats shall compete in the same Fleet throughout the Final
    // Series." The UI blocks this, but a direct IPC call must not move a boat
    // into, out of, or between final fleets (RULE-M25).
    if (fromHeat.heat_type === 'Final' || toHeat.heat_type === 'Final') {
      throw new Error(
        'Cannot transfer a boat to or from a Final Series fleet.',
      );
    }

    // A heat that has raced keeps the boats it raced with: moving a boat
    // out would leave her result behind and let her sail the round again in
    // the other heat (two results in one round, which shifted everyone's
    // discards); moving one in would give her no result. The heats page
    // blocks dragging then, but its state can be stale.
    const racedHeat = db
      .prepare(
        `SELECT h.heat_name FROM Heats h
           WHERE h.heat_id IN (?, ?)
             AND EXISTS (SELECT 1 FROM Races r WHERE r.heat_id = h.heat_id)`,
      )
      .get(from_heat_id, to_heat_id) as { heat_name: string } | undefined;
    if (racedHeat) {
      throw new Error(
        `Cannot move a boat: ${racedHeat.heat_name} has already raced. Undo its race first.`,
      );
    }

    // Same SHRS cap the insertHeatBoat handler enforces — a drag-and-drop
    // transfer must not build an oversize heat either.
    const targetCount = db
      .prepare('SELECT COUNT(*) as count FROM Heat_Boat WHERE heat_id = ?')
      .get(to_heat_id) as { count: number };
    if (targetCount.count >= SHRS_MAX_BOATS_PER_HEAT) {
      throw new Error(
        `Cannot assign more than ${SHRS_MAX_BOATS_PER_HEAT} boats to one heat.`,
      );
    }

    const deleteQuery = db.prepare(
      'DELETE FROM Heat_Boat WHERE heat_id = ? AND boat_id = ?',
    );
    // BK-1: OR IGNORE so transferring a boat that is somehow already in the
    // target heat collapses to the target (delete-from-source + no-op insert)
    // instead of throwing on the new UNIQUE(heat_id, boat_id) constraint.
    const insertQuery = db.prepare(
      'INSERT OR IGNORE INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
    );

    // Atomic: a failed insert must not leave the boat removed from both heats
    // (which would drop it from the event's heats entirely).
    const transfer = db.transaction(() => {
      const deleteInfo = deleteQuery.run(from_heat_id, boat_id);
      // The screen showed her in that heat, but she is not there any more
      // (the heats changed since): moving her would put her in two heats.
      if (deleteInfo.changes === 0) {
        throw new Error(
          'That boat is no longer in the heat it was dragged from (the heats changed in the meantime). Nothing was moved; reload the page and try again.',
        );
      }
      const insertInfo = insertQuery.run(to_heat_id, boat_id);
      return {
        removed: deleteInfo.changes,
        inserted: insertInfo.changes,
      };
    });

    transfer();

    // RULE-M13: both heats' membership just changed, so any SHRS 3.1.5
    // assignment snapshot naming this boat in her old heat is stale. Left in
    // place it would seed the next round from the pre-transfer order and put
    // the boat into two next-round heats at once.
    clearAssignmentSnapshotsForHeat(Number(from_heat_id));
    clearAssignmentSnapshotsForHeat(Number(to_heat_id));

    return { success: true };
  },
);
