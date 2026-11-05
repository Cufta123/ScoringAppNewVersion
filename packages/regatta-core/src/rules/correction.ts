/**
 * What a correction to one boat's result does to her whole race, on a race
 * written as a column of cells (a place and a code per boat, as a results
 * table shows it). For screens that let the race office correct a result in
 * place: the screen re-ranks the race with `applyRaceColumnEdit`, and what it
 * shows is the race the correction gives.
 *
 * A correction gives the race the result it would have had if the corrected
 * finish had been entered on the scoring sheet in the first place:
 *
 *  - A new place MOVES the boat in the finishing order: the boats between her
 *    old and new place move up or down one to make room. Two moves swap two
 *    boats.
 *  - A code with no finishing place (DNF, OCS, BFD, DSQ, RET, …) on a boat
 *    that held one takes her out of the finishing order and every boat behind
 *    her moves up one place (RRS A6.1; a boat that did not start or finish
 *    never had the place either).
 *  - A finishing place for a boat that had none (a DNF found to have
 *    finished) puts her into the order and the boats from that place on move
 *    down one.
 *  - Redress (RDG1-3) and a discretionary penalty (DPI) change her score only:
 *    no other boat's score changes (RRS A6.2, A10). A boat that finished
 *    keeps her place in the order (`heldPlace`), so a boat she was level
 *    with still shares it (6.5 stays 6.5) and the boats behind keep theirs.
 *  - ZFP / SCP / T1 keep the finishing place (RRS 44.3(c), T1).
 *
 * Places are never silently compacted: a gap left by redress stays a gap,
 * unless a place would fall outside the race. Boats sharing a place share the
 * points of the places they occupy (RRS A7).
 *
 * Cell statuses: 'FINISHED', a no-place code (`NO_PLACE_CODES`), a penalty
 * that keeps the place (`PENALTY_CODES`), or a score the protest committee
 * sets (`COMMITTEE_CODES`: DPI, RDG1, RDG2, RDG3). Any other status is
 * scored as a code with no place.
 */
import { PENALTY_CODES, type PenaltyCode } from '../types';
import { noPlacePoints, penaltyPoints } from './points';

/** A finish with no code. */
export const FINISHED = 'FINISHED';

const PENALTIES: ReadonlySet<string> = new Set(PENALTY_CODES);

/** One boat's result in a race, as a results table holds it. */
export interface RaceCell {
  /** Her finishing place; the points for RDG / DPI; the DNF score for a code. */
  position: number;
  points: number;
  status: string;
  /**
   * RDG / DPI only: the finishing place she keeps in the order (RRS A6.2).
   * Absent when she had none (redress for a boat that did not finish).
   */
  heldPlace?: number | null;
}

/** One boat's result changed (`index` into the race's cells). */
export interface RaceColumnEdit {
  /** Index into the cells of the boat being corrected. */
  index: number;
  /** Her place and status before this change. */
  previousPosition: number;
  previousStatus: string;
  /** Her new place (a finishing place, or the RDG / DPI points). */
  newPosition: number;
  newPoints: number;
  newStatus: string;
  /** Boats in the largest heat of the series (SHRS 5.2). */
  maxBoats: number;
}

/** A status that holds a slot in the finishing order (a finish, ZFP/SCP/T1). */
export function holdsPlace(status: string): boolean {
  return status === FINISHED || PENALTIES.has(status);
}

/** Redress and DPI: points the protest committee sets (RRS A9, A10). */
export function keepsProvidedPoints(status: string): boolean {
  return status.startsWith('RDG') || status === 'DPI';
}

/**
 * The place a cell fills in the finishing order: a finisher's (or ZFP / SCP /
 * T1) place, or the place a redressed / DPI boat kept. Null when none.
 */
export function slotOf(cell: RaceCell): number | null {
  if (holdsPlace(cell.status)) return cell.position;
  if (keepsProvidedPoints(cell.status) && cell.heldPlace != null) {
    return cell.heldPlace;
  }
  return null;
}

/** The cell with its place in the order moved to `slot`. */
function withSlot(cell: RaceCell, slot: number): RaceCell {
  return holdsPlace(cell.status)
    ? { ...cell, position: slot }
    : { ...cell, heldPlace: slot };
}

/** Only RDG / DPI carry a kept place; drop it from every other cell. */
function plain(cell: RaceCell): RaceCell {
  if (keepsProvidedPoints(cell.status) && cell.heldPlace != null) return cell;
  const { heldPlace: _dropped, ...rest } = cell;
  return rest;
}

/**
 * Score every cell from its place and code: RRS A7 shared points for boats
 * on one place, 44.3(c) / T1 points for ZFP / SCP / T1 (added to the shared
 * points in a tie), the DNF score (largest heat + 1, SHRS 5.2) for every
 * other code. RDG / DPI points are kept. A gap in the places is not closed.
 */
