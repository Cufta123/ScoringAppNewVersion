/**
 * Writes to the Scores table: seeding a new race, repairing missing rows,
 * applying a single result edit (RRS A6.1/A6.2/A7, SHRS 5.2), and re-averaging
 * shared places. Everything that changes a boat's score for one race lives
 * here so the rules are applied in one place.
 */
import { db } from '../../../public/Database/DBManager';
import computeTiePlacements from '../../shared/raceTieScoring';
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
  promotesBoatsBehind,
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

  db.prepare(
    'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
  ).run(finalPosition, points, status, race_id, boat_id);

  // RRS A6.2: giving redress by adjusting one boat's score must NOT change any
  // other boat's score. So an RDG edit never triggers displacement or a re-rank
  // — only the redressed boat's own row (set above) changes. DPI is treated the
  // same way: a discretionary points penalty does not vacate a finishing place,
  // so it never displaces other boats.
  //
  // RULE-M16 / RRS A6.1: "each boat with a worse finishing place SHALL be moved
  // up one place" when a boat that finished is disqualified or retires after
  // finishing. That is mandatory, not a scorer preference, so the promotion is
  // NOT gated on the "shift other boats" toggle — it used to be, which meant
  // the default (shift-off) path silently left every boat behind a DSQ one
  // place too low. The toggle governs only the manual place-move ripple below,
  // which is a data-entry convenience rather than a rule. The predicate lives
  // in scoreStatus.promotesBoatsBehind so the write path and the renderer
  // preview share one definition.
  const promotesBoats = promotesBoatsBehind(previousStatus, status);

  if (promotesBoats) {
    db.prepare(
      `UPDATE Scores SET position = position - 1, points = position - 1
         WHERE race_id = ? AND status = 'FINISHED' AND position > ?`,
    ).run(race_id, currentPosition);

    // RRS A6.1 applies to position-keeping penalty boats (ZFP/SCP/T1) too:
    // they hold a finishing place, so a boat placed worse than the removed
    // boat moves up one. Their points are a percentage of the DNF score, not
    // the place, so recompute each instead of the flat position=points shift
    // above. Doing this here also prevents a stale penalty position from
    // colliding with a shifted finisher and being mis-read as an RRS A7 tie
    // by applyRaceTieScoring.
    const penaltyStatusList = [...scoringPenaltyStatuses]
      .map((penaltyStatus) => `'${penaltyStatus}'`)
      .join(', ');
    const penaltyRowsBehind = db
      .prepare(
        `SELECT score_id, position, status FROM Scores
           WHERE race_id = ? AND status IN (${penaltyStatusList}) AND position > ?`,
      )
      .all(race_id, currentPosition) as {
      score_id: number;
      position: number;
      status: string;
    }[];
    const shiftPenaltyRow = db.prepare(
      'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
    );
    penaltyRowsBehind.forEach((row) => {
      const newPosition = row.position - 1;
      shiftPenaltyRow.run(
        newPosition,
        getScoringPenaltyPoints(newPosition, maxBoats, row.status),
        row.score_id,
      );
    });
  }

  // With "shift other boats" OFF a manual place change is an override: only the
  // edited boat moves, even if that leaves a tie or a gap. The renderer preview
  // behaves identically so Save never diverges from what the user saw.
  if (shift_positions && !keepsProvidedPoints) {
    if (status === 'FINISHED') {
      // LB-7: the manual ripple must move position-keeping penalty boats
      // (ZFP/SCP/T1) together with finishers, or the persisted leaderboard
      // diverges from the renderer preview (which does shift them). Their points
      // are a percentage of the DNF score (not the place), so recompute each
      // rather than the flat `position = points` shift used for FINISHED boats.
      const shiftPositionKeepingRows = (
        minPos: number,
        maxPos: number,
        delta: number,
      ) => {
        const penaltyStatusList = [...scoringPenaltyStatuses]
          .map((penaltyStatus) => `'${penaltyStatus}'`)
          .join(', ');
        const rows = db
          .prepare(
            `SELECT score_id, position, status FROM Scores
             WHERE race_id = ? AND status IN (${penaltyStatusList})
               AND position BETWEEN ? AND ? AND boat_id != ?`,
          )
          .all(race_id, minPos, maxPos, boat_id) as {
          score_id: number;
          position: number;
          status: string;
        }[];
        const shift = db.prepare(
          'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
        );
        rows.forEach((row) => {
          const newPosition = row.position + delta;
          shift.run(
            newPosition,
            getScoringPenaltyPoints(newPosition, maxBoats, row.status),
            row.score_id,
          );
        });
      };

      if (currentPosition > finalPosition) {
        db.prepare(
          `UPDATE Scores SET position = position + 1, points = position + 1
           WHERE race_id = ? AND status = 'FINISHED' AND position >= ? AND position < ? AND boat_id != ?`,
        ).run(race_id, finalPosition, currentPosition, boat_id);
        shiftPositionKeepingRows(finalPosition, currentPosition - 1, 1);
      } else if (currentPosition < finalPosition) {
        db.prepare(
          `UPDATE Scores SET position = position - 1, points = position - 1
           WHERE race_id = ? AND status = 'FINISHED' AND position <= ? AND position > ? AND boat_id != ?`,
        ).run(race_id, finalPosition, currentPosition, boat_id);
        shiftPositionKeepingRows(currentPosition + 1, finalPosition, -1);
      }
    }
  }

  // RRS A7: re-average any places that are now shared. Needed after either kind
  // of position change — the mandatory A6.1 promotion (which runs regardless of
  // the toggle) or the manual ripple above.
  if (promotesBoats || (shift_positions && !keepsProvidedPoints)) {
    applyRaceTieScoring(race_id);
  }
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
