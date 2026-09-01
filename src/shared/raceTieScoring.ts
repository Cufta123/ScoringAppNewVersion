import { scoringPenaltyStatuses } from './scoringPenalty';

/**
 * RRS A7: when boats share a finishing place, they share the points for the
 * places they occupy, averaged.
 *
 * This was implemented twice — `applyRaceTieScoring` in the main process
 * (walking SQL rows) and `rerankRaceColumn` in the renderer's edit preview
 * (walking an array) — with identical logic in two shapes. Two hand-synced
 * copies of a scoring rule eventually disagree, and when they do the preview
 * shows the scorer something other than what gets saved, so the walk lives
 * here and both processes call it.
 *
 * Position-keeping penalties (ZFP/SCP/T1) hold a real finishing place, so they
 * consume a slot in the place walk, but their points are a percentage of the
 * DNF score rather than the place (RRS 44.3(c)/T1) and are set elsewhere. Only
 * finishers are re-scored here, which is why the result covers just those rows.
 */

export interface RaceTieRow {
  position: number;
  status: string;
}

export interface TiePlacement {
  /** Index into the rows array this placement applies to. */
  index: number;
  position: number;
  points: number;
}

export default function computeTiePlacements(
  rows: RaceTieRow[],
): TiePlacement[] {
  // Boats that hold a place in the finishing order: finishers, plus the
  // position-keeping penalties that occupy a slot without being re-scored.
  const participants = rows
    .map((row, index) => ({
      index,
      position: row.position,
      status: row.status,
    }))
    .filter(
      (row) =>
        row.status === 'FINISHED' || scoringPenaltyStatuses.has(row.status),
    )
    // Ties break on input order, which both callers supply in a stable
    // sequence (score_id in the main process, row order in the renderer).
    .sort((a, b) => a.position - b.position || a.index - b.index);

  const placements: TiePlacement[] = [];
  let cursorPlace = 1;
  let i = 0;

  while (i < participants.length) {
    const tieValue = participants[i].position;
    const group: typeof participants = [];
    while (i < participants.length && participants[i].position === tieValue) {
      group.push(participants[i]);
      i += 1;
    }

    const startPlace = cursorPlace;
    const endPlace = cursorPlace + group.length - 1;
    const tiePoints = (startPlace + endPlace) / 2;

    group.forEach((row) => {
      if (row.status === 'FINISHED') {
        placements.push({
          index: row.index,
          position: startPlace,
          points: tiePoints,
        });
      }
    });

    cursorPlace += group.length;
  }

  return placements;
}
