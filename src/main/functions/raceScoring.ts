/**
 * Writes to the Scores table: seeding a new race, repairing missing rows,
 * applying a single result edit (RRS A6.1/A6.2/A7, SHRS 5.2), and re-averaging
 * shared places. Everything that changes a boat's score for one race lives
 * here so the rules are applied in one place.
 */
import { db } from '../../../public/Database/DBManager';
import computeTiePlacements from '../../shared/raceTieScoring';
import applyRaceColumnEdit from '../../shared/raceColumnEdit';
import { captureRaceAssignmentSnapshotIfMissing } from './assignmentShield';
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from './leaderboardRecompute';
import { unshieldBoatFromAssignmentSnapshot } from './raceAssignmentSnapshot';
import {
  getScoringPenaltyPoints,
  isNonScoringPenalty,
  normalizeScoreStatus,
  protestCommitteeStatuses,
  rdgStatuses,
  scoringPenaltyStatuses,
} from './scoreStatus';
import { sanitizePositiveFinite, sanitizePositiveInteger } from './validation';

/**
 * SHRS 5.2: Get the number of boats in the largest heat for an event.
 * Used for penalty scoring (DNS, DSQ, RET, etc. = largest heat size + 1).
 */
export function getMaxHeatSize(event_id: any, heat_type?: string): number {
  const heatTypeFilter = heat_type ? `AND h.heat_type = ?` : '';
  const sql = `
    SELECT MAX(boat_count) AS max_boats
    FROM (
      SELECT COUNT(*) AS boat_count
      FROM Heat_Boat hb
      JOIN Heats h ON hb.heat_id = h.heat_id
      WHERE h.event_id = ? ${heatTypeFilter}
      GROUP BY hb.heat_id
    )
  `;
  const row = heat_type
    ? (db.prepare(sql).get(event_id, heat_type) as
        | { max_boats: number | null }
        | undefined)
    : (db.prepare(sql).get(event_id) as
        | { max_boats: number | null }
        | undefined);
  return row?.max_boats ?? 0;
}

export function seedRaceWithDefaultDnsScores(
  race_id: number,
  heat_id: number,
): void {
  const heatMeta = db
    .prepare('SELECT event_id, heat_type FROM Heats WHERE heat_id = ?')
    .get(heat_id) as { event_id: number; heat_type: string } | undefined;

  if (!heatMeta) {
    return;
  }

  const penaltyPosition =
    getMaxHeatSize(heatMeta.event_id, heatMeta.heat_type) + 1;
  const boatRows = db
    .prepare('SELECT boat_id FROM Heat_Boat WHERE heat_id = ?')
    .all(heat_id) as { boat_id: number }[];

  const updateExisting = db.prepare(
    `UPDATE Scores
     SET position = ?, points = ?, status = 'DNS'
     WHERE race_id = ? AND boat_id = ?`,
  );
  const insertNew = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, 'DNS')`,
  );

  const tx = db.transaction(() => {
    boatRows.forEach((row) => {
      const updated = updateExisting.run(
        penaltyPosition,
        penaltyPosition,
        race_id,
        row.boat_id,
      );
      if (updated.changes === 0) {
        insertNew.run(race_id, row.boat_id, penaltyPosition, penaltyPosition);
      }
    });
  });

  tx();
}

export function ensureCompleteRaceScoresForEvent(
  event_id: any,
  heatType: 'Qualifying' | 'Final',
): number {
  const missingRows = db
    .prepare(
      `SELECT r.race_id, hb.boat_id
       FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id
       JOIN Heat_Boat hb ON hb.heat_id = h.heat_id
       LEFT JOIN Scores s ON s.race_id = r.race_id AND s.boat_id = hb.boat_id
       WHERE h.event_id = ? AND h.heat_type = ? AND s.score_id IS NULL`,
    )
    .all(event_id, heatType) as { race_id: number; boat_id: number }[];

  if (missingRows.length === 0) {
    return 0;
  }

  const penaltyPosition = getMaxHeatSize(event_id, heatType) + 1;
  const insertMissingScore = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, 'DNS')`,
  );

  const transaction = db.transaction(() => {
    missingRows.forEach((row) => {
      insertMissingScore.run(
        row.race_id,
        row.boat_id,
        penaltyPosition,
        penaltyPosition,
      );
    });
  });

  transaction();
  console.warn(
    `[Data integrity] Repaired ${missingRows.length} missing score row(s) as DNS for event ${event_id} (${heatType}).`,
  );
  return missingRows.length;
}

