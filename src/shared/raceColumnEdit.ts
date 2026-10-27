import computeTiePlacements from './raceTieScoring';
import {
  getScoringPenaltyPoints,
  promotesBoatsBehind,
  scoringPenaltyStatuses,
} from './scoringPenalty';

/**
 * What happens to every boat in a race when the scorer changes one boat's
 * result: the mandatory RRS A6.1 promotion, the optional manual place ripple,
 * and the RRS A7 re-average that follows either of them.
 *
 * This was implemented twice — as SQL UPDATEs in the main process's
 * applyRaceResultUpdate, and as array arithmetic in useLeaderboard's
 * handleRaceChange so edit mode could preview the result before saving. The
 * two were kept aligned by hand and by comment ("mirror the backend"), which
 * is exactly what lets a preview drift from what actually gets saved.
 *
 * It is a pure function over the race's cells so both processes can use it:
 * the main process loads the race, applies this, and writes back what changed;
 * the renderer applies it to the cells it is already holding.
 */

export interface RaceCell {
  position: number;
  points: number;
  status: string;
}

export interface RaceColumnEdit {
  /** Index into the cells array of the boat being edited. */
  index: number;
  /** The edited boat's place and status before this change. */
  previousPosition: number;
  previousStatus: string;
  /** The edited boat's new place, points and status. */
  newPosition: number;
  newPoints: number;
  newStatus: string;
  /** The scorer's "shift other boats" toggle. */
  shiftPositions: boolean;
  /** Boats in the largest heat, for RRS 44.3(c) penalty points. */
  maxBoats: number;
}

/**
 * RRS A6.2 / A10: redress and discretionary penalties are set by the protest
 * committee and must not change any other boat's score, so an RDG or DPI edit
 * never displaces anyone.
 */
function keepsProvidedPoints(status: string): boolean {
  return status.startsWith('RDG') || status === 'DPI';
}

/** A boat that holds a real slot in the finishing order. */
function holdsPlace(status: string): boolean {
  return status === 'FINISHED' || scoringPenaltyStatuses.has(status);
}

/**
 * Move a cell to a new place. Position-keeping penalties (ZFP/SCP/T1) score a
 * percentage of the DNF score rather than their place, so their points are
 * recomputed instead of tracking the place.
 */
function moveTo(cell: RaceCell, position: number, maxBoats: number): RaceCell {
  return {
    ...cell,
    position,
    points: scoringPenaltyStatuses.has(cell.status)
      ? getScoringPenaltyPoints(position, maxBoats, cell.status)
      : position,
  };
}

export default function applyRaceColumnEdit(
  cells: RaceCell[],
  edit: RaceColumnEdit,
): RaceCell[] {
  const {
    index,
    previousPosition,
    previousStatus,
    newPosition,
    newPoints,
    newStatus,
    shiftPositions,
    maxBoats,
  } = edit;

  let next = cells.map((cell, i) =>
    i === index
      ? { position: newPosition, points: newPoints, status: newStatus }
      : { ...cell },
  );

  const pcSetPoints = keepsProvidedPoints(newStatus);

  // RULE-M16 / RRS A6.1: "each boat with a worse finishing place shall be
  // moved up one place" when a boat that finished is disqualified or retires
  // after finishing. Mandatory, so it is NOT gated on the shift toggle — that
  // toggle governs only the manual ripple below, which is a data-entry
  // convenience rather than a rule.
  const promotesBoats = promotesBoatsBehind(previousStatus, newStatus);

  if (promotesBoats) {
    next = next.map((cell, i) => {
      if (i === index || !holdsPlace(cell.status)) return cell;
      if (cell.position <= previousPosition) return cell;
      return moveTo(cell, cell.position - 1, maxBoats);
    });
  }

  // With "shift other boats" OFF a manual place change is an override: only
  // the edited boat moves, even if that leaves a tie or a gap. Only a move to
  // a finishing place ripples — every other status is scored at largest-heat
  // + 1 (SHRS 5.2) or is PC-set, so it vacates rather than occupies a slot.
  if (shiftPositions && !pcSetPoints && newStatus === 'FINISHED') {
    // LB-7: position-keeping penalties (ZFP/SCP/T1) occupy a real place, so
    // they ripple with the finishers; leaving them behind would let the A7
    // re-average read a stale place as a shared one.
    const shiftRange = (
      lowest: number,
      highest: number,
      delta: number,
    ): void => {
      next = next.map((cell, i) => {
        if (i === index || !holdsPlace(cell.status)) return cell;
        const inRange = cell.position >= lowest && cell.position <= highest;
        return inRange ? moveTo(cell, cell.position + delta, maxBoats) : cell;
      });
    };

    if (previousPosition > newPosition) {
      shiftRange(newPosition, previousPosition - 1, 1);
    } else if (previousPosition < newPosition) {
      shiftRange(previousPosition + 1, newPosition, -1);
    }
  }

  // RRS A7: re-average any places that are now shared. Needed after either
  // kind of change — the mandatory promotion or the manual ripple.
  if (promotesBoats || (shiftPositions && !pcSetPoints)) {
    computeTiePlacements(next).forEach((placement) => {
      next[placement.index] = {
        ...next[placement.index],
        position: placement.position,
        points: placement.points,
      };
    });
  }

  return next;
}
