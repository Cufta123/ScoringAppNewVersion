/**
 * Finishing-place collisions introduced during an edit session, and the
 * "Switch places" resolution offered at save time.
 *
 * This was ~200 lines inside useLeaderboard. It needs only the queued edits and
 * whether the final series has started, both passed in explicitly, so it lives
 * here as plain functions the hook calls — and can be tested without mounting
 * a component.
 */
import { parseRaceNum } from './leaderboardUtils';
import { scoringPenaltyStatuses } from '../../shared/scoringPenalty';
import type { LeaderboardEntry } from '../types';

/**
 * A race-result change the user queued this session. `shift` records the
 * shift-other-boats toggle at the moment the edit was made, so the save
 * replays exactly what the preview showed even if the toggle moved later.
 */
export interface UserRaceEdit {
  boatId: number;
  raceIndex: number;
  rawPosition: number;
  status: string;
  shift: boolean;
  // SHRS 5.6: indices into the edited cell's OWN series race list.
  rdgSelection?: { seriesIndices: number[] };
}

// A finishing-place collision the user introduced this edit session: within
// one race two FINISHED boats now hold the same place. Each colliding place
// is one PlaceConflict; the boats carry their own column index so handleSave
// can swap places when the user asks for it.
export interface ConflictBoat {
  entry: LeaderboardEntry;
  raceIndex: number;
}
export interface PlaceConflict {
  label: string;
  raceId: string;
  place: number;
  boats: ConflictBoat[];
}

export const findPlaceConflicts = (
  rows: LeaderboardEntry[],
  edits: Map<string, UserRaceEdit>,
  finalSeriesStarted: boolean,
): PlaceConflict[] => {
  // Only inspect races the user actually touched this session, so a pre-
  // existing tie loaded from the DB never blocks an unrelated save.
  const editedRaceIds = new Set<string>();
  edits.forEach(({ boatId, raceIndex }) => {
    const entry = rows.find((e) => e.boat_id === boatId);
    const raceId = entry?.race_ids?.[raceIndex];
    if (raceId != null) editedRaceIds.add(String(raceId));
  });
  if (editedRaceIds.size === 0) return [];

  // Group every place-holding boat's place by the physical race it sailed.
  // Finishers AND position-keeping penalties (ZFP/SCP/T1) occupy a finishing
  // slot; hard-penalty and RDG cells don't, so they're skipped.
  interface Slot {
    label: string;
    place: number;
    entry: LeaderboardEntry;
    raceIndex: number;
  }
  const byRace = new Map<string, Slot[]>();
  rows.forEach((entry) => {
    entry.race_ids?.forEach((raceId, idx) => {
      const raceIdStr = String(raceId);
      if (!editedRaceIds.has(raceIdStr)) return;
      const status = entry.race_statuses?.[idx] || 'FINISHED';
      if (status !== 'FINISHED' && !scoringPenaltyStatuses.has(status)) {
        return;
      }
      const place = parseRaceNum(entry.races[idx]);
      if (!Number.isFinite(place) || place <= 0) return;
      // Match the table headers: F… for final races, Q… for qualifying.
      const label = finalSeriesStarted ? `F${idx + 1}` : `Q${idx + 1}`;
      const slots = byRace.get(raceIdStr) ?? [];
      slots.push({ label, place, entry, raceIndex: idx });
      byRace.set(raceIdStr, slots);
    });
  });

  const conflicts: PlaceConflict[] = [];
  byRace.forEach((slots, raceId) => {
    const byPlace = new Map<number, Slot[]>();
    slots.forEach((slot) => {
      const group = byPlace.get(slot.place) ?? [];
      group.push(slot);
      byPlace.set(slot.place, group);
    });
    byPlace.forEach((group, place) => {
      if (group.length >= 2) {
        conflicts.push({
          label: group[0].label,
          raceId,
          place,
          boats: group.map((g) => ({
            entry: g.entry,
            raceIndex: g.raceIndex,
          })),
        });
      }
    });
  });
  return conflicts;
};

export const describeBoat = (entry: LeaderboardEntry): string => {
  const name = `${entry.name ?? ''} ${entry.surname ?? ''}`.trim();
  const tag = [entry.country, entry.boat_number].filter(Boolean).join(' ');
  return tag ? `${name} (${tag})` : name;
};

