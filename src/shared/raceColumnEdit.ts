import {
  getScoringPenaltyPoints,
  scoringPenaltyStatuses,
} from './scoringPenalty';

/**
 * What a correction to one boat's result does to her whole race. The main
 * process (saving) and the leaderboard edit screen (preview) both run this,
 * so the screen always shows what Save writes.
 *
 * A correction gives the race the result it would have had if the corrected
 * finish had been entered on the scoring screen in the first place:
 *
 *  - A new place MOVES the boat in the finishing order: the boats between her
 *    old and new place move up or down one to make room (as dragging her in
 *    the finish list does). Two moves swap two boats.
 *  - A code with no finishing place (DNF, OCS, BFD, DSQ, RET, …) on a boat
 *    that held one takes her out of the finishing order and every boat behind
 *    her moves up one place (RRS A6.1; a boat that did not start or finish
 *    never had the place either).
 *  - A finishing place for a boat that had none (a DNF found to have
 *    finished) puts her into the order and the boats from that place on move
 *    down one.
 *  - Redress (RDG) and a discretionary penalty (DPI) change her score only:
 *    no other boat's score changes (RRS A6.2, A10).
 *  - ZFP/SCP/T1 keep the finishing place (RRS 44.3(c), T1).
 *
 * Places are never silently compacted: a gap left by redress stays a gap.
 * Boats sharing a place share the points of the places they occupy (RRS A7).
 *
 * Earlier this was a "Shift other boats" toggle: off, a new place overrode
 * one boat and left a duplicate or a gap, and a code such as BFD left the
 * boats behind her a place too low. Each edit was then replayed on Save in a
 * different order from the screen, so what was saved could differ from what
 * was shown.
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
  /** The edited boat's new place (a finishing place, or RDG/DPI points). */
  newPosition: number;
  newPoints: number;
  newStatus: string;
  /** No longer used: a new place always moves the boat (see above). */
  shiftPositions?: boolean;
  /** Boats in the largest heat (SHRS 5.2): DNF score = maxBoats + 1. */
  maxBoats: number;
}

/** A boat holding a slot in the finishing order. */
export function holdsPlace(status: string): boolean {
  return status === 'FINISHED' || scoringPenaltyStatuses.has(status);
}

/** Redress and DPI: points set by the protest committee. */
export function keepsProvidedPoints(status: string): boolean {
  return status.startsWith('RDG') || status === 'DPI';
}

/**
 * Score every cell from its place and code: RRS A7 averages for boats sharing
 * a place, 44.3(c)/T1 points for position-keeping penalties, the DNF score
 * (largest heat + 1, SHRS 5.2) for every other code. RDG/DPI points are kept.
 */
export function scoreRaceColumn(
  cells: RaceCell[],
  maxBoats: number,
): RaceCell[] {
  const dnf = maxBoats + 1;
  const sharing = new Map<number, number>();
  cells.forEach((cell) => {
    if (holdsPlace(cell.status)) {
      sharing.set(cell.position, (sharing.get(cell.position) ?? 0) + 1);
    }
  });
  return cells.map((cell) => {
    if (keepsProvidedPoints(cell.status)) return { ...cell };
    if (!holdsPlace(cell.status)) {
      return { ...cell, position: dnf, points: dnf };
    }
    if (scoringPenaltyStatuses.has(cell.status)) {
      return {
        ...cell,
        points: getScoringPenaltyPoints(cell.position, maxBoats, cell.status),
      };
    }
    const n = sharing.get(cell.position) ?? 1;
    // Places p .. p+n-1, averaged.
    return { ...cell, points: cell.position + (n - 1) / 2 };
  });
}

export default function applyRaceColumnEdit(
  cells: RaceCell[],
  edit: RaceColumnEdit,
): RaceCell[] {
  const { index, previousPosition, previousStatus, newStatus, maxBoats } = edit;
  const hadPlace = holdsPlace(previousStatus);
  const takesPlace = holdsPlace(newStatus);

  let next = cells.map((cell) => ({ ...cell }));

  // Same place, another place-keeping code (FINISHED <-> ZFP/SCP/T1): only
  // her own score changes, and a dead heat she is part of stays.
  if (
    hadPlace &&
    takesPlace &&
    Math.round(edit.newPosition) === previousPosition
  ) {
    next[index] = {
      position: previousPosition,
      points: previousPosition,
      status: newStatus,
    };
    return scoreRaceColumn(next, maxBoats);
  }

  const others = (fn: (cell: RaceCell) => RaceCell) => {
    next = next.map((cell, i) =>
      i === index || !holdsPlace(cell.status) ? cell : fn(cell),
    );
  };

  // Out of the finishing order: the boats behind move up (RRS A6.1).
  // Redress and DPI leave everyone else as they were (RRS A6.2, A10).
  if (hadPlace && !(takesPlace || keepsProvidedPoints(newStatus))) {
    others((cell) =>
      cell.position > previousPosition
        ? { ...cell, position: cell.position - 1 }
        : cell,
    );
  }

  if (takesPlace) {
    // Moving: first leave the old place, as above.
    if (hadPlace) {
      others((cell) =>
        cell.position > previousPosition
          ? { ...cell, position: cell.position - 1 }
          : cell,
      );
    }
    // The place she can take: 1 .. one past the last boat.
    let lastEnd = 0;
    const sharing = new Map<number, number>();
    next.forEach((cell, i) => {
      if (i === index || !holdsPlace(cell.status)) return;
      sharing.set(cell.position, (sharing.get(cell.position) ?? 0) + 1);
    });
    sharing.forEach((n, position) => {
      lastEnd = Math.max(lastEnd, position + n - 1);
    });
    let place = Math.min(
      Math.max(1, Math.round(edit.newPosition)),
      lastEnd + 1,
    );
    // Typed into the middle of a dead heat: she goes in front of it.
    sharing.forEach((n, position) => {
      if (place > position && place <= position + n - 1) place = position;
    });
    others((cell) =>
      cell.position >= place ? { ...cell, position: cell.position + 1 } : cell,
    );
    next[index] = { position: place, points: place, status: newStatus };
  } else if (keepsProvidedPoints(newStatus)) {
    next[index] = {
      position: edit.newPosition,
      points: edit.newPoints,
      status: newStatus,
    };
  } else {
    next[index] = {
      position: maxBoats + 1,
      points: maxBoats + 1,
      status: newStatus,
    };
  }

  return scoreRaceColumn(next, maxBoats);
}
