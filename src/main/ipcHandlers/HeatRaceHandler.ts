import { dialog } from 'electron';
import fs from 'fs';
import { db } from '../../../public/Database/DBManager';

import {
  assignBoatsToInitialHeatsSerpentine,
  checkRaceCountForLatestHeats,
  compareByCountryThenSail,
  findLatestHeatsBySuffix,
  generateNextHeatNames,
  getNextHeatIndexByMovementTable,
} from '../functions/creatingNewHeatsUtls';
import { getEventDiscardConfig } from '../functions/discardConfig';
import {
  OverallTiePacket,
  buildOverallTiePacket,
  rankOverallStandings,
} from '../functions/overallTieBreak';
import { fleetNameForIndex } from '../../shared/fleetNames';
import type { PendingRace } from '../../shared/raceProgress';
import { orderFinalLeaderboardRows } from '../functions/finalLeaderboardOrder';
import explainTieBreak from '../functions/explainTieBreak';
import explainBoatScore from '../functions/explainScore';
import refreshStandings from '../functions/standings';
import {
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../functions/eventSnapshot';
import {
  clearAssignmentSnapshot,
  clearAssignmentSnapshotsForHeat,
  FrozenAssignmentRow,
  raceAssignmentSnapshots,
} from '../functions/raceAssignmentSnapshot';
import {
  getLatestQualifyingHeats,
  getRaceCountForHeat,
} from '../functions/heatQueries';
import { getFinalSeriesEligibility } from '../functions/finalSeriesEligibility';
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../functions/leaderboardRecompute';
import {
  getHeatBaseFromName,
  getHeatRoundFromName,
  getScoringPenaltyPoints,
  normalizeScoreStatus,
  scoringPenaltyStatuses,
} from '../functions/scoreStatus';
import handle from './handle';
import { roundPoints } from '../../shared/points';
import {
  SHRS_MAX_BOATS_PER_HEAT,
  getEventHeatOverflowPolicy,
  getEventQualifyingAssignmentMode,
  lockDiscardProfileForRace,
} from '../functions/eventSettings';
import {
  getLatestRaceRowsForHeats,
  getOddEvenMovementAdvisory,
} from '../functions/raceSeeding';
import { getAssignmentRowsForHeatRace } from '../functions/assignmentShield';
import { assertQualifyingHeatIsOpen } from '../functions/seriesGuards';
import {
  boatsByEntryName,
  findIndistinguishableBoats,
  normalizeEntryKey,
} from '../../shared/boatKeys';
import {
  applyRaceColumnState,
  applyRaceTieScoring,
  ensureCompleteRaceScoresForEvent,
  getMaxHeatSize,
  seedRaceWithDefaultDnsScores,
} from '../functions/raceScoring';
import buildAdjustedFleetLeaderboard from '../functions/fleetTotals';
import { sanitizePositiveInteger } from '../functions/validation';

handle('readAllHeats', async (event, event_id) => {
  const heats = db
    .prepare('SELECT * FROM Heats WHERE event_id = ?')
    .all(event_id);
  return heats;
});

handle('exportEventSnapshotToFile', async (_event, event_id) => {
  const snapshot = buildEventSnapshot(Number(event_id));
  const eventNameSafe = String(
    snapshot.tables.Events?.[0]?.event_name || 'event',
  )
    .replace(/[^a-z0-9_-]/gi, '_')
    .slice(0, 60);

  const saveResult = await dialog.showSaveDialog({
    title: 'Save Event Snapshot',
    defaultPath: `${eventNameSafe}_snapshot.json`,
    filters: [{ name: 'JSON files', extensions: ['json'] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(
    saveResult.filePath,
    JSON.stringify(snapshot, null, 2),
    'utf-8',
  );

  return {
    success: true,
    filePath: saveResult.filePath,
  };
});

handle('restoreEventSnapshotFromFile', async (_event, event_id) => {
  const openResult = await dialog.showOpenDialog({
    title: 'Load Event Snapshot',
    properties: ['openFile'],
    filters: [{ name: 'JSON files', extensions: ['json'] }],
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = openResult.filePaths[0];
  const snapshotRaw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(snapshotRaw);

  restoreEventSnapshot(Number(event_id), parsed);

  return {
    success: true,
    filePath,
  };
});

handle('insertHeatBoat', async (event, heat_id, boat_id) => {
  const heatRow = db
    .prepare(
      `SELECT h.heat_id, h.heat_name, h.heat_type, h.event_id
       FROM Heats h
       WHERE h.heat_id = ?`,
    )
    .get(heat_id) as
    | {
        heat_id: number;
        heat_name: string;
        heat_type: string;
        event_id: number;
      }
    | undefined;

  if (!heatRow) {
    throw new Error(
      'This heat no longer exists (it may have been removed in the meantime). Reload the page.',
    );
  }

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

// First-round heat creation, atomically: validates up front (boats exist, the
// SHRS 20-boat cap holds), seeds boats by SHRS 3 order and assigns them with
// the SHRS 3.1 serpentine — all in one transaction so a failure can never
// leave half-created heats behind (the old renderer-side per-row IPC loop
// could die at the 21st boat of a heat with no rollback).
/**
 * Validate an initial-heat split and work out where every boat goes, WITHOUT
 * writing anything. Separated from the insert so "recreate" can prove the new
 * split is buildable before it throws the current heats away.
 */
/** "CRO 12 (boats 4, 9)" — for an error a race officer can act on. */
function describeIndistinguishable(
  groups: Array<{ name: string; boatIds: Array<number | string> }>,
): string {
  return groups
    .map(({ name, boatIds }) =>
      name === ''
        ? `${boatIds.length} boats have no sail number`
        : `${name} is entered ${boatIds.length} times`,
    )
    .join('; ');
}

function planInitialHeats(event_id: any, num_heats: any) {
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
  event_id: any,
  plan: ReturnType<typeof planInitialHeats>,
) {
  const insertHeatStmt = db.prepare(
    'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
  );
  const insertHeatBoatStmt = db.prepare(
    'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
  );
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
function assertNoScoredRacesForEvent(event_id: any) {
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
function wipeHeatsForEvent(event_id: any) {
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

handle('createInitialHeatsAtomic', async (_event, event_id, num_heats) => {
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
handle('recreateInitialHeatsAtomic', async (_event, event_id, num_heats) => {
  assertNoScoredRacesForEvent(event_id);
  const plan = planInitialHeats(event_id, num_heats);

  const recreate = db.transaction(() => {
    wipeHeatsForEvent(event_id);
    return insertPlannedInitialHeats(event_id, plan);
  });
  return { success: true, ...recreate() };
});

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

handle('getMaxHeatSize', async (event, event_id, heat_type) => {
  return getMaxHeatSize(event_id, heat_type || undefined);
});

// Explain the SHRS 5.7 tie-break between two boats for the compare panel.
// The winner is taken from the same comparator the ranking uses, so the panel
// can never disagree with the actual placement. Series flag selects the
// qualifying comparator vs the combined overall (final-series) comparator.
handle(
  'explainTieBreak',
  async (_event, event_id, boatAId, boatBId, isFinalSeries) => {
    return explainTieBreak(
      event_id,
      String(boatAId),
      String(boatBId),
      Boolean(isFinalSeries),
    );
  },
);

// "How was this score calculated?" for one boat: every race's points with the
// rule behind them, the discards, and how ties with other boats were broken.
handle('explainBoatScore', async (_event, event_id, boat_id) => {
  refreshStandings(Number(event_id));
  return explainBoatScore(Number(event_id), Number(boat_id));
});

// SHRS validation of whether the Final Series can start. The renderer renders
// prompts/messages from the returned reason; all the rule logic stays here.
handle('getFinalSeriesEligibility', async (_event, event_id) => {
  return getFinalSeriesEligibility(event_id);
});

// Atomically score a whole race: create the next race for the heat, apply the
// SHRS 5.2 / RRS 44.3(c)/T1 penalty math, persist every boat's score in a
// single transaction, then recompute the relevant leaderboard. Previously this
// lived in the renderer as N sequential IPC calls, so a mid-loop failure could
// leave a half-scored race. Keeping it here makes scoring all-or-nothing and
// keeps the domain logic in the main process.
handle('submitHeatRaceScoresAtomic', async (_event, payload) => {
  const {
    event_id: payloadEventId,
    heat_id,
    placeNumbers,
  } = payload as {
    // HRH M4: event_id may arrive from the renderer but is NOT trusted — the
    // authoritative event is read from the heat row below. Trusting a stale/
    // wrong payload event_id would compute getMaxHeatSize for the wrong event
    // (mis-scoring SHRS 5.2 penalties) and recompute the wrong leaderboard.
    event_id?: number;
    heat_id: number;
    placeNumbers: Array<{
      boatNumber: string | number;
      place: number;
      status: string;
    }>;
    // isFinalSeries may still arrive from older callers but is ignored: the
    // series is derived from the heat row below, so a stale renderer flag can
    // never mis-score penalties or skip the final-leaderboard recompute.
    isFinalSeries?: boolean;
  };

  const heatRow = db
    .prepare(
      'SELECT event_id, heat_type, heat_name FROM Heats WHERE heat_id = ?',
    )
    .get(heat_id) as
    | { event_id: number; heat_type: string; heat_name: string }
    | undefined;
  if (!heatRow) {
    throw new Error(
      'This heat no longer exists (it may have been removed in the meantime). Reload the page.',
    );
  }
  // HRH M4: derive the event from the heat itself; ignore the payload value.
  const { event_id } = heatRow;
  if (payloadEventId != null && Number(payloadEventId) !== event_id) {
    console.warn(
      `HRH M4: submitHeatRaceScoresAtomic payload event_id ${payloadEventId} does not match heat ${heat_id}'s event ${event_id}; using the heat's event.`,
    );
  }
  const isFinalHeat = heatRow.heat_type === 'Final';
  assertQualifyingHeatIsOpen(
    {
      heat_id: Number(heat_id),
      heat_name: heatRow.heat_name,
      event_id,
      heat_type: heatRow.heat_type,
    },
    'score a race',
  );

  const boats = db
    .prepare(
      `SELECT b.boat_id, b.sail_number, b.country
         FROM Heat_Boat hb
         JOIN Boats b ON hb.boat_id = b.boat_id
         WHERE hb.heat_id = ?`,
    )
    .all(heat_id) as Array<{
    boat_id: number;
    sail_number: string | number;
    country: string | null;
  }>;

  // Boats are named by sail number, or by national letters + number where
  // the number is not unique in the heat (ITA 12 and CRO 12, see
  // shared/boatKeys). Only boats no one could tell apart stop scoring.
  const indistinguishable = findIndistinguishableBoats(boats);
  if (indistinguishable.length > 0) {
    throw new Error(
      `Cannot score ${heatRow.heat_name}: ${describeIndistinguishable(indistinguishable)}.`,
    );
  }

  const boatsByName = boatsByEntryName(boats);
  const boatFor = (boatNumber: unknown) =>
    boatsByName.get(normalizeEntryKey(boatNumber));

  // The same boat named twice would score her twice; refuse rather than
  // keep whichever came last.
  const named = new Set<number>();
  placeNumbers.forEach(({ boatNumber }) => {
    const boat = boatFor(boatNumber);
    if (!boat) return;
    if (named.has(boat.boat_id)) {
      throw new Error(
        `Cannot score ${heatRow.heat_name}: sail ${String(boatNumber)} is in the result twice.`,
      );
    }
    named.add(boat.boat_id);
  });

  const unmatched = placeNumbers
    .map((entry) => entry.boatNumber)
    .filter((boatNumber) => !boatFor(boatNumber));

  // Surface a structured result so the renderer can show a targeted message
  // instead of throwing. Nothing has been written at this point.
  if (unmatched.length > 0) {
    return { ok: false as const, reason: 'UNMATCHED_SAILS', unmatched };
  }

  const heatType = isFinalHeat ? 'Final' : 'Qualifying';
  const maxHeatSize = getMaxHeatSize(event_id, heatType);
  const heatSizeForPenalty = maxHeatSize || placeNumbers.length;
  const penaltyPlace = heatSizeForPenalty + 1;

  const existingRaceCount = (
    db
      .prepare('SELECT COUNT(*) AS count FROM Races WHERE heat_id = ?')
      .get(heat_id) as { count: number }
  ).count;
  const nextRaceNumber = existingRaceCount + 1;

  let raceId = 0;
  const writeScores = db.transaction(() => {
    const raceResult = db
      .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
      .run(heat_id, nextRaceNumber);
    raceId = Number(raceResult.lastInsertRowid);
    seedRaceWithDefaultDnsScores(raceId, heat_id);

    let hasFinisher = false;
    placeNumbers.forEach(({ boatNumber, place, status }) => {
      const boat = boatFor(boatNumber)!;
      const normalizedStatus = normalizeScoreStatus(status);

      let position: number;
      let points: number;
      if (normalizedStatus === 'FINISHED') {
        // BK-6: a FINISHED place must be a positive integer; a 0 / NaN place
        // would otherwise be written straight to Scores.position/points.
        const finishingPlace = sanitizePositiveInteger(
          place,
          `The place of sail ${String(boatNumber)}`,
        );
        position = finishingPlace;
        points = finishingPlace;
        hasFinisher = true;
      } else if (scoringPenaltyStatuses.has(normalizedStatus)) {
        // ZFP/SCP/T1: keep finishing place, add the scoring-penalty places.
        const finishingPlace = sanitizePositiveInteger(
          place,
          `The place of sail ${String(boatNumber)}`,
        );
        position = finishingPlace;
        points = getScoringPenaltyPoints(
          finishingPlace,
          heatSizeForPenalty,
          normalizedStatus,
        );
      } else {
        // Non-scoring penalties (DNF/DNS/...) take the penalty score AND the
        // shared penalty position (largest-heat size + 1) per SHRS 5.2, so
        // their `place` is discarded and must NOT be sanitized — the old
        // `place || penaltyPlace` tolerated a falsy place, and a legacy caller
        // may send 0/'' for "no place".
        // BK-3: the frontend always sends a sequential `place` (>=1), so the
        // old `place || penaltyPlace` never fell through to penaltyPlace and
        // these boats were stored with sequential positions (5, 6, …)
        // instead of the shared penaltyPlace. Points were already correct.
        position = penaltyPlace;
        points = penaltyPlace;
      }

      const updated = db
        .prepare(
          'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
        )
        .run(position, points, normalizedStatus, raceId, boat.boat_id);
      if (updated.changes === 0) {
        db.prepare(
          'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
        ).run(raceId, boat.boat_id, position, points, normalizedStatus);
      }
    });

    if (hasFinisher) {
      applyRaceTieScoring(raceId);
    }
    lockDiscardProfileForRace(raceId);

    // BK-2: recompute leaderboards inside the same transaction so a recompute
    // failure rolls back the entire scoring write. Previously the recompute ran
    // after writeScores() committed, leaving scores persisted but leaderboards
    // stale on failure — a retry would then create a duplicate race.
    if (isFinalHeat) {
      recomputeFinalLeaderboard(event_id);
    } else {
      // Score boats that sailed in none of a completed round's heats DNC
      // (RRS A5.1 / SHRS 5.3), then rebuild the standings. Only races every
      // heat of their round has sailed count (CountedRaces), so a round
      // still being sailed leaves the standings as after the last full one.
      ensureCompleteRaceScoresForEvent(event_id, 'Qualifying');
      recomputeEventLeaderboard(event_id);
    }
  });

  writeScores();

  return { ok: true as const, raceNumber: nextRaceNumber, raceId };
});

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
    const transaction = db.transaction(() => {
      const insertedFinalHeatIds: number[] = [];
      for (let i = 0; i < finalHeatCount; i += 1) {
        // SHRS 4.1 fleet naming, shared with the ranking precedence used by
        // the leaderboard reads so "Fleet 5" is always ranked 5th (RULE-m2).
        const fleetName = fleetNameForIndex(i);
        const insertResult = db
          .prepare(
            'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
          )
          .run(event_id, `Final ${fleetName}`, 'Final');
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
          db.prepare(
            'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
          ).run(insertedFinalHeatIds[i], boat.boat_id);
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

handle('createNewHeatsBasedOnLeaderboard', async (event, event_id) => {
  const latestHeats = getLatestQualifyingHeats(event_id);
  checkRaceCountForLatestHeats(latestHeats, db);
  const raceRows = getLatestRaceRowsForHeats(latestHeats);

  const sortedLatestHeats = [...latestHeats].sort((left, right) =>
    getHeatBaseFromName(left.heat_name).localeCompare(
      getHeatBaseFromName(right.heat_name),
    ),
  );
  const heatIndexById = new Map<number, number>();
  sortedLatestHeats.forEach((heat, index) => {
    heatIndexById.set(heat.heat_id, index);
  });

  const raceByHeatId = new Map<
    number,
    { race_id: number; race_number: number }
  >();
  raceRows.forEach((row) => {
    raceByHeatId.set(row.heat_id, {
      race_id: row.race_id,
      race_number: row.race_number,
    });
  });

  // Define the new race number
  const heatNameMatch = sortedLatestHeats[0].heat_name.match(/(\d+)$/);
  const lastRaceNumber = heatNameMatch ? parseInt(heatNameMatch[1], 10) : 0;
  const raceNumber = lastRaceNumber + 1;
  // Generate names for the next round of heats
  const nextHeatNames = generateNextHeatNames(sortedLatestHeats);

  // Compute boat assignments (index-based) from current results first — these
  // are all reads, so the heat + assignment writes below can run as a single
  // atomic transaction.
  const assignmentMode = getEventQualifyingAssignmentMode(event_id);
  const assignments: { heatId: number; boatId: string }[] = [];
  if (assignmentMode === 'pre-assigned') {
    sortedLatestHeats.forEach((heat) => {
      const sourceIndex = heatIndexById.get(heat.heat_id);
      if (sourceIndex === undefined) {
        return;
      }

      const boatsInHeat = db
        .prepare(
          `SELECT hb.boat_id, b.country, b.sail_number
           FROM Heat_Boat hb
           JOIN Boats b ON b.boat_id = hb.boat_id
           WHERE hb.heat_id = ?`,
        )
        .all(heat.heat_id) as {
        boat_id: string;
        country: string | null;
        sail_number: string | number | null;
      }[];

      // Sort in JS with the shared SHRS 3 comparator (numeric-aware sail
      // numbers) so redistribution seeds boats in the same order as initial
      // heat creation — SQL ORDER BY sorts "10" before "9".
      boatsInHeat.sort(
        (left, right) =>
          compareByCountryThenSail(left, right) ||
          String(left.boat_id).localeCompare(String(right.boat_id)),
      );

      boatsInHeat.forEach((boat) => {
        assignments.push({ heatId: sourceIndex, boatId: boat.boat_id });
      });
    });
  } else {
    sortedLatestHeats.forEach((heat) => {
      const sourceIndex = heatIndexById.get(heat.heat_id);
      const raceForHeat = raceByHeatId.get(heat.heat_id);
      if (sourceIndex === undefined || !raceForHeat) {
        return;
      }

      const rankedBoats = getAssignmentRowsForHeatRace(
        heat.heat_id,
        raceForHeat.race_id,
      );
      rankedBoats.forEach((boat, rankIndex) => {
        const targetHeatIndex = getNextHeatIndexByMovementTable(
          sourceIndex,
          rankIndex + 1,
          sortedLatestHeats.length,
        );
        assignments.push({ heatId: targetHeatIndex, boatId: boat.boat_id });
      });
    });
  }
  // No silent fallback. Reaching here means the movement table (or the
  // pre-assigned carry-forward) found nothing to redistribute, which is a data
  // fault: the previous round's heats are empty, or its results never reached
  // Scores. Re-seeding from scratch would discard the finishing positions
  // SHRS 3.1(2) requires the assignment to be based on, and would silently
  // reshuffle the fleet into a draw nobody sailed for. Fail loudly so the race
  // office repairs the round instead.
  if (assignments.length === 0) {
    const heatList = sortedLatestHeats.map((heat) => heat.heat_name).join(', ');
    const cause =
      assignmentMode === 'pre-assigned'
        ? 'Those heats have no boats assigned to them.'
        : 'Those heats have no recorded results to move boats from.';
    throw new Error(
      `Cannot build round ${raceNumber}: no boats could be assigned from ${heatList}. ${cause} Check that the previous round is fully scored before redistributing.`,
    );
  }

  // Persist the new heats and their boat assignments atomically so a failure
  // can never leave half-created heats behind.
  const heatIds: any[] = [];
  const insertHeatStmt = db.prepare(
    'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
  );
  const insertHeatBoatStmt = db.prepare(
    'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
  );
  const persistNewHeats = db.transaction(() => {
    nextHeatNames.forEach((heatName) => {
      const { lastInsertRowid: newHeatId } = insertHeatStmt.run(
        event_id,
        heatName,
        'Qualifying',
      );
      heatIds.push(newHeatId);
    });
    assignments.forEach(({ heatId, boatId }) => {
      insertHeatBoatStmt.run(heatIds[heatId], boatId);
    });
  });
  persistNewHeats();

  const advisory = getOddEvenMovementAdvisory(
    sortedLatestHeats.length,
    assignments.length,
  );

  return advisory ? { success: true, advisory } : { success: true };
});

handle('undoLastScoredRaceForHeat', async (event, heat_id) => {
  const heatRow = db
    .prepare(
      'SELECT h.heat_id, h.heat_name, h.event_id, h.heat_type FROM Heats h WHERE h.heat_id = ?',
    )
    .get(heat_id) as
    | {
        heat_id: number;
        heat_name: string;
        event_id: number;
        heat_type: string;
      }
    | undefined;

  if (!heatRow) {
    throw new Error(
      'This heat no longer exists (it may have been removed in the meantime). Reload the page.',
    );
  }

  const lastRace = db
    .prepare(
      `SELECT race_id, race_number
       FROM Races
       WHERE heat_id = ?
       ORDER BY race_number DESC, race_id DESC
       LIMIT 1`,
    )
    .get(heat_id) as { race_id: number; race_number: number } | undefined;

  if (!lastRace) {
    throw new Error(
      `No scored races found for heat "${heatRow.heat_name}". There is nothing to undo.`,
    );
  }

  assertQualifyingHeatIsOpen(heatRow, 'undo the last race');

  const deleteScores = db.prepare('DELETE FROM Scores WHERE race_id = ?');
  const deleteRace = db.prepare('DELETE FROM Races  WHERE race_id = ?');

  // One transaction for the delete AND the recompute, so a failure can never
  // leave the race gone with the standings still counting it.
  const transaction = db.transaction(() => {
    // The SHRS 3.1.5 snapshot references the race, and foreign keys are
    // enforced with no ON DELETE CASCADE: it has to go first, or any race
    // carrying a protest decision cannot be undone at all ("FOREIGN KEY
    // constraint failed" — the bug deleteEvent once had).
    clearAssignmentSnapshot(lastRace.race_id);
    const removedScores = deleteScores.run(lastRace.race_id).changes;
    deleteRace.run(lastRace.race_id);
    recomputeEventLeaderboard(heatRow.event_id);
    // Undoing a FINAL race must refresh the final standings too — the event
    // leaderboard alone leaves FinalLeaderboard reflecting the deleted race.
    if (heatRow.heat_type === 'Final') {
      recomputeFinalLeaderboard(heatRow.event_id);
    }
    return removedScores;
  });

  const removedScores = transaction();

  return {
    success: true,
    heatName: heatRow.heat_name,
    raceNumber: lastRace.race_number,
    removedScores,
  };
});

handle('undoLatestHeatRedistribution', async (event, event_id) => {
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

    const heatQuery = db.prepare(
      'SELECT event_id, heat_type FROM Heats WHERE heat_id = ?',
    );
    const fromHeat = heatQuery.get(from_heat_id) as
      | { event_id: number; heat_type: string }
      | undefined;
    const toHeat = heatQuery.get(to_heat_id) as
      | { event_id: number; heat_type: string }
      | undefined;
    if (!fromHeat || !toHeat) {
      throw new Error(
        'This heat no longer exists (it may have been removed in the meantime). Reload the page.',
      );
    }
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

handle(
  'saveLeaderboardRaceResultsAtomic',
  async (_event, event_id, operations, updateFinalLeaderboard = false) => {
    const safeOperations = Array.isArray(operations) ? operations : [];
    // The leaderboard edit screen sends each touched race whole, as it shows
    // it (see applyRaceColumnState); nothing else is accepted.
    if (safeOperations.some((operation) => !Array.isArray(operation?.cells))) {
      throw new Error(
        'This change did not include the whole race it belongs to, so it was not saved. Reload the leaderboard and make the change again.',
      );
    }

    // Rollback guard for the in-memory assignment-snapshot cache: the cache
    // Map survives a DB rollback, so back up each touched race's frozen rows
    // and restore them wholesale on failure. A presence-only guard is not
    // enough because an unshield mutates an existing entry rather than adding
    // one (RULE-M21).
    const snapshotRaceIds = [
      ...new Set(safeOperations.map((operation) => Number(operation.raceId))),
    ];
    const snapshotBackups = new Map<
      number,
      Map<string, FrozenAssignmentRow> | null
    >();
    snapshotRaceIds.forEach((raceId) => {
      const existing = raceAssignmentSnapshots.get(raceId);
      snapshotBackups.set(raceId, existing ? new Map(existing) : null);
    });

    const tx = db.transaction(() => {
      safeOperations.forEach((operation) => {
        applyRaceColumnState(event_id, operation.raceId, operation.cells);
        lockDiscardProfileForRace(Number(operation.raceId));
      });

      recomputeEventLeaderboard(event_id);
      if (updateFinalLeaderboard) {
        recomputeFinalLeaderboard(event_id);
      }
    });

    try {
      tx();
    } catch (error) {
      snapshotBackups.forEach((backup, raceId) => {
        if (backup) {
          raceAssignmentSnapshots.set(raceId, backup);
        } else {
          raceAssignmentSnapshots.delete(raceId);
        }
      });
      throw error;
    }
    return { success: true, updatedCount: safeOperations.length };
  },
);

/**
 * Qualifying results of a round still being sailed: heats that have sailed a
 * race other heats of the round have not (see CountedRaces). Shown on the
 * leaderboard, greyed, and not counted until the round is complete.
 */
function readRacesInProgress(event_id: any) {
  const rows = db
    .prepare(
      `SELECT sc.boat_id, sc.race_id, sc.position, sc.points,
              COALESCE(sc.status, 'DNS') AS status, h.heat_name, r.race_number
       FROM Scores sc
       JOIN Races r ON r.race_id = sc.race_id
       JOIN Heats h ON h.heat_id = r.heat_id
       LEFT JOIN CountedRaces cr ON cr.race_id = sc.race_id
       WHERE h.event_id = ? AND h.heat_type = 'Qualifying' AND cr.race_id IS NULL
       ORDER BY r.race_number, r.race_id`,
    )
    .all(event_id) as PendingRace[];
  const byBoat = new Map<number, PendingRace[]>();
  rows.forEach((row) => {
    const list = byBoat.get(Number(row.boat_id)) ?? [];
    list.push(row);
    byBoat.set(Number(row.boat_id), list);
  });
  return { rows, byBoat };
}

handle('readLeaderboard', async (event, event_id) => {
  // The stored standings are only a cache: rebuild them from the scores on
  // every read, so the screen can never show stale places (cheap: one event).
  db.transaction(() => {
    ensureCompleteRaceScoresForEvent(event_id, 'Qualifying');
    recomputeEventLeaderboard(event_id);
  })();

  const query =
    'SELECT ' +
    'lb.boat_id, ' +
    'lb.total_points_event, ' +
    'lb.place, ' +
    'b.sail_number AS boat_number, ' +
    'b.model AS boat_type, ' +
    's.name, ' +
    's.surname, ' +
    'b.country, ' +
    'GROUP_CONCAT(sc.position ORDER BY r.race_number, r.race_id) AS race_positions, ' +
    'GROUP_CONCAT(sc.points ORDER BY r.race_number, r.race_id) AS race_points, ' +
    'GROUP_CONCAT(r.race_id ORDER BY r.race_number, r.race_id) AS race_ids, ' +
    "GROUP_CONCAT(COALESCE(sc.status, 'DNS') ORDER BY r.race_number, r.race_id) AS race_statuses " +
    'FROM Leaderboard lb ' +
    'LEFT JOIN Boats b ON lb.boat_id = b.boat_id ' +
    'LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id ' +
    'LEFT JOIN Scores sc ON sc.boat_id = b.boat_id ' +
    'LEFT JOIN Races r ON sc.race_id = r.race_id ' +
    'LEFT JOIN Heats h ON r.heat_id = h.heat_id ' +
    // Only races every heat of the round has sailed (SHRS 1.1).
    'JOIN CountedRaces cr ON cr.race_id = sc.race_id ' +
    "WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying' " +
    'AND sc.race_id IS NOT NULL ' +
    'GROUP BY lb.boat_id ' +
    'ORDER BY lb.place ASC';
  const readQuery = db.prepare(query);
  const pending = readRacesInProgress(event_id);
  const results = (readQuery.all(event_id, event_id) as any[]).map((row) => ({
    ...row,
    pending_races: pending.byBoat.get(Number(row.boat_id)) ?? [],
  }));
  return results;
});

handle('readFinalLeaderboard', async (event, event_id) => {
  // Rebuilt on every read, like readLeaderboard: never a stale table.
  db.transaction(() => {
    ensureCompleteRaceScoresForEvent(event_id, 'Final');
    recomputeFinalLeaderboard(event_id);
  })();

  // The final-score join is a LEFT JOIN onto a pre-filtered subquery so that
  // boats in fleets that have not raced yet (SHRS 4.5) still return a row —
  // with NULL race CSVs — instead of being dropped from the leaderboard.
  const query =
    'SELECT ' +
    'fl.boat_id, ' +
    'fl.total_points_final, ' +
    'fl.event_id, ' +
    'fl.placement_group, ' +
    // SHRS 1.5 needs the qualifying series score to rank by when the Final
    // Series has no completed races.
    'COALESCE(lb.total_points_event, 0) AS qualifying_points, ' +
    'b.sail_number AS boat_number, ' +
    'b.model AS boat_type, ' +
    's.name, ' +
    's.surname, ' +
    'b.country, ' +
    'GROUP_CONCAT(fs.position ORDER BY fs.race_number, fs.race_id) AS race_positions, ' +
    'GROUP_CONCAT(fs.points ORDER BY fs.race_number, fs.race_id) AS race_points, ' +
    'GROUP_CONCAT(fs.race_id ORDER BY fs.race_number, fs.race_id) AS race_ids, ' +
    "GROUP_CONCAT(COALESCE(fs.status, 'DNS') ORDER BY fs.race_number, fs.race_id) AS race_statuses " +
    'FROM FinalLeaderboard fl ' +
    'LEFT JOIN Boats b ON fl.boat_id = b.boat_id ' +
    'LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id ' +
    'LEFT JOIN Leaderboard lb ON lb.boat_id = fl.boat_id AND lb.event_id = fl.event_id ' +
    'LEFT JOIN (' +
    'SELECT sc.boat_id, sc.position, sc.points, sc.status, sc.race_id, r.race_number ' +
    'FROM Scores sc ' +
    'JOIN Races r ON sc.race_id = r.race_id ' +
    'JOIN Heats h ON r.heat_id = h.heat_id ' +
    "WHERE h.event_id = ? AND h.heat_type = 'Final'" +
    ') fs ON fs.boat_id = fl.boat_id ' +
    'WHERE fl.event_id = ? ' +
    'GROUP BY fl.boat_id';
  // Ordering is done in JS below: SHRS 5.5 fleet precedence has to cover the
  // "Fleet 5"+ overflow names (RULE-m2), and SHRS 1.5 switches the sort key
  // entirely when no final race has been completed. Encoding either in SQL
  // would need interpolated CASE arms, so the query stays unordered and one
  // comparator owns the rule.
  const readQuery = db.prepare(query);
  // SHRS 5.5 fleet precedence + SHRS 1.5 qualifying-score fallback — see
  // functions/finalLeaderboardOrder.ts.
  const results = orderFinalLeaderboardRows(
    readQuery.all(event_id, event_id) as any[],
  );
  return results;
});

/**
 * SHRS 5.4: A boat's overall series score = qualifying series score + final series score.
 * Gold fleet boats rank before Silver, Silver before Bronze, etc.
 * SHRS 1.5: If no races are completed in the Final Series, boats are ranked
 * according to their series score in the Qualifying Series.
 */
handle('readOverallLeaderboard', async (event, event_id) => {
  refreshStandings(Number(event_id));
  // SHRS 1.5: "If no races are completed in the Final Series boats will be
  // ranked according to their series score in the Qualifying Series." A final
  // race is "completed" once it has been SAILED — i.e. once ANY boat has a
  // final-series score — not once every boat in the heat is scored. Counting
  // final score rows (rather than fully-scored races) keeps this in step with
  // finalLeaderboardOrder.hasNoCompletedFinalRaces, so the Final and Overall
  // tables never disagree on a partially-scored final race.
  const finalScoreCount = db
    .prepare(
      `SELECT COUNT(*) as cnt
     FROM Scores sc
     JOIN Races r ON sc.race_id = r.race_id
     JOIN Heats h ON r.heat_id = h.heat_id
     WHERE h.event_id = ? AND h.heat_type = 'Final'`,
    )
    .get(event_id) as { cnt: number };

  // SHRS 1.5: If no completed final races, rank by qualifying only.
  if (!finalScoreCount || finalScoreCount.cnt === 0) {
    const qualifyingResults = db
      .prepare(
        `SELECT
        lb.boat_id,
        lb.total_points_event AS overall_points,
        lb.place,
        'Qualifying' AS placement_group,
        b.sail_number AS boat_number,
        b.model AS boat_type,
        s.name,
        s.surname,
        b.country
      FROM Leaderboard lb
      LEFT JOIN Boats b ON lb.boat_id = b.boat_id
      LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
      WHERE lb.event_id = ?
      ORDER BY lb.place ASC`,
      )
      .all(event_id);
    return qualifyingResults;
  }

  // Combined overall series: qualifying score + final score.
  // The SQL orders only by points; SHRS 5.5 fleet precedence is applied by
  // the JS comparator below, which understands the "Fleet 5"+ overflow names
  // a fixed CASE cannot (RULE-m2).
  const overallQuery = db.prepare(
    `SELECT
      fl.boat_id,
      COALESCE(lb.total_points_event, 0) AS qualifying_points,
      fl.total_points_final AS final_points,
      COALESCE(lb.total_points_event, 0) + fl.total_points_final AS overall_points,
      fl.placement_group,
      fl.place AS final_place,
      b.sail_number AS boat_number,
      b.model AS boat_type,
      s.name,
      s.surname,
      b.country
    FROM FinalLeaderboard fl
    LEFT JOIN Leaderboard lb ON fl.boat_id = lb.boat_id AND lb.event_id = fl.event_id
    LEFT JOIN Boats b ON fl.boat_id = b.boat_id
    LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
    WHERE fl.event_id = ?
    ORDER BY overall_points ASC, fl.place ASC`,
  );

  // Normalise the SQL sums so equal overall totals compare equal (see
  // shared/points.ts) — otherwise a tie group below can be split by noise.
  const results = (overallQuery.all(event_id) as any[]).map((row) => ({
    ...row,
    overall_points: roundPoints(Number(row.overall_points)),
  }));

  const tiePacketCache = new Map<any, OverallTiePacket>();
  const getTiePacket = (boatId: any) => {
    if (!tiePacketCache.has(boatId)) {
      tiePacketCache.set(boatId, buildOverallTiePacket(event_id, boatId));
    }
    return tiePacketCache.get(boatId) as OverallTiePacket;
  };
  const ranked = rankOverallStandings(results, getTiePacket);

  return ranked;
});