export function scoreRaceColumn(
  cells: readonly RaceCell[],
  maxBoats: number,
): RaceCell[] {
  const dnf = noPlacePoints(maxBoats);
  // Every boat filling a place counts, a redressed one that kept hers too.
  const sharing = new Map<number, number>();
  cells.forEach((cell) => {
    const slot = slotOf(cell);
    if (slot != null) sharing.set(slot, (sharing.get(slot) ?? 0) + 1);
  });
  return cells.map((raw) => {
    const cell = plain(raw);
    if (keepsProvidedPoints(cell.status)) return { ...cell };
    if (!holdsPlace(cell.status)) {
      return { ...cell, position: dnf, points: dnf };
    }
    const n = sharing.get(cell.position) ?? 1;
    // Places p .. p+n-1, averaged (RRS A7).
    const shared = cell.position + (n - 1) / 2;
    if (PENALTIES.has(cell.status)) {
      return {
        ...cell,
        points: penaltyPoints(shared, maxBoats, cell.status as PenaltyCode),
      };
    }
    return { ...cell, points: shared };
  });
}

/**
 * Keep every place inside the race. A gap left by redress is kept while it
 * fits, but if giving a boat back a place would push another past the last
 * boat (3 boats, places 1, 3 and 4), the places close up instead.
 */
function fitPlacesInRace(cells: RaceCell[]): RaceCell[] {
  const holders = cells
    .map((cell, index) => ({ cell, index, slot: slotOf(cell) }))
    .filter(
      (holder): holder is typeof holder & { slot: number } =>
        holder.slot != null,
    )
    .sort((a, b) => a.slot - b.slot || a.index - b.index);
  const sharing = new Map<number, number>();
  holders.forEach(({ slot }) => {
    sharing.set(slot, (sharing.get(slot) ?? 0) + 1);
  });
  let lastEnd = 0;
  sharing.forEach((n, position) => {
    lastEnd = Math.max(lastEnd, position + n - 1);
  });
  if (lastEnd <= cells.length) return cells;

  const next = cells.map((cell) => ({ ...cell }));
  let cursor = 1;
  let i = 0;
  while (i < holders.length) {
    const { slot } = holders[i];
    let j = i;
    while (j < holders.length && holders[j].slot === slot) {
      next[holders[j].index] = withSlot(next[holders[j].index], cursor);
      j += 1;
    }
    cursor += j - i;
    i = j;
  }
  return next;
}

/**
 * The race after one boat's result is corrected, every cell re-ranked and
 * scored (see the top of this file for what a correction does).
 */
export function applyRaceColumnEdit(
  cells: readonly RaceCell[],
  edit: RaceColumnEdit,
): RaceCell[] {
  const { index, previousStatus, newStatus, maxBoats } = edit;
  // Her place in the order before: a finisher's position, or the place a
  // redressed boat kept (her `position` then holds her points).
  const previousSlot = holdsPlace(previousStatus)
    ? edit.previousPosition
    : ((cells[index] && slotOf({ ...cells[index], status: previousStatus })) ??
      null);
  const previousPosition = previousSlot ?? edit.previousPosition;
  const hadPlace = previousSlot != null;
  const takesPlace = holdsPlace(newStatus);

  let next = cells.map((cell) => ({ ...cell }));

  // Same place, another place-keeping code (FINISHED <-> ZFP/SCP/T1): only
  // her own score changes, and a dead heat she is part of stays.
  if (
    hadPlace &&
    holdsPlace(previousStatus) &&
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

  // Every other boat filling a place moves with the order, a redressed
  // boat's kept place included.
  const others = (fn: (cell: RaceCell) => RaceCell) => {
    next = next.map((cell, i) => {
      const slot = slotOf(cell);
      if (i === index || slot == null) return cell;
      return withSlot(cell, fn({ ...cell, position: slot }).position);
    });
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
      const slot = slotOf(cell);
      if (i === index || slot == null) return;
      sharing.set(slot, (sharing.get(slot) ?? 0) + 1);
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
    // Make room at `place` by moving boats into the nearest free slot: down
    // when one is free below the last boat, else up into a slot a redressed
    // boat left free above her place.
    const occupied = new Set<number>();
    sharing.forEach((n, position) => {
      for (let p = position; p < position + n; p += 1) occupied.add(p);
    });
    let freeAfter = place;
    while (occupied.has(freeAfter)) freeAfter += 1;
    let freeBefore = place - 1;
    while (freeBefore >= 1 && occupied.has(freeBefore)) freeBefore -= 1;
    if (occupied.has(place) && freeAfter > cells.length && freeBefore >= 1) {
      others((cell) =>
        cell.position > freeBefore && cell.position <= place
          ? { ...cell, position: cell.position - 1 }
          : cell,
      );
    } else {
      others((cell) =>
        cell.position >= place && cell.position < freeAfter
          ? { ...cell, position: cell.position + 1 }
          : cell,
      );
    }
    next[index] = { position: place, points: place, status: newStatus };
  } else if (keepsProvidedPoints(newStatus)) {
    // RRS A6.2: she keeps her place in the order, if she had one.
    next[index] = {
      position: edit.newPosition,
      points: edit.newPoints,
      status: newStatus,
      ...(previousSlot != null ? { heldPlace: previousSlot } : {}),
    };
  } else {
    const dnf = noPlacePoints(maxBoats);
    next[index] = { position: dnf, points: dnf, status: newStatus };
  }

  return scoreRaceColumn(fitPlacesInRace(next), maxBoats);
}
