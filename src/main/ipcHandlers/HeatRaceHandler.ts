/* eslint-disable camelcase */
import { ipcMain, dialog } from 'electron';
import fs from 'fs';
import { db } from '../../../public/Database/DBManager';

import {
  assignBoatsToInitialHeatsSerpentine,
  assignBoatsToNewHeatsZigZag,
  checkRaceCountForLatestHeats,
  compareByCountryThenSail,
  findLatestHeatsBySuffix,
  generateNextHeatNames,
  getNextHeatIndexByMovementTable,
} from '../functions/creatingNewHeatsUtls';
import {
  DiscardConfig,
  getEventDiscardConfig,
  getExcludeCountForConfig,
} from '../functions/discardConfig';
import {
  OverallTiePacket,
  buildOverallTiePacket,
  resolveOverallTieGroupSequentially,
} from '../functions/overallTieBreak';
import { computeAdjustedFleetTotals } from '../../shared/fleetAssignment';
import { fleetNameForIndex, fleetRank } from '../../shared/fleetNames';
import { orderFinalLeaderboardRows } from '../functions/finalLeaderboardOrder';
import explainTieBreak from '../functions/explainTieBreak';
import {
  buildEventSnapshot,
  restoreEventSnapshot,
} from '../functions/eventSnapshot';
import {
  clearAssignmentSnapshot,
  clearAssignmentSnapshotsForHeat,
  FrozenAssignmentRow,
  loadPersistedAssignmentSnapshot,
  persistAssignmentSnapshot,
  raceAssignmentSnapshots,
  unshieldBoatFromAssignmentSnapshot,
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
  compareSeededRows,
  getHeatBaseFromName,
  getScoringPenaltyPoints,
  isNonScoringPenalty,
  normalizeScoreStatus,
  normalizeStatus,
  promotesBoatsBehind,
  protestCommitteeStatuses,
  rdgStatuses,
  scoringPenaltyStatuses,
} from '../functions/scoreStatus';
import {
  detectDuplicateSailNumbers,
  normalizeSailNumber,
  sanitizePositiveFinite,
  sanitizePositiveInteger,
} from '../functions/validation';

console.log('HeatRaceHandler.ts loaded');

const getEventQualifyingAssignmentMode = (event_id: any): string => {
  const row = db
    .prepare(
      'SELECT shrs_qualifying_assignment_mode FROM Events WHERE event_id = ?',
    )
    .get(event_id) as { shrs_qualifying_assignment_mode?: string } | undefined;
  const value = row?.shrs_qualifying_assignment_mode;
  if (value === 'pre-assigned') {
    return 'pre-assigned';
  }
  return 'progressive';
};

const getEventHeatOverflowPolicy = (event_id: any): string => {
  const row = db
    .prepare('SELECT shrs_heat_overflow_policy FROM Events WHERE event_id = ?')
    .get(event_id) as { shrs_heat_overflow_policy?: string } | undefined;
  if (row?.shrs_heat_overflow_policy === 'confirm-allow-oversize') {
    return 'confirm-allow-oversize';
  }
  return 'auto-increase';
};

const SHRS_MAX_BOATS_PER_HEAT = 20;

const lockDiscardProfileForRace = (race_id: number) => {
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

  if (row.heat_type === 'Qualifying') {
    db.prepare(
      'UPDATE Events SET shrs_discard_locked_qualifying = 1 WHERE event_id = ?',
    ).run(row.event_id);
  }

  if (row.heat_type === 'Final') {
    db.prepare(
      'UPDATE Events SET shrs_discard_locked_final = 1 WHERE event_id = ?',
    ).run(row.event_id);
  }
};