export function applyRaceTieScoring(race_id: number): void {
  // Position-keeping penalties (ZFP/SCP/T1) keep their finishing place, so they
  // occupy a slot in the finishing order even though their points are computed
  // separately. They must be included in the place walk; otherwise finishers
  // behind them would be compacted up a place and lose points (RRS A7 / 44.3c).
  const penaltyList = [...scoringPenaltyStatuses]
    .map((status) => `'${status}'`)
    .join(', ');
  const rankedRows = db
    .prepare(
      `SELECT score_id, position, status
       FROM Scores
       WHERE race_id = ? AND (status = 'FINISHED' OR status IN (${penaltyList}))
       ORDER BY position ASC, score_id ASC`,
    )
    .all(race_id) as { score_id: number; position: number; status: string }[];

  if (rankedRows.length === 0) {
    return;
  }

  const updateScore = db.prepare(
    'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
  );

  // The place walk itself lives in shared/raceTieScoring so the renderer's
  // edit preview cannot drift from what is persisted here.
  computeTiePlacements(rankedRows).forEach((placement) => {
    updateScore.run(
      placement.position,
      placement.points,
      rankedRows[placement.index].score_id,
    );
  });
}

export function applyRaceResultUpdate(
  event_id: any,
  race_id: any,
  boat_id: any,
  new_position: any,
  shift_positions: boolean,
  new_status: any,
) {
  const status = normalizeScoreStatus(new_status);
  const isRdg = rdgStatuses.includes(status);
  const isScoringPenalty = scoringPenaltyStatuses.has(status);
  // RRS A10: DPI points are set by the protest committee, so — like RDG — the
  // frontend-provided value is kept verbatim and never auto-derived to
  // (largest heat + 1). Grouped with RDG under `keepsProvidedPoints`.
  const keepsProvidedPoints = isRdg || status === 'DPI';

  // Determine heat info used by SHRS 5.2 / 44.3(c) scoring.
  const heatRow = db
    .prepare(
      `SELECT h.heat_id, h.heat_type FROM Heats h
       JOIN Races r ON r.heat_id = h.heat_id
       WHERE r.race_id = ?`,
    )
    .get(race_id) as { heat_id: number; heat_type: string } | undefined;
  const heatType = heatRow?.heat_type ?? 'Qualifying';
  const maxBoats = getMaxHeatSize(event_id, heatType);

  // RULE-M14 / SHRS 3.1.5: only a PROTEST-COMMITTEE decision is shielded from
  // changing heat assignments, so only such an edit snapshots the pre-decision
  // order. This used to fire on every score correction, which meant a single
  // mistyped finishing place permanently froze the heat assignment for the rest
  // of the event even though the rule says nothing about race-office fixes.
  if (heatRow?.heat_id != null) {
    if (protestCommitteeStatuses.has(status)) {
      captureRaceAssignmentSnapshotIfMissing(
        heatRow.heat_id,
        Number(race_id),
        boat_id,
      );
    } else {
      // An ordinary race-office correction is NOT shielded by 3.1.5, so this
      // boat's frozen slot must be dropped so its corrected result drives the
      // next assignment. Only THIS boat is un-shielded (RULE-M21): other boats'
      // protest decisions keep their shields — clearing the whole race here
      // would erase them.
      unshieldBoatFromAssignmentSnapshot(Number(race_id), boat_id);
    }
  }

  // For RDG and DPI statuses keep the frontend-provided value (PC-set);
  // for ZFP/SCP apply scoring penalty on finishing place;
  // for other penalties use largest-heat size + 1 per SHRS 5.2.
  // BK-6: guard against NaN/0/negative before writing. RDG/DPI are PC-set and
  // may be fractional or < 1 (CMP C-23/C-24), so they only need to be finite and
  // positive; every other status writes a finishing place (positive whole number).
  const positionContext = `Position for ${status}`;
  // BK-6: non-scoring penalties (DNF/DNS/DSQ/...) are always scored at
  // maxBoats + 1 (SHRS 5.2), so their provided position is discarded and must
  // NOT be validated — a legacy caller may send 0/'' for "no place". Only
  // values that are actually written (FINISHED, ZFP/SCP/T1, RDG/DPI) are
  // sanitized. The classification lives in scoreStatus.isNonScoringPenalty so
  // the write path and re-derivation share one definition.
  const isNonScoringPenaltyStatus = isNonScoringPenalty(status);
  let finalPosition: number;
  let points: number;
  if (isNonScoringPenaltyStatus) {
    finalPosition = maxBoats + 1;
    points = finalPosition;
  } else if (keepsProvidedPoints) {
    finalPosition = sanitizePositiveFinite(new_position, positionContext);
    points = finalPosition;
  } else {
    finalPosition = sanitizePositiveInteger(new_position, positionContext);
    points = isScoringPenalty
      ? getScoringPenaltyPoints(finalPosition, maxBoats, status)
      : finalPosition;
  }

  const currentResult = db
    .prepare(
      `SELECT position, COALESCE(status, 'FINISHED') as status
              FROM Scores
              WHERE race_id = ? AND boat_id = ?
              ORDER BY score_id DESC
              LIMIT 1`,
    )
    .get(race_id, boat_id) as { position: number; status: string } | undefined;

  if (!currentResult) {
    throw new Error(
      `Current result not found for race_id: ${race_id}, boat_id: ${boat_id}`,
    );
  }
  const currentPosition = currentResult.position;
  const previousStatus = normalizeScoreStatus(currentResult.status);

  // Load the whole race so the rule application below is a pure computation
  // over its cells. The transformation — the RRS A6.1 promotion, the manual
  // place ripple, and the RRS A7 re-average — lives in shared/raceColumnEdit,
  // so the renderer's edit preview runs the very same code and cannot drift
  // from what is persisted here.
  const raceRows = db
    .prepare(
      `SELECT score_id, boat_id, position, points,
              COALESCE(status, 'FINISHED') AS status
       FROM Scores
       WHERE race_id = ?
       ORDER BY score_id ASC`,
    )
    .all(race_id) as {
    score_id: number;
    boat_id: number;
    position: number;
    points: number;
    status: string;
  }[];

  const editedIndex = raceRows.findIndex(
    (row) => String(row.boat_id) === String(boat_id),
  );
  if (editedIndex === -1) {
    throw new Error(
      `Current result not found for race_id: ${race_id}, boat_id: ${boat_id}`,
    );
  }

  const updatedCells = applyRaceColumnEdit(
    raceRows.map((row) => ({
      position: row.position,
      points: row.points,
      status: normalizeScoreStatus(row.status),
    })),
    {
      index: editedIndex,
      previousPosition: currentPosition,
      previousStatus,
      newPosition: finalPosition,
      newPoints: points,
      newStatus: status,
      shiftPositions: shift_positions,
      maxBoats,
    },
  );

  // Write back only the rows the edit actually moved. No transaction here:
  // every caller already runs inside one (see the BK-5 boundary tests), and
  // the SQL this replaced was likewise a bare sequence of UPDATEs.
  const writeRow = db.prepare(
    'UPDATE Scores SET position = ?, points = ?, status = ? WHERE score_id = ?',
  );
  updatedCells.forEach((cell, i) => {
    const row = raceRows[i];
    // The edited boat is always written, exactly as before: an edit that
    // resolves to the same place still records the scorer's decision. Other
    // boats are written only if the edit actually moved them.
    const unchanged =
      cell.position === row.position &&
      cell.points === row.points &&
      cell.status === row.status;
    if (i !== editedIndex && unchanged) return;
    writeRow.run(cell.position, cell.points, cell.status, row.score_id);
  });
}

// BK-7: after a single-score edit or delete, refresh the affected event's
// leaderboard so standings don't go stale. A Final race must also refresh the
// FinalLeaderboard (the event recompute alone leaves it out of date), mirroring
// undoLastScoredRaceForHeat.
export const recomputeLeaderboardsForRace = (race_id: number) => {
  const row = db
    .prepare(
      `SELECT h.event_id, h.heat_type
       FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE r.race_id = ?`,
    )
    .get(race_id) as { event_id: number; heat_type: string } | undefined;

  if (!row) {
    return;
  }

  recomputeEventLeaderboard(row.event_id);
  if (row.heat_type === 'Final') {
    recomputeFinalLeaderboard(row.event_id);
  }
};
