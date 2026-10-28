/**
 * Writes to the Scores table: seeding a new race, repairing missing rows,
 * saving a whole corrected race (RRS A6.1/A6.2/A7, SHRS 5.2), and re-averaging
 * shared places. Everything that changes a boat's score for one race lives
 * here so the rules are applied in one place.
 */
import { db } from '../../../public/Database/DBManager';
import computeTiePlacements from '../../shared/raceTieScoring';
import {
  holdsPlace,
  keepsProvidedPoints,
  scoreRaceColumn,
  type RaceCell,
} from '../../shared/raceColumnEdit';
import { captureRaceAssignmentSnapshotIfMissing } from './assignmentShield';
import { unshieldBoatFromAssignmentSnapshot } from './raceAssignmentSnapshot';
import {
  getHeatRoundFromName,
  normalizeScoreStatus,
  protestCommitteeStatuses,
  scoringPenaltyStatuses,
} from './scoreStatus';
import { sanitizePositiveFinite, sanitizePositiveInteger } from './validation';
import { boatLabel, raceLabel } from './labels';

/**
 * SHRS 5.2: Get the number of boats in the largest heat for an event.
 * Used for penalty scoring (DNS, DSQ, RET, etc. = largest heat size + 1).
 */
export function getMaxHeatSize(event_id: number, heat_type?: string): number {
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

/**
 * RRS A5.1 (as changed by SHRS 5.2) and SHRS 5.3: a boat entered in the series
 * is scored for EVERY race in it. A boat that sailed in no heat for a round did
 * not come to the starting area, so she is scored DNC at (largest heat + 1) —
 * she is not simply left without a row.
 *
 * Without this a boat added mid-event (`assignBoatToHeat`) carries fewer scores
 * than the series has races, and the two readers of that vector disagree about
 * her. `calculateBoatScores` caps her discard count (`capExcludeCountForBoat`)
 * so she keeps one score and is ranked far too high; `computeAdjustedFleetTotals`
 * does not cap, discards her only score under SHRS 5.4, and ranks her FIRST —
 * straight into Gold Fleet (SHRS 4.2). Neither figure is 5.4: the rule scores a
 * boat on "her race scores in that series", and a boat that missed a race has a
 * DNC score for it. Backfilling those makes the cap unreachable rather than
 * load-bearing.
 *
 * What counts as one race of the series. Each qualifying round is a fresh set
 * of heats ("Heat A3", "Heat B3", …) and `Races.race_number` counts races
 * WITHIN a heat, so in a multi-heat event every qualifying race is stored with
 * race_number 1. A race of the series is therefore identified by the heat's
 * round (its name suffix) AND the race_number inside it:
 *   - multi-heat:  A1/B1 race 1, A2/B2 race 1, … -> rounds (1,1), (2,1), …
 *   - single heat: A1 race 1, A1 race 2, …       -> rounds (1,1), (1,2), …
 * Keying on race_number alone (as this used to) collapsed every round of a
 * multi-heat event into one, so a boat who missed three rounds got one DNC.
 *
 * A round is only backfilled once EVERY heat of that round has sailed it.
 * Mid-round (Heat A3 scored, Heat B3 not yet) the B3 boats simply have not
 * raced; scoring them DNC would be wrong and would leave them with two scores
 * for the round once B3 is entered.
 *
 * A boat who sailed in no heat of a round has no heat whose race is naturally
 * hers; the row is anchored to the round's first race purely because Scores
 * needs a race_id. Nothing reads it that way: heat assignment ranks boats from
 * Heat_Boat rather than Scores (`getRankedBoatsInHeatForRace`), the RRS A7 place
 * walk skips every non-finisher (`raceTieScoring`), and the leaderboard orders
 * a boat's scores by race. Points are re-derived against the current largest
 * heat on every recompute (`renormalizeNonFinisherScores`), so the anchor
 * cannot freeze a stale value either.
 *
 * Qualifying only. In the Final Series a boat races in exactly one fleet
 * (SHRS 4.1) and fleets may sail different numbers of races (4.5), so a Gold
 * boat must not collect DNCs for Silver's races; boats in a final fleet are
 * already covered by the DNS repair above, which walks Heat_Boat.
 */
export function ensureDncScoresForMissedQualifyingRaces(
  event_id: number,
): number {
  const heats = db
    .prepare(
      `SELECT heat_id, heat_name FROM Heats
       WHERE event_id = ? AND heat_type = 'Qualifying'`,
    )
    .all(event_id) as { heat_id: number; heat_name: string }[];

  if (heats.length === 0) {
    return 0;
  }

  const roundOfHeat = new Map<number, number>();
  heats.forEach((heat) => {
    const round = getHeatRoundFromName(heat.heat_name);
    if (round === null) return;
    roundOfHeat.set(Number(heat.heat_id), round);
  });

  const races = db
    .prepare(
      `SELECT r.race_id, r.race_number, r.heat_id
       FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id
       WHERE h.event_id = ? AND h.heat_type = 'Qualifying'
       ORDER BY r.race_id ASC`,
    )
    .all(event_id) as {
    race_id: number;
    race_number: number;
    heat_id: number;
  }[];

  // Series race key -> its races; race_id -> series race key.
  const seriesRaces = new Map<
    string,
    { anchorRaceId: number; round: number; heatIds: Set<number> }
  >();
  const keyOfRace = new Map<number, string>();
  races.forEach((race) => {
    const round = roundOfHeat.get(Number(race.heat_id));
    if (round === undefined) return;
    const key = `${round}:${race.race_number}`;
    keyOfRace.set(Number(race.race_id), key);
    const entry = seriesRaces.get(key);
    if (entry) {
      entry.heatIds.add(Number(race.heat_id));
    } else {
      seriesRaces.set(key, {
        anchorRaceId: Number(race.race_id),
        round,
        heatIds: new Set([Number(race.heat_id)]),
      });
    }
  });

  // A series race is completed once every heat of its round has sailed it.
  // CountedRaces (public/Database/views.js) is the one definition of that, so
  // the DNC backfill and the standings agree on which races exist.
  const counted = new Set(
    (
      db
        .prepare(
          `SELECT race_id FROM CountedRaces
           WHERE event_id = ? AND heat_type = 'Qualifying'`,
        )
        .all(event_id) as { race_id: number }[]
    ).map((row) => Number(row.race_id)),
  );
  const completedKeys = [...seriesRaces.entries()]
    .filter(([, entry]) => counted.has(entry.anchorRaceId))
    .map(([key]) => key);
  if (completedKeys.length === 0) {
    return 0;
  }

  const scoredKeysByBoat = new Map<string, Set<string>>();
  (
    db
      .prepare(
        `SELECT s.boat_id, s.race_id
         FROM Scores s
         JOIN Races r ON r.race_id = s.race_id
         JOIN Heats h ON h.heat_id = r.heat_id
         WHERE h.event_id = ? AND h.heat_type = 'Qualifying'`,
      )
      .all(event_id) as { boat_id: number; race_id: number }[]
  ).forEach((row) => {
    const key = keyOfRace.get(Number(row.race_id));
    if (!key) return;
    const boatKey = String(row.boat_id);
    if (!scoredKeysByBoat.has(boatKey))
      scoredKeysByBoat.set(boatKey, new Set());
    scoredKeysByBoat.get(boatKey)!.add(key);
  });

  const enteredBoats = db
    .prepare('SELECT DISTINCT boat_id FROM Boat_Event WHERE event_id = ?')
    .all(event_id) as { boat_id: number }[];

  const missingRounds: { boat_id: number; race_id: number }[] = [];
  enteredBoats.forEach(({ boat_id }) => {
    const scored = scoredKeysByBoat.get(String(boat_id));
    completedKeys.forEach((key) => {
      if (scored?.has(key)) return;
      missingRounds.push({
        boat_id,
        race_id: seriesRaces.get(key)!.anchorRaceId,
      });
    });
  });

  if (missingRounds.length === 0) {
    return 0;
  }

  const penaltyPosition = getMaxHeatSize(event_id, 'Qualifying') + 1;
  const insertDnc = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, 'DNC')`,
  );

  const transaction = db.transaction(() => {
    missingRounds.forEach((row) => {
      insertDnc.run(row.race_id, row.boat_id, penaltyPosition, penaltyPosition);
    });
  });

  transaction();
  console.warn(
    `[Data integrity] Scored ${missingRounds.length} missed qualifying race(s) as DNC for event ${event_id} (RRS A5.1 / SHRS 5.3).`,
  );
  return missingRounds.length;
}

export function ensureCompleteRaceScoresForEvent(
  event_id: number,
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

  // The DNS repair covers boats the heat already knows about; the DNC pass
  // covers entered boats the heat never listed. Both must run, so neither can
  // return early on the other's behalf, and DNS runs first so a boat who WAS in
  // the heat is recorded as having failed to start rather than never appearing.
  const dncScored =
    heatType === 'Qualifying'
      ? () => ensureDncScoresForMissedQualifyingRaces(event_id)
      : () => 0;

  if (missingRows.length === 0) {
    return dncScored();
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
  return missingRows.length + dncScored();
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

/** Protest-committee points (RDG3, DPI) above this are a typing mistake. */
const MAX_PROVIDED_POINTS = 99;

/** One boat's result in a race, as the leaderboard edit screen shows it. */
export interface RaceColumnCell {
  boatId: number;
  /** Finishing place, or the points for RDG3/DPI (ignored for other codes). */
  position: number;
  status: string;
  /** RDG2 only: the races averaged. */
  rdgRaceIds?: unknown;
  /**
   * The user typed in this cell on the edit screen, as opposed to the boat only
   * moving because another cell was edited (RRS A6.1 promotion, a place
   * ripple). Only edited cells are protest decisions or race-office
   * corrections for SHRS 3.1.5. Absent from older clients: see
   * `decideAssignmentShields`.
   */
  edited?: boolean;
}

/**
 * SHRS 3.1(v) / 3.1.5: who the saved race freezes and who it un-shields. Pure:
 * it reads the race as stored and as scored, changes nothing, and depends on no
 * row order.
 *
 * - `decisions`: edited cells that changed to a protest-committee status. The
 *   pre-decision order is frozen for them AND for every boat that moved in this
 *   save (`moved`), because a DSQ promotes the boats behind her (RRS A6.1) and
 *   the decision must not reorder their next-round assignment.
 * - `corrections`: edited cells that changed to anything else. A race-office
 *   correction un-shields that boat only; boats that merely moved keep their
 *   freeze (the old per-boat save did the same).
 *
 * A cell without an `edited` flag (an older client) counts as edited when its
 * status changed. That never misses a protest code, never un-shields a boat
 * only because she was promoted, and leaves every shield alone when only places
 * changed, which the old data cannot tell apart from a ripple. The renderer
 * always sends the flag.
 */
function decideAssignmentShields(
  before: { boat_id: number; position: number; status: string }[],
  scored: { position: number; status: string }[],
  sentByIndex: Map<number, RaceColumnCell>,
) {
  const decisions: number[] = [];
  const corrections: number[] = [];
  const moved: number[] = [];
  before.forEach((row, i) => {
    const statusChanged = scored[i].status !== normalizeScoreStatus(row.status);
    if (!statusChanged && scored[i].position === row.position) return;
    moved.push(row.boat_id);
    const sent = sentByIndex.get(i);
    if (!sent) return;
    const edited =
      typeof sent.edited === 'boolean' ? sent.edited : statusChanged;
    if (!edited) return;
    (protestCommitteeStatuses.has(scored[i].status)
      ? decisions
      : corrections
    ).push(row.boat_id);
  });
  return { decisions, corrections, moved };
}

/**
 * Save a whole race exactly as the leaderboard edit screen shows it. The
 * screen built these places with shared/raceColumnEdit; here they are checked
 * and scored again from the rules (scoreRaceColumn), so the stored points
 * never depend on numbers the renderer computed.
 *
 * Replaces replaying each edit on its own, which applied the edits in a
 * different order from the screen when a cell was edited twice, and so could
 * save a different race from the one shown.
 */
export function applyRaceColumnState(
  event_id: number,
  race_id: number,
  sentCells: RaceColumnCell[],
) {
  const raceId = Number(race_id);
  const heatRow = db
    .prepare(
      `SELECT h.heat_id, h.heat_type FROM Heats h
       JOIN Races r ON r.heat_id = h.heat_id
       WHERE r.race_id = ? AND h.event_id = ?`,
    )
    .get(raceId, event_id) as
    | { heat_id: number; heat_type: string }
    | undefined;
  if (!heatRow) {
    throw new Error(
      'One of the edited races is no longer part of this event (it may have been undone in the meantime). Reload the leaderboard and make the change again.',
    );
  }
  const maxBoats = getMaxHeatSize(event_id, heatRow.heat_type);

  const raceRows = db
    .prepare(
      `SELECT score_id, boat_id, position, points,
              COALESCE(status, 'FINISHED') AS status
       FROM Scores WHERE race_id = ? ORDER BY score_id ASC`,
    )
    .all(raceId) as {
    score_id: number;
    boat_id: number;
    position: number;
    points: number;
    status: string;
  }[];
  const indexOfBoat = new Map(
    raceRows.map((row, i) => [String(row.boat_id), i]),
  );

  const cells: RaceCell[] = raceRows.map((row) => ({
    position: row.position,
    points: row.points,
    status: normalizeScoreStatus(row.status),
  }));
  const sentByIndex = new Map<number, RaceColumnCell>();
  sentCells.forEach((sent) => {
    const i = indexOfBoat.get(String(sent.boatId));
    if (i == null) {
      throw new Error(
        `${boatLabel(sent.boatId)} did not sail ${raceLabel(raceId)}, so it has no result there to change. Reload the leaderboard.`,
      );
    }
    if (sentByIndex.has(i)) {
      throw new Error(
        `${boatLabel(sent.boatId)} appears twice in ${raceLabel(raceId)}. Reload the leaderboard and make the change again.`,
      );
    }
    sentByIndex.set(i, sent);
    const status = normalizeScoreStatus(sent.status);
    const context = `${boatLabel(sent.boatId)} in ${raceLabel(raceId)}`;
    if (holdsPlace(status)) {
      const place = sanitizePositiveInteger(
        sent.position,
        `The place of ${context}`,
      );
      if (place > raceRows.length) {
        throw new Error(
          `${context}: place ${place} is not possible, only ${raceRows.length} boats sailed this race.`,
        );
      }
      cells[i] = { position: place, points: place, status };
    } else if (keepsProvidedPoints(status)) {
      const points = sanitizePositiveFinite(
        sent.position,
        `The points of ${context}`,
      );
      if (points > MAX_PROVIDED_POINTS) {
        throw new Error(
          `${context}: ${points} points is more than the ${MAX_PROVIDED_POINTS} allowed.`,
        );
      }
      cells[i] = { position: points, points, status };
    } else {
      cells[i] = { ...cells[i], status };
    }
  });

  const scored = scoreRaceColumn(cells, maxBoats);

  // SHRS 3.1(v): a protest decision must not change heat assignments, so the
  // order before it is frozen; a race-office correction un-freezes the boat.
  // Decided from the cells the user edited, all captures before any un-shield,
  // and before the write, so the outcome does not depend on row order and the
  // freeze records the order as it was before this save.
  const { decisions, corrections, moved } = decideAssignmentShields(
    raceRows,
    scored,
    sentByIndex,
  );
  if (decisions.length > 0) {
    new Set([...decisions, ...moved]).forEach((boatId) =>
      captureRaceAssignmentSnapshotIfMissing(heatRow.heat_id, raceId, boatId),
    );
  }
  corrections.forEach((boatId) =>
    unshieldBoatFromAssignmentSnapshot(raceId, boatId),
  );

  const writeRow = db.prepare(
    'UPDATE Scores SET position = ?, points = ?, status = ? WHERE score_id = ?',
  );
  scored.forEach((cell, i) => {
    const row = raceRows[i];
    if (
      cell.position === row.position &&
      cell.points === row.points &&
      cell.status === row.status
    ) {
      return;
    }
    writeRow.run(cell.position, cell.points, cell.status, row.score_id);
  });

  sentByIndex.forEach((sent, i) => {
    const row = raceRows[i];
    const { status } = scored[i];
    if (status === 'RDG2' && Array.isArray(sent.rdgRaceIds)) {
      const ids = sent.rdgRaceIds
        .map(Number)
        .filter((id) => Number.isFinite(id));
      db.prepare('UPDATE Scores SET rdg_race_ids = ? WHERE score_id = ?').run(
        ids.length > 0 ? JSON.stringify(ids) : null,
        row.score_id,
      );
    } else if (status !== 'RDG2' && row.status === 'RDG2') {
      db.prepare(
        'UPDATE Scores SET rdg_race_ids = NULL WHERE score_id = ?',
      ).run(row.score_id);
    }
  });
}

/**
 * Score a stored race again from its places and codes (RRS A7 shared places,
 * 44.3(c), SHRS 5.2), writing only what changes. For writes that put rows
 * back one by one — an undo from the history restores each row as it was,
 * and two boats can then share a place that was not shared before.
 */
export function rescoreRace(race_id: number) {
  const heat = db
    .prepare(
      `SELECT h.event_id, h.heat_type FROM Races r JOIN Heats h ON h.heat_id = r.heat_id
       WHERE r.race_id = ?`,
    )
    .get(race_id) as { event_id: number; heat_type: string } | undefined;
  if (!heat) return;
  const rows = db
    .prepare(
      `SELECT score_id, position, points, COALESCE(status, 'FINISHED') AS status
       FROM Scores WHERE race_id = ? ORDER BY score_id ASC`,
    )
    .all(race_id) as {
    score_id: number;
    position: number;
    points: number;
    status: string;
  }[];
  const scored = scoreRaceColumn(
    rows.map((row) => ({
      position: row.position,
      points: row.points,
      status: normalizeScoreStatus(row.status),
    })),
    getMaxHeatSize(heat.event_id, heat.heat_type),
  );
  const write = db.prepare(
    'UPDATE Scores SET position = ?, points = ? WHERE score_id = ?',
  );
  scored.forEach((cell, i) => {
    if (cell.position !== rows[i].position || cell.points !== rows[i].points) {
      write.run(cell.position, cell.points, rows[i].score_id);
    }
  });
}