// BK-7: after a single-score edit or delete, refresh the affected event's
// leaderboard so standings don't go stale. A Final race must also refresh the
// FinalLeaderboard (the event recompute alone leaves it out of date), mirroring
// undoLastScoredRaceForHeat.
const recomputeLeaderboardsForRace = (race_id: number) => {
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

function getLatestRaceRowsForHeats(
  latestHeats: { heat_name: string; heat_id: number }[],
) {
  const latestRaceByHeatQuery = db.prepare(
    `SELECT race_id, race_number
     FROM Races
     WHERE heat_id = ?
     ORDER BY race_number DESC, race_id DESC
     LIMIT 1`,
  );

  const raceRows = latestHeats.map((heat) => {
    const raceRow = latestRaceByHeatQuery.get(heat.heat_id);
    if (!raceRow) {
      throw new Error(`No races found for heat ${heat.heat_name}.`);
    }
    return { ...raceRow, heat_id: heat.heat_id, heat_name: heat.heat_name };
  });

  const raceNumbers = [...new Set(raceRows.map((row) => row.race_number))];
  if (raceNumbers.length > 1) {
    throw new Error(
      'Latest qualifying heats are not aligned on the same race number.',
    );
  }

  return raceRows;
}

function applyRaceResultUpdate(
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

/**
 * SHRS 5.2: Get the number of boats in the largest heat for an event.
 * Used for penalty scoring (DNS, DSQ, RET, etc. = largest heat size + 1).
 */
function getMaxHeatSize(event_id: any, heat_type?: string): number {
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

function seedRaceWithDefaultDnsScores(race_id: number, heat_id: number): void {
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

function ensureCompleteRaceScoresForEvent(
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

function applyRaceTieScoring(race_id: number): void {
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

  let cursorPlace = 1;
  let index = 0;

  while (index < rankedRows.length) {
    const tieValue = rankedRows[index].position;
    const tieGroup: { score_id: number; position: number; status: string }[] =
      [];

    while (
      index < rankedRows.length &&
      rankedRows[index].position === tieValue
    ) {
      tieGroup.push(rankedRows[index]);
      index += 1;
    }

    const groupSize = tieGroup.length;
    const startPlace = cursorPlace;
    const endPlace = cursorPlace + groupSize - 1;
    const tiePoints = (startPlace + endPlace) / 2;

    tieGroup.forEach((row) => {
      // Only finishers are (re)scored here. Penalty boats keep the place and
      // points assigned at submit time but still consume a place slot above.
      if (row.status === 'FINISHED') {
        updateScore.run(startPlace, tiePoints, row.score_id);
      }
    });

    cursorPlace += groupSize;
  }
}

function getSeedingResultsFromLastRace(
  event_id: any,
  latestHeats: { heat_name: string; heat_id: number }[],
) {
  checkRaceCountForLatestHeats(latestHeats, db);

  const raceCount = getRaceCountForHeat(latestHeats[0].heat_id);
  if (raceCount === 0) {
    throw new Error(
      'Cannot create next heats before the current qualifying round has race results.',
    );
  }

  const raceRows = getLatestRaceRowsForHeats(latestHeats);

  const rowsByRaceQuery = db.prepare(
    `SELECT
      hb.boat_id,
      sc.position,
      sc.status,
      b.country,
      b.sail_number
     FROM Heat_Boat hb
     JOIN Boats b ON b.boat_id = hb.boat_id
     LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id
     WHERE hb.heat_id = ?`,
  );

  const seedingRows = raceRows.flatMap((raceRow) =>
    rowsByRaceQuery
      .all(raceRow.race_id, raceRow.heat_id)
      .map(
        (row: {
          boat_id: string;
          position: number | null;
          status: string | null;
          country: string | null;
          sail_number: string | number | null;
        }) => ({
          boat_id: row.boat_id,
          position: row.position,
          status: normalizeStatus(row.status),
          country: row.country,
          sail_number: row.sail_number,
        }),
      ),
  );

  seedingRows.sort(compareSeededRows);

  return seedingRows.map((row) => ({ boat_id: row.boat_id }));
}

function getOddEvenMovementAdvisory(
  numberOfHeats: number,
  totalBoats: number,
): string | null {
  // SHRS 2026 Heat Movement Tables end-note: "with entries of 10, 14, 18, 22,
  // 26, 30, 34 and 38 every second race will result in Heat 1 having 2 more
  // boats than Heat 2" — i.e. every N where N mod 4 = 2, starting at 10.
  // RULE-m1: the floor used to be 14, which silently skipped the 10-boat case
  // the rule names explicitly.
  if (numberOfHeats === 2 && totalBoats >= 10 && totalBoats % 4 === 2) {
    return (
      `SHRS advisory: with odd/even movement tables and ${totalBoats} boats in 2 heats, ` +
      'a temporary 2-boat imbalance between heats can occur and is expected.'
    );
  }
  return null;
}

function getRankedBoatsInHeatForRace(heat_id: number, race_id: number) {
  const rowsByRaceQuery = db.prepare(
    `SELECT
      hb.boat_id,
      sc.position,
      sc.status,
      b.country,
      b.sail_number
     FROM Heat_Boat hb
     JOIN Boats b ON b.boat_id = hb.boat_id
     LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id
     WHERE hb.heat_id = ?`,
  );

  const rows: {
    boat_id: string;
    position: number | null;
    status: string;
    country: string | null;
    sail_number: string | number | null;
  }[] = rowsByRaceQuery
    .all(race_id, heat_id)
    .map(
      (row: {
        boat_id: string;
        position: number | null;
        status: string | null;
        country: string | null;
        sail_number: string | number | null;
      }) => ({
        boat_id: row.boat_id,
        position: row.position,
        status:
          normalizeStatus(row.status) || (row.position == null ? 'DNS' : ''),
        country: row.country,
        sail_number: row.sail_number,
      }),
    );

  rows.sort(compareSeededRows);

  return rows;
}

function captureRaceAssignmentSnapshotIfMissing(
  heat_id: number,
  race_id: number,
  boat_id: any,
) {
  const existing =
    raceAssignmentSnapshots.get(race_id) ??
    loadPersistedAssignmentSnapshot(race_id);

  if (existing && existing.size > 0) {
    raceAssignmentSnapshots.set(race_id, existing);

    // RULE-M21: the freeze is per BOAT, so "a snapshot exists for this race" is
    // not enough — this boat may have been un-shielded by an earlier ordinary
    // correction. Freeze its current (pre-decision) place now, otherwise the
    // protest decision below would reorder its next-round assignment, which is
    // exactly what SHRS 3.1.5 forbids.
    const key = String(boat_id);
    if (!existing.has(key)) {
      const liveRow = getRankedBoatsInHeatForRace(heat_id, race_id).find(
        (row) => String(row.boat_id) === key,
      );
      if (liveRow) {
        existing.set(key, {
          position: liveRow.position,
          status: liveRow.status,
        });
        persistAssignmentSnapshot(race_id, existing);
      }
    }
    return;
  }

  const rankedRows = getRankedBoatsInHeatForRace(heat_id, race_id);
  const frozen = new Map<string, FrozenAssignmentRow>();
  rankedRows.forEach((row) => {
    frozen.set(String(row.boat_id), {
      position: row.position,
      status: row.status,
    });
  });
  raceAssignmentSnapshots.set(race_id, frozen);
  persistAssignmentSnapshot(race_id, frozen);
}

function getAssignmentRowsForHeatRace(heat_id: number, race_id: number) {
  const frozen =
    raceAssignmentSnapshots.get(race_id) ??
    loadPersistedAssignmentSnapshot(race_id);
  const liveRanked = getRankedBoatsInHeatForRace(heat_id, race_id);

  // No protest shield: the assignment is just the live order.
  if (!frozen || frozen.size === 0) {
    return liveRanked.map((row) => ({ boat_id: row.boat_id }));
  }

  // RULE-M21: shield per boat. A boat with a frozen row keeps its pre-protest
  // finishing place/status; a boat without one (corrected after the freeze, or
  // added later) uses its live result. compareSeededRows orders the mix (frozen
  // finishers vs live finishers, then penalties, ties by national letter+sail).
  const effectiveRows = liveRanked.map((row) => {
    const frozenRow = frozen.get(String(row.boat_id));
    if (!frozenRow) {
      return { ...row, isFrozen: false };
    }
    return {
      ...row,
      position: frozenRow.position,
      status: frozenRow.status,
      isFrozen: true,
    };
  });

  effectiveRows.sort((left, right) => {
    // Mixing frozen and live places can put two boats on the SAME position: a
    // boat DSQ'd from 1st keeps frozen position 1, while the RRS A6.1 promotion
    // moves the boat behind her to live position 1, and un-shielding that boat
    // makes both claim the slot. compareSeededRows would settle it on national
    // letter + sail number, i.e. arbitrarily. The shielded boat holds the slot:
    // SHRS 3.1.5 says the protest decision must not move her.
    if (
      left.position === right.position &&
      left.status === right.status &&
      left.isFrozen !== right.isFrozen
    ) {
      return left.isFrozen ? -1 : 1;
    }
    return compareSeededRows(left, right);
  });
  return effectiveRows.map((row) => ({ boat_id: row.boat_id }));
}

function buildAdjustedFleetLeaderboard(
  leaderboard: Array<{
    boat_id: number;
    race_points: string | null;
    race_statuses: string | null;
  }>,
  qualifyingDiscardConfig: DiscardConfig,
  applyShs43TemporarySecondDiscard = true,
): Array<{ boat_id: number; totalPoints: number }> {
  return computeAdjustedFleetTotals(leaderboard, {
    applyShs43TemporarySecondDiscard,
    getExcludeCount: (n: number) =>
      getExcludeCountForConfig(n, qualifyingDiscardConfig),
  });
}

ipcMain.handle('readAllHeats', async (event, event_id) => {
  try {
    const heats = db
      .prepare('SELECT * FROM Heats WHERE event_id = ?')
      .all(event_id);
    return heats;
  } catch (error) {
    console.error('Error reading all heats:', error);
    throw error;
  }
});

ipcMain.handle('exportEventSnapshotToFile', async (_event, event_id) => {
  try {
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
  } catch (error) {
    console.error('Error exporting event snapshot:', error);
    throw error;
  }
});

ipcMain.handle('restoreEventSnapshotFromFile', async (_event, event_id) => {
  try {
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
  } catch (error) {
    console.error('Error restoring event snapshot:', error);
    throw error;
  }
});

ipcMain.handle('insertHeat', async (event, event_id, heat_name, heat_type) => {
  try {
    const result = db
      .prepare(
        'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
      )
      .run(event_id, heat_name, heat_type);
    return { lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    console.error('Error inserting heat:', error);
    throw error;
  }
});

ipcMain.handle('insertHeatBoat', async (event, heat_id, boat_id) => {
  try {
    const heatRow = db
      .prepare(
        `SELECT h.event_id
         FROM Heats h
         WHERE h.heat_id = ?`,
      )
      .get(heat_id) as { event_id: number } | undefined;

    if (!heatRow) {
      throw new Error('Heat not found.');
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
      .prepare(
        'INSERT OR IGNORE INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
      )
      .run(heat_id, boat_id);
    return { lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    console.error('Error inserting heat boat:', error);
    throw error;
  }
});

// First-round heat creation, atomically: validates up front (boats exist, the
// SHRS 20-boat cap holds), seeds boats by SHRS 3 order and assigns them with
// the SHRS 3.1 serpentine — all in one transaction so a failure can never
// leave half-created heats behind (the old renderer-side per-row IPC loop
// could die at the 21st boat of a heat with no rollback).
ipcMain.handle(
  'createInitialHeatsAtomic',
  async (_event, event_id, num_heats) => {
    try {
      const numHeats = Number(num_heats);
      if (!Number.isInteger(numHeats) || numHeats < 1 || numHeats > 26) {
        throw new Error('Number of heats must be between 1 and 26.');
      }

      const existingHeats = db
        .prepare('SELECT COUNT(*) AS count FROM Heats WHERE event_id = ?')
        .get(event_id) as { count: number };
      if (existingHeats.count > 0) {
        throw new Error('Heats already exist for this event.');
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

      // BK-4: two boats sharing a sail number (or an empty sail number) collide
      // when keying a boat-by-sail map, which would silently drop one boat from
      // the heat assignment. Fail loudly instead of assigning the wrong boats.
      const duplicateSailNumbers = detectDuplicateSailNumbers(boats);
      if (duplicateSailNumbers.length > 0) {
        const details = duplicateSailNumbers
          .map(({ sail, boatIds }) =>
            sail === ''
              ? `empty sail number (boats ${boatIds.join(', ')})`
              : `sail number "${sail}" (boats ${boatIds.join(', ')})`,
          )
          .join('; ');
        throw new Error(
          `Cannot create heats: duplicate sail numbers — ${details}.`,
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

      const insertHeatStmt = db.prepare(
        'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
      );
      const insertHeatBoatStmt = db.prepare(
        'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
      );

      const createHeats = db.transaction(() => {
        const heatIds: number[] = [];
        for (let i = 0; i < numHeats; i += 1) {
          const heatName = `Heat ${String.fromCharCode(65 + i)}1`;
          const inserted = insertHeatStmt.run(event_id, heatName, 'Qualifying');
          heatIds.push(Number(inserted.lastInsertRowid));
        }
        boats.forEach((boat, i) => {
          insertHeatBoatStmt.run(heatIds[heatIndices[i]], boat.boat_id);
        });
        return { createdHeats: numHeats, assignedBoats: boats.length };
      });

      const result = createHeats();
      return { success: true, ...result };
    } catch (error) {
      console.error('Error creating initial heats:', (error as Error).message);
      throw error;
    }
  },
);
ipcMain.handle('deleteHeatsByEvent', async (event, event_id) => {
  try {
    // Server-side guard: the renderer blocks "Recreate Heats" once a race has
    // happened, but that state can be stale — never rely on it for a delete
    // this destructive.
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

    // One transaction so a failure can never leave a half-deleted event
    // (e.g. assignments gone but heats still present).
    const wipeHeats = db.transaction(() => {
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
    });

    const result = wipeHeats();
    console.log(
      `Deleted ${result.heatsChanges} heat(s) and ${result.heatBoatsChanges} assignment(s) for event ID ${event_id}.`,
    );
    return result;
  } catch (error) {
    console.error('Error deleting heats by event:', error);
    throw error;
  }
});
ipcMain.handle('readBoatsByHeat', async (event, heat_id) => {
  try {
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
  } catch (error) {
    console.error('Error reading boats by heat:', error);
    throw error;
  }
});
ipcMain.handle('readAllRaces', async (event, heat_id) => {
  try {
    const races = db
      .prepare('SELECT * FROM Races WHERE heat_id = ?')
      .all(heat_id);
    return races;
  } catch (error) {
    console.error('Error reading all races:', error);
    throw error;
  }
});

ipcMain.handle('insertRace', async (event, heat_id, race_number) => {
  try {
    const heatRow = db
      .prepare('SELECT event_id FROM Heats WHERE heat_id = ?')
      .get(heat_id) as { event_id?: number } | undefined;

    if (heatRow?.event_id == null) {
      throw new Error('Heat not found.');
    }

    // BK-5: the race INSERT and the default DNS seed must commit together — a
    // failure between them would leave an orphan race with zero scores.
    const insertRaceTx = db.transaction(() => {
      const result = db
        .prepare('INSERT INTO Races (heat_id, race_number) VALUES (?, ?)')
        .run(heat_id, race_number);
      seedRaceWithDefaultDnsScores(Number(result.lastInsertRowid), heat_id);
      return { lastInsertRowid: result.lastInsertRowid };
    });
    return insertRaceTx();
  } catch (error) {
    console.error('Error inserting race:', error);
    throw error;
  }
});

ipcMain.handle('readAllScores', async (event, race_id) => {
  try {
    const scores = db
      .prepare('SELECT * FROM Scores WHERE race_id = ?')
      .all(race_id);
    return scores;
  } catch (error) {
    console.error('Error reading all scores:', error);
    throw error;
  }
});

ipcMain.handle(
  'insertScore',
  async (event, race_id, boat_id, position, points, status) => {
    try {
      const raceRow = db
        .prepare(
          `SELECT h.event_id
           FROM Races r
           JOIN Heats h ON h.heat_id = r.heat_id
           WHERE r.race_id = ?`,
        )
        .get(race_id) as { event_id?: number } | undefined;

      if (raceRow?.event_id == null) {
        throw new Error('Race not found.');
      }

      const normalizedStatus = normalizeScoreStatus(status);

      // BK-6: guard position/points against NaN/0/negative before binding so a
      // bad payload surfaces a clear error instead of an opaque
      // SQLITE_CONSTRAINT (better-sqlite3 stores NaN as NULL, violating NOT NULL).
      // RDG*/DPI positions are protest-committee-set and may be fractional or
      // < 1 (CMP C-23/C-24), so they only need to be finite and positive; every
      // other status writes a finishing place (a positive whole number).
      const keepsProvidedPoints =
        rdgStatuses.includes(normalizedStatus) || normalizedStatus === 'DPI';
      const safePosition = keepsProvidedPoints
        ? sanitizePositiveFinite(position, 'Position')
        : sanitizePositiveInteger(position, 'Position');
      const safePoints = sanitizePositiveFinite(points, 'Points');

      // BK-5: the UPDATE-or-INSERT, A7 tie re-scoring and discard-profile lock
      // must commit together — an unwrapped UPDATE-then-INSERT lets two
      // concurrent calls both see `changes === 0` and double-INSERT.
      const insertScoreTx = db.transaction(() => {
        const updated = db
          .prepare(
            'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
          )
          .run(safePosition, safePoints, normalizedStatus, race_id, boat_id);

        let result = updated;
        if (updated.changes === 0) {
          result = db
            .prepare(
              'INSERT INTO Scores (race_id, boat_id, position, points, status) VALUES (?, ?, ?, ?, ?)',
            )
            .run(race_id, boat_id, safePosition, safePoints, normalizedStatus);
        }

        if (normalizedStatus === 'FINISHED') {
          applyRaceTieScoring(race_id);
        }
        lockDiscardProfileForRace(Number(race_id));
        return { lastInsertRowid: result.lastInsertRowid };
      });

      return insertScoreTx();
    } catch (error) {
      console.error('Error inserting score:', error);
      throw error;
    }
  },
);

ipcMain.handle('getMaxHeatSize', async (event, event_id, heat_type) => {
  try {
    return getMaxHeatSize(event_id, heat_type || undefined);
  } catch (error) {
    console.error('Error getting max heat size:', error);
    throw error;
  }
});

// Explain the SHRS 5.7 tie-break between two boats for the compare panel.
// The winner is taken from the same comparator the ranking uses, so the panel
// can never disagree with the actual placement. Series flag selects the
// qualifying comparator vs the combined overall (final-series) comparator.
ipcMain.handle(
  'explainTieBreak',
  async (_event, event_id, boatAId, boatBId, isFinalSeries) => {
    try {
      return explainTieBreak(
        event_id,
        String(boatAId),
        String(boatBId),
        Boolean(isFinalSeries),
      );
    } catch (error) {
      console.error('Error explaining tie-break:', error);
      throw error;
    }
  },
);

// SHRS validation of whether the Final Series can start. The renderer renders
// prompts/messages from the returned reason; all the rule logic stays here.
ipcMain.handle('getFinalSeriesEligibility', async (_event, event_id) => {
  try {
    return getFinalSeriesEligibility(event_id);
  } catch (error) {
    console.error('Error checking final series eligibility:', error);
    throw error;
  }
});

// Atomically score a whole race: create the next race for the heat, apply the
// SHRS 5.2 / RRS 44.3(c)/T1 penalty math, persist every boat's score in a
// single transaction, then recompute the relevant leaderboard. Previously this
// lived in the renderer as N sequential IPC calls, so a mid-loop failure could
// leave a half-scored race. Keeping it here makes scoring all-or-nothing and
// keeps the domain logic in the main process.
ipcMain.handle('submitHeatRaceScoresAtomic', async (_event, payload) => {
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

  try {
    const heatRow = db
      .prepare('SELECT event_id, heat_type FROM Heats WHERE heat_id = ?')
      .get(heat_id) as { event_id: number; heat_type: string } | undefined;
    if (!heatRow) {
      throw new Error('Heat not found.');
    }
    // HRH M4: derive the event from the heat itself; ignore the payload value.
    const { event_id } = heatRow;
    if (payloadEventId != null && Number(payloadEventId) !== event_id) {
      console.warn(
        `HRH M4: submitHeatRaceScoresAtomic payload event_id ${payloadEventId} does not match heat ${heat_id}'s event ${event_id}; using the heat's event.`,
      );
    }
    const isFinalHeat = heatRow.heat_type === 'Final';

    const boats = db
      .prepare(
        `SELECT b.boat_id, b.sail_number
         FROM Heat_Boat hb
         JOIN Boats b ON hb.boat_id = b.boat_id
         WHERE hb.heat_id = ?`,
      )
      .all(heat_id) as Array<{ boat_id: number; sail_number: string | number }>;

    const normalizeSail = normalizeSailNumber;

    // BK-4: two boats sharing a sail number (or an empty sail number) collide in
    // boatsBySail and silently drop one boat's score. Detect it up front and fail
    // loudly instead of scoring the wrong boat.
    const duplicateSailNumbers = detectDuplicateSailNumbers(boats);
    if (duplicateSailNumbers.length > 0) {
      const details = duplicateSailNumbers
        .map(({ sail, boatIds }) =>
          sail === ''
            ? `empty sail number (boats ${boatIds.join(', ')})`
            : `sail number "${sail}" (boats ${boatIds.join(', ')})`,
        )
        .join('; ');
      throw new Error(
        `Cannot score heat ${heat_id}: duplicate sail numbers — ${details}.`,
      );
    }

    const boatsBySail = new Map(
      boats.map((boat) => [normalizeSail(boat.sail_number), boat]),
    );

    const unmatched = placeNumbers
      .map((entry) => entry.boatNumber)
      .filter((boatNumber) => !boatsBySail.has(normalizeSail(boatNumber)));

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
        const boat = boatsBySail.get(normalizeSail(boatNumber))!;
        const normalizedStatus = normalizeScoreStatus(status);

        let position: number;
        let points: number;
        if (normalizedStatus === 'FINISHED') {
          // BK-6: a FINISHED place must be a positive integer; a 0 / NaN place
          // would otherwise be written straight to Scores.position/points.
          const finishingPlace = sanitizePositiveInteger(
            place,
            `Place for sail ${String(boatNumber)}`,
          );
          position = finishingPlace;
          points = finishingPlace;
          hasFinisher = true;
        } else if (scoringPenaltyStatuses.has(normalizedStatus)) {
          // ZFP/SCP/T1: keep finishing place, add the scoring-penalty places.
          const finishingPlace = sanitizePositiveInteger(
            place,
            `Place for sail ${String(boatNumber)}`,
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
        let allHeatsEqual = false;
        try {
          const latestHeats = getLatestQualifyingHeats(event_id);
          const raceCounts = latestHeats.map((heat: { heat_id: number }) =>
            getRaceCountForHeat(heat.heat_id),
          );
          allHeatsEqual = raceCounts.every((count) => count === raceCounts[0]);
        } catch (countError) {
          allHeatsEqual = false;
          console.error(
            `BK-2: could not verify equal heat race counts for event ${event_id}; skipping qualifying leaderboard recompute (standings may be stale until the next scored race). Cause:`,
            (countError as Error).message,
          );
        }
        if (allHeatsEqual) {
          recomputeEventLeaderboard(event_id);
        }
      }
    });

    writeScores();

    return { ok: true as const, raceNumber: nextRaceNumber, raceId };
  } catch (error) {
    console.error('Error submitting heat race scores:', error);
    throw error;
  }
});

ipcMain.handle(
  'updateScore',
  async (event, score_id, position, points, status) => {
    try {
      const normalizedStatus = normalizeScoreStatus(status);
      // BK-6: guard position/points against NaN/0/negative before binding so a
      // bad payload surfaces a clear error instead of an opaque
      // SQLITE_CONSTRAINT. RDG*/DPI positions are protest-committee-set and may
      // be fractional or < 1, so they only need to be finite and positive;
      // every other status writes a finishing place (a positive whole number).
      const keepsProvidedPoints =
        rdgStatuses.includes(normalizedStatus) || normalizedStatus === 'DPI';
      const safePosition = keepsProvidedPoints
        ? sanitizePositiveFinite(position, 'Position')
        : sanitizePositiveInteger(position, 'Position');
      const safePoints = sanitizePositiveFinite(points, 'Points');
      const row = db
        .prepare('SELECT race_id FROM Scores WHERE score_id = ?')
        .get(score_id) as { race_id?: number } | undefined;
      const raceId = row?.race_id != null ? Number(row.race_id) : null;
      // BK-7: wrap the write, tie re-scoring and recompute in one transaction so
      // an edit that changes a finisher can't leave stale A7 tie points on the
      // other finishers or a stale leaderboard behind. (recomputeEventLeaderboard
      // has its own inner transaction; better-sqlite3 nests it as a savepoint.)
      const applyUpdate = db.transaction(() => {
        const runResult = db
          .prepare(
            'UPDATE Scores SET position = ?, points = ?, status = ? WHERE score_id = ?',
          )
          .run(safePosition, safePoints, normalizedStatus, score_id);
        if (raceId != null) {
          lockDiscardProfileForRace(raceId);
          // Re-run RRS A7 tie scoring for the race so the remaining finishers
          // get correct shared/averaged points after this edit.
          applyRaceTieScoring(raceId);
          // Recompute the leaderboards inside the same transaction so a
          // recompute failure rolls back the edit instead of leaving it
          // persisted with a stale leaderboard (BK-7).
          recomputeLeaderboardsForRace(raceId);
        }
        return runResult;
      });
      const result = applyUpdate();
      return { changes: result.changes };
    } catch (error) {
      console.error('Error updating score:', error);
      throw error;
    }
  },
);
ipcMain.handle('updateEventLeaderboard', async (event, event_id) => {
  try {
    recomputeEventLeaderboard(event_id);
    // BK-9: return the same {success:true} contract as updateFinalLeaderboard
    // so renderer callers that inspect the result get a consistent shape
    // instead of `undefined`.
    return { success: true };
  } catch (error) {
    console.error(
      'Error updating event leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});

// Deprecated: the global-leaderboard feature is on hold. The channel is kept
// so existing callers don't break, but it intentionally writes nothing — the
// old implementation aggregated Leaderboard rows across ALL events and applied
// no discards, producing wrong totals. Revisit if the feature returns.
ipcMain.handle('updateGlobalLeaderboard', async () => {
  return { success: true, deprecated: true };
});

ipcMain.handle('deleteScore', async (event, score_id) => {
  try {
    // BK-7: capture the race BEFORE deleting so we can re-run tie scoring and
    // recompute the leaderboard afterwards. Deleting a finisher's row otherwise
    // leaves the remaining tied boats on stale averaged points and the stored
    // leaderboard out of date.
    const row = db
      .prepare('SELECT race_id FROM Scores WHERE score_id = ?')
      .get(score_id) as { race_id?: number } | undefined;
    const raceId = row?.race_id != null ? Number(row.race_id) : null;
    const applyDelete = db.transaction(() => {
      const runResult = db
        .prepare('DELETE FROM Scores WHERE score_id = ?')
        .run(score_id);
      if (raceId != null && runResult.changes > 0) {
        applyRaceTieScoring(raceId);
        // Recompute inside the same transaction, exactly as updateScore does:
        // a recompute failure must roll the delete back rather than leave the
        // score gone, the other finishers' A7 tie points rewritten and the
        // stored leaderboard stale — which is what the caller sees when the
        // IPC call rejects after the delete has already committed (BK-7).
        recomputeLeaderboardsForRace(raceId);
      }
      return runResult;
    });
    const result = applyDelete();
    return { changes: result.changes };
  } catch (error) {
    console.error('Error deleting score:', error);
    throw error;
  }
});

ipcMain.handle(
  'startFinalSeriesAtomic',
  async (
    _event,
    event_id,
    allow_oversize_confirm = false,
    apply_shrs43_temporary_second_discard = true,
  ) => {
    try {
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
          'Final series has already been started for this event.',
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
          'With fewer than 2 qualifying groups, final series cannot be started.',
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
          'Cannot start final series because latest qualifying heats have different race counts.',
        );
      }

      // Repair any missing score rows as DNS first so boats without scores
      // are ranked last instead of being dropped by the leaderboard join.
      ensureCompleteRaceScoresForEvent(event_id, 'Qualifying');

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
        WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying'
          AND sc.race_id IS NOT NULL
        GROUP BY lb.boat_id
        ORDER BY lb.place ASC`,
        )
        .all(event_id, event_id) as Array<{
        boat_id: number;
        race_points: string | null;
        race_statuses: string | null;
      }>;

      if (leaderboard.length === 0) {
        throw new Error(
          'Cannot start final series without qualifying leaderboard data.',
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
      if (
        adjustedLeaderboard.length >
        finalHeatCount * SHRS_MAX_BOATS_PER_HEAT
      ) {
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
    } catch (error) {
      console.error('Error starting final series atomically:', error);
      throw error;
    }
  },
);

ipcMain.handle('createNewHeatsBasedOnLeaderboard', async (event, event_id) => {
  try {
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
    console.log(raceNumber);
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
    if (assignments.length === 0) {
      const leaderboardResults = getSeedingResultsFromLastRace(
        event_id,
        sortedLatestHeats,
      );
      const fallbackAssignments = assignBoatsToNewHeatsZigZag(
        leaderboardResults,
        nextHeatNames,
        raceNumber,
      );
      fallbackAssignments.forEach((assignment) => assignments.push(assignment));
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

    if (advisory) {
      console.warn(advisory);
      return { success: true, advisory };
    }

    console.log('New heats created based on leaderboard.');
    return { success: true };
  } catch (error) {
    console.error(
      'Error creating new heats based on leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle('undoLastScoredRaceForHeat', async (event, heat_id) => {
  try {
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
      throw new Error('Heat not found.');
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

    const deleteScores = db.prepare('DELETE FROM Scores WHERE race_id = ?');
    const deleteRace = db.prepare('DELETE FROM Races  WHERE race_id = ?');

    const transaction = db.transaction(() => {
      const removedScores = deleteScores.run(lastRace.race_id).changes;
      deleteRace.run(lastRace.race_id);
      return removedScores;
    });

    const removedScores = transaction();
    clearAssignmentSnapshot(lastRace.race_id);
    recomputeEventLeaderboard(heatRow.event_id);
    // Undoing a FINAL race must refresh the final standings too — the event
    // leaderboard alone leaves FinalLeaderboard reflecting the deleted race.
    if (heatRow.heat_type === 'Final') {
      recomputeFinalLeaderboard(heatRow.event_id);
    }

    return {
      success: true,
      heatName: heatRow.heat_name,
      raceNumber: lastRace.race_number,
      removedScores,
    };
  } catch (error) {
    console.error(
      'Error undoing last scored race for heat:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle('undoLastScoredRace', async (event, event_id) => {
  try {
    const latestHeats = getLatestQualifyingHeats(event_id);
    checkRaceCountForLatestHeats(latestHeats, db);

    const latestRaceByHeatQuery = db.prepare(
      `SELECT race_id, race_number
       FROM Races
       WHERE heat_id = ?
       ORDER BY race_number DESC, race_id DESC
       LIMIT 1`,
    );

    const raceRows = latestHeats.map((heat) => {
      const row = latestRaceByHeatQuery.get(heat.heat_id);
      if (!row) {
        throw new Error('No scored race found to undo.');
      }
      return row;
    });

    const raceNumbers = [...new Set(raceRows.map((row) => row.race_number))];
    if (raceNumbers.length > 1) {
      throw new Error(
        'Latest qualifying heats are not aligned on the same race number.',
      );
    }

    const raceIds = raceRows.map((row) => row.race_id);
    const deleteScoresByRace = db.prepare(
      'DELETE FROM Scores WHERE race_id = ?',
    );
    const deleteRaceById = db.prepare('DELETE FROM Races WHERE race_id = ?');

    const transaction = db.transaction(() => {
      let removedScores = 0;
      let removedRaces = 0;

      raceIds.forEach((raceId) => {
        removedScores += deleteScoresByRace.run(raceId).changes;
        removedRaces += deleteRaceById.run(raceId).changes;
      });

      return { removedScores, removedRaces };
    });

    const result = transaction();
    raceIds.forEach((raceId) => clearAssignmentSnapshot(raceId));
    recomputeEventLeaderboard(event_id);

    return {
      success: true,
      raceNumber: raceNumbers[0],
      removedScores: result.removedScores,
      removedRaces: result.removedRaces,
    };
  } catch (error) {
    console.error('Error undoing last scored race:', (error as Error).message);
    throw error;
  }
});

ipcMain.handle('undoLatestHeatRedistribution', async (event, event_id) => {
  try {
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
  } catch (error) {
    console.error(
      'Error undoing latest heat redistribution:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle(
  'transferBoatBetweenHeats',
  async (event, from_heat_id, to_heat_id, boat_id) => {
    try {
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
        throw new Error('Heat not found.');
      }
      if (fromHeat.event_id !== toHeat.event_id) {
        throw new Error('Cannot transfer a boat between different events.');
      }

      // SHRS 4.1: "Boats shall compete in the same Fleet throughout the Final
      // Series." The UI blocks this, but a direct IPC call must not move a boat
      // into, out of, or between final fleets (RULE-M25).
      if (fromHeat.heat_type === 'Final' || toHeat.heat_type === 'Final') {
        throw new Error(
          'Cannot transfer a boat to or from a Final Series fleet.',
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
        const insertInfo = insertQuery.run(to_heat_id, boat_id);
        return {
          removed: deleteInfo.changes,
          inserted: insertInfo.changes,
        };
      });

      const { removed, inserted } = transfer();
      console.log(
        `Transferred boat ${boat_id}: removed ${removed} row(s) from heat ${from_heat_id}, inserted ${inserted} row(s) into heat ${to_heat_id}.`,
      );

      // RULE-M13: both heats' membership just changed, so any SHRS 3.1.5
      // assignment snapshot naming this boat in her old heat is stale. Left in
      // place it would seed the next round from the pre-transfer order and put
      // the boat into two next-round heats at once.
      clearAssignmentSnapshotsForHeat(Number(from_heat_id));
      clearAssignmentSnapshotsForHeat(Number(to_heat_id));

      return { success: true };
    } catch (error) {
      console.error('Error transferring boat between heats:', error);
      throw error;
    }
  },
);

ipcMain.handle(
  'updateRaceResult',
  async (
    event,
    event_id,
    race_id,
    boat_id,
    new_position,
    shift_positions,
    new_status,
  ) => {
    try {
      // BK-5: the sequential position/points UPDATEs, discard-profile lock and
      // leaderboard recompute must share one transaction so a mid-write failure
      // rolls back instead of leaving a half-updated race and a stale
      // leaderboard. (recomputeEventLeaderboard has its own inner transaction;
      // better-sqlite3 nests it as a savepoint.)
      const raceId = Number(race_id);
      // `applyRaceResultUpdate` writes the module-level cache Map directly,
      // which a DB rollback does not undo. It both ADDS entries (capture) and
      // REMOVES boats from an existing entry (unshield), so remembering whether
      // the race id was present is not enough — the entry's CONTENTS must be
      // restored, otherwise a failed save leaves a boat permanently un-shielded
      // in memory while the DB still holds its frozen row (RULE-M21).
      const snapshotBefore = raceAssignmentSnapshots.get(raceId);
      const snapshotBackup = snapshotBefore ? new Map(snapshotBefore) : null;

      const applyUpdate = db.transaction(() => {
        applyRaceResultUpdate(
          event_id,
          race_id,
          boat_id,
          new_position,
          Boolean(shift_positions),
          new_status,
        );
        lockDiscardProfileForRace(raceId);
        recomputeEventLeaderboard(event_id);
      });

      try {
        applyUpdate();
      } catch (err) {
        if (snapshotBackup) {
          raceAssignmentSnapshots.set(raceId, snapshotBackup);
        } else {
          raceAssignmentSnapshots.delete(raceId);
        }
        throw err;
      }

      return { success: true };
    } catch (err) {
      console.error('Error updating race result:', (err as Error).message);
      throw err;
    }
  },
);

ipcMain.handle(
  'saveLeaderboardRaceResultsAtomic',
  async (
    _event,
    event_id,
    operations,
    shift_positions,
    updateFinalLeaderboard = false,
  ) => {
    try {
      const safeOperations = Array.isArray(operations) ? operations : [];
      // Rollback guard for the in-memory assignment-snapshot cache (see
      // updateRaceResult): the cache Map survives a DB rollback, so back up each
      // touched race's frozen rows and restore them wholesale on failure. A
      // presence-only guard is not enough because an unshield mutates an
      // existing entry rather than adding one (RULE-M21).
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
          // Each operation carries the shift-toggle state from when the user
          // made that edit, so the write replays exactly what the renderer
          // previewed. The call-level flag remains as fallback for callers
          // that don't send per-operation state.
          const shiftForOperation =
            operation.shiftPositions != null
              ? Boolean(operation.shiftPositions)
              : Boolean(shift_positions);
          applyRaceResultUpdate(
            event_id,
            operation.raceId,
            operation.boatId,
            operation.newPosition,
            shiftForOperation,
            operation.entryStatus,
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
    } catch (error) {
      console.error(
        'Error saving leaderboard race results atomically:',
        (error as Error).message,
      );
      throw error;
    }
  },
);

ipcMain.handle('readLeaderboard', async (event, event_id) => {
  try {
    const repairedRows = ensureCompleteRaceScoresForEvent(
      event_id,
      'Qualifying',
    );
    if (repairedRows > 0) {
      recomputeEventLeaderboard(event_id);
    }

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
      "WHERE lb.event_id = ? AND h.event_id = ? AND h.heat_type = 'Qualifying' " +
      'AND sc.race_id IS NOT NULL ' +
      'GROUP BY lb.boat_id ' +
      'ORDER BY lb.place ASC';
    const readQuery = db.prepare(query);
    const results = readQuery.all(event_id, event_id);
    console.log(
      `[IPC -> Renderer] readLeaderboard (event_id=${event_id}): ${
        results.length
      } entries`,
    );
    return results;
  } catch (error) {
    console.error('Error reading leaderboard:', error);
    throw error;
  }
});
ipcMain.handle('readGlobalLeaderboard', async () => {
  try {
    const results = db
      .prepare(
        `
        SELECT
          gl.boat_id,
          gl.total_points_global,
          b.sail_number AS boat_number,
          b.model AS boat_type,
          s.name,
          s.surname,
          b.country
        FROM GlobalLeaderboard gl
        LEFT JOIN Boats b ON gl.boat_id = b.boat_id
        LEFT JOIN Sailors s ON b.sailor_id = s.sailor_id
        ORDER BY gl.total_points_global ASC
      `,
      )
      .all();
    return results;
  } catch (error) {
    console.error('Error reading global leaderboard:', error);
    throw error;
  }
});

ipcMain.handle('updateFinalLeaderboard', async (event, event_id) => {
  try {
    recomputeFinalLeaderboard(event_id);
    console.log('Final leaderboard updated successfully.');
    return { success: true };
  } catch (error) {
    console.error(
      'Error updating final leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});

ipcMain.handle('readFinalLeaderboard', async (event, event_id) => {
  try {
    const repairedRows = ensureCompleteRaceScoresForEvent(event_id, 'Final');
    if (repairedRows > 0) {
      recomputeFinalLeaderboard(event_id);
    }

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
    const entrySuffix = results.length === 1 ? 'y' : 'ies';
    console.log(
      `[IPC -> Renderer] readFinalLeaderboard (event_id=${event_id}): sending ${
        results.length
      } entr${entrySuffix} to frontend`,
      results,
    );
    return results;
  } catch (error) {
    console.error('Error reading final leaderboard:', error);
    throw error;
  }
});

/**
 * SHRS 5.4: A boat's overall series score = qualifying series score + final series score.
 * Gold fleet boats rank before Silver, Silver before Bronze, etc.
 * SHRS 1.5: If no races are completed in the Final Series, boats are ranked
 * according to their series score in the Qualifying Series.
 */
ipcMain.handle('readOverallLeaderboard', async (event, event_id) => {
  try {
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

    const results = overallQuery.all(event_id);

    const tiePacketCache = new Map<any, OverallTiePacket>();
    const getTiePacket = (boatId: any) => {
      if (!tiePacketCache.has(boatId)) {
        tiePacketCache.set(boatId, buildOverallTiePacket(event_id, boatId));
      }
      return tiePacketCache.get(boatId) as OverallTiePacket;
    };

    results.sort((left: any, right: any) => {
      // SHRS 5.5: Gold before Silver before Bronze "and so on" — including the
      // 5th and later fleets, which used to share one catch-all rank (RULE-m2).
      const leftFleetRank = fleetRank(left.placement_group);
      const rightFleetRank = fleetRank(right.placement_group);
      if (leftFleetRank !== rightFleetRank) {
        return leftFleetRank - rightFleetRank;
      }

      if (left.overall_points !== right.overall_points) {
        return left.overall_points - right.overall_points;
      }

      return 0;
    });

    const groupedAndResolved: any[] = [];
    for (let i = 0; i < results.length; ) {
      const fleet = results[i].placement_group;
      const points = results[i].overall_points;
      const tieGroup: any[] = [];

      while (
        i < results.length &&
        results[i].placement_group === fleet &&
        results[i].overall_points === points
      ) {
        tieGroup.push(results[i]);
        i += 1;
      }

      if (tieGroup.length <= 1) {
        groupedAndResolved.push(...tieGroup);
      } else {
        groupedAndResolved.push(
          ...resolveOverallTieGroupSequentially(tieGroup, getTiePacket),
        );
      }
    }

    results.splice(0, results.length, ...groupedAndResolved);

    // Assign overall rank: Gold before Silver before Bronze before Copper
    let rank = 1;
    results.forEach((row: any) => {
      row.overall_rank = rank;
      rank += 1;
    });

    console.log(
      `[IPC -> Renderer] readOverallLeaderboard (event_id=${event_id}): ${
        results.length
      } entries`,
    );
    return results;
  } catch (error) {
    console.error(
      'Error reading overall leaderboard:',
      (error as Error).message,
    );
    throw error;
  }
});
