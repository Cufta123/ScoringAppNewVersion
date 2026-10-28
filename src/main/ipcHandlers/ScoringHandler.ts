import { db } from '../../../public/Database/DBManager';
import handle from './handle';
import { logError } from '../errorLog';
import {
  clearAssignmentSnapshot,
  FrozenAssignmentRow,
  raceAssignmentSnapshots,
} from '../functions/raceAssignmentSnapshot';
import { getLatestRaceForHeat, requireHeat } from '../functions/heatQueries';
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../functions/leaderboardRecompute';
import scoreSubmittedBoat, {
  penaltyHeatSize,
} from '../functions/submittedRaceScore';
import { lockDiscardProfileForRace } from '../functions/eventSettings';
import { assertQualifyingHeatIsOpen } from '../functions/seriesGuards';
import {
  boatsByEntryName,
  describeIndistinguishable,
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

  const heatRow = requireHeat(heat_id);
  // HRH M4: derive the event from the heat itself; ignore the payload value.
  const { event_id } = heatRow;
  if (payloadEventId != null && Number(payloadEventId) !== event_id) {
    logError(
      'submitHeatRaceScoresAtomic',
      `HRH M4: submitHeatRaceScoresAtomic payload event_id ${payloadEventId} does not match heat ${heat_id}'s event ${event_id}; using the heat's event.`,
    );
  }
  const isFinalHeat = heatRow.heat_type === 'Final';
  assertQualifyingHeatIsOpen(heatRow, 'score a race');

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
  const heatSizeForPenalty = penaltyHeatSize(maxHeatSize, placeNumbers.length);

  const existingRaceCount = (
    db
      .prepare('SELECT COUNT(*) AS count FROM Races WHERE heat_id = ?')
      .get(heat_id) as { count: number }
  ).count;
  const nextRaceNumber = existingRaceCount + 1;

  // Each boat's place, points and status, worked out before anything is
  // written (a bad place or code is refused here, with nothing to roll back).
  const scored = placeNumbers.map((entry) => ({
    boat: boatFor(entry.boatNumber)!,
    score: scoreSubmittedBoat(entry, heatSizeForPenalty),
  }));

  const updateScoreStmt = db.prepare(
    'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
  );
  const insertScoreStmt = db.prepare(
    'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
  );

  let raceId = 0;
  const writeScores = db.transaction(() => {
    const raceResult = db
      .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
      .run(heat_id, nextRaceNumber);
    raceId = Number(raceResult.lastInsertRowid);
    seedRaceWithDefaultDnsScores(raceId, heat_id);

    scored.forEach(({ boat, score }) => {
      const updated = updateScoreStmt.run(
        score.position,
        score.points,
        score.status,
        raceId,
        boat.boat_id,
      );
      if (updated.changes === 0) {
        insertScoreStmt.run(
          raceId,
          boat.boat_id,
          score.position,
          score.points,
          score.status,
        );
      }
    });

    if (scored.some(({ score }) => score.finished)) {
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

handle('undoLastScoredRaceForHeat', async (event, raw_heat_id) => {
  const heat_id = Number(raw_heat_id);
  const heatRow = requireHeat(heat_id);
  const lastRace = getLatestRaceForHeat(heat_id);

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

handle(
  'saveLeaderboardRaceResultsAtomic',
  async (
    _event,
    raw_event_id: number | string,
    operations,
    updateFinalLeaderboard = false,
  ) => {
    const event_id = Number(raw_event_id);
    const safeOperations = Array.isArray(operations) ? operations : [];
    // The leaderboard edit screen sends each touched race whole, as shown
    // (see applyRaceColumnState); nothing else is accepted.
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
        applyRaceColumnState(
          event_id,
          Number(operation.raceId),
          operation.cells,
        );
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
