/**
 * SHRS 3.1.5: a protest-committee decision must not change heat assignments,
 * so the pre-decision finishing order is frozen per boat and replayed when the
 * next round is seeded. An ordinary race-office correction is NOT shielded.
 */
import { compareSeededRows } from './scoreStatus';
import { getRankedBoatsInHeatForRace } from './raceSeeding';
import {
  FrozenAssignmentRow,
  loadPersistedAssignmentSnapshot,
  persistAssignmentSnapshot,
  raceAssignmentSnapshots,
} from './raceAssignmentSnapshot';

export function captureRaceAssignmentSnapshotIfMissing(
  heat_id: number,
  race_id: number,
  boat_id: number | string,
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

export function getAssignmentRowsForHeatRace(heat_id: number, race_id: number) {
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