// Build the Save-time warning body listing each colliding place, the boats
// sharing it, and the three resolutions the dialog offers.
export const buildConflictMessage = (conflicts: PlaceConflict[]): string => {
  const blocks = conflicts.map((conflict) => {
    const boats = conflict.boats
      .map((boat) => `   • ${describeBoat(boat.entry)}`)
      .join('\n');
    return `${conflict.label} — place ${conflict.place}:\n${boats}`;
  });
  const sample = conflicts[0];
  const split = (sample.place + (sample.place + 1)) / 2;
  return (
    'These boats now share the same finishing place — normally every ' +
    'place is unique:\n\n' +
    `${blocks.join('\n\n')}\n\n` +
    'Choose how to resolve it:\n' +
    '   • Switch places — the boat already on that place takes the place ' +
    'you moved the other boat from (every place stays unique).\n' +
    `   • Save anyway — keep the boats tied; per RRS A7 they split the ` +
    `points equally (e.g. places ${sample.place}+${sample.place + 1} → ` +
    `${split} each).\n` +
    '   • Cancel — go back and fix it yourself.'
  );
};

// For each conflict, work out the swap: the boats sharing the place are
// rotated so every place ends up unique. Returns extra raw edits (one per
// displaced boat) to merge into the save payload.
export const computeSwapEdits = (
  conflicts: PlaceConflict[],
  editableSource: LeaderboardEntry[],
  edits: Map<string, UserRaceEdit>,
): UserRaceEdit[] => {
  const swaps: UserRaceEdit[] = [];
  // LB-8: claimed places are tracked across the WHOLE conflicts loop, not per
  // conflict. Two conflicts in the same race each compute their own holes from
  // the same editable view, so without this both could send a displaced boat to
  // the same free place — reintroducing exactly the tie "Switch places" was
  // meant to remove.
  const claimedPlaces = new Set<number>();
  conflicts.forEach((conflict) => {
    const { raceIndex } = conflict.boats[0];

    // The boat(s) the user moved onto this place this session.
    const movedHere = conflict.boats.filter((boat) => {
      const edit = edits.get(`${boat.entry.boat_id}-${boat.raceIndex}`);
      return edit != null && edit.rawPosition === conflict.place;
    });
    if (movedHere.length === 0) return;

    // One boat keeps the place it was moved to; everyone else sharing it is
    // displaced into a vacated place. Handles N-boat conflicts (the old code
    // only looked at `movedHere[0]`, collapsing the rest onto one place).
    const primaryMover = movedHere[0];
    const displaced = conflict.boats.filter(
      (boat) => boat.entry.boat_id !== primaryMover.entry.boat_id,
    );
    if (displaced.length === 0) return;

    // LB-8: derive the vacated places from the EDITABLE leaderboard, not the
    // saved one. A place is vacated when no boat outside this conflict
    // occupies it. Reading the saved leaderboard was wrong: a later edit can
    // move another boat into the mover's old saved place, and with several
    // movers all their displaced boats would be sent to one saved place,
    // creating a fresh silent conflict.
    const conflictBoatIds = new Set(
      conflict.boats.map((boat) => String(boat.entry.boat_id)),
    );
    const occupiedElsewhere = new Set<number>();
    let heatSize = 0;
    editableSource.forEach((entry) => {
      const raceId = entry.race_ids?.[raceIndex];
      if (raceId == null) return;
      if (String(raceId) !== conflict.raceId) return;
      const status = entry.race_statuses?.[raceIndex] || 'FINISHED';
      if (status !== 'FINISHED' && !scoringPenaltyStatuses.has(status)) {
        return;
      }
      const place = parseRaceNum(entry.races[raceIndex]);
      if (!Number.isFinite(place) || place <= 0) return;
      heatSize += 1;
      if (!conflictBoatIds.has(String(entry.boat_id))) {
        occupiedElsewhere.add(place);
      }
    });

    const holes: number[] = [];
    for (let place = 1; place <= heatSize; place += 1) {
      if (
        place !== conflict.place &&
        !occupiedElsewhere.has(place) &&
        !claimedPlaces.has(place)
      ) {
        holes.push(place);
      }
    }

    displaced.forEach((boat, i) => {
      const targetPlace = holes[i];
      if (targetPlace == null) return; // not enough free slots: leave as-is
      claimedPlaces.add(targetPlace);
      swaps.push({
        boatId: boat.entry.boat_id,
        raceIndex: boat.raceIndex,
        rawPosition: targetPlace,
        // A position-keeping penalty (ZFP/SCP/T1) stays a penalty when it
        // is moved to the vacated place — only its place changes.
        status: boat.entry.race_statuses?.[boat.raceIndex] || 'FINISHED',
        // Direct assignment into the vacated slot: no ripple wanted.
        shift: false,
      });
    });
  });
  return swaps;
};
