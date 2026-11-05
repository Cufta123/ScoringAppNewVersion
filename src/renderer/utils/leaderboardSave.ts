import { parseRaceNum } from './leaderboardUtils';
import type { UserRaceEdit } from './leaderboardEdit';
import type { LeaderboardEntry } from '../types';
import type { SaveRaceOperation } from '../../shared/rows';

/** One touched race, saved whole as the edit screen shows it (IPC contract). */
export type { SaveRaceOperation };

type RaceCells = SaveRaceOperation['cells'];

/**
 * The races to write on Save: every race the user touched, WHOLE, exactly as
 * the screen shows it. The main process checks it and scores it again from the
 * rules (checkedRaceColumn, regatta-core), so what is saved is what was shown. Replaying
 * each edit on its own used to apply them in a different order from the
 * screen when a cell was edited twice, and could save another result.
 *
 * A touched race whose cells equal the saved ones is left out. Throws when an
 * edited cell has no race id (nothing to write it to).
 */
export function buildRaceOperations(
  editable: LeaderboardEntry[],
  original: LeaderboardEntry[],
  edits: Map<string, UserRaceEdit>,
): SaveRaceOperation[] {
  const editableByBoat = new Map<unknown, LeaderboardEntry>();
  editable.forEach((entry) => {
    if (!editableByBoat.has(entry.boat_id)) {
      editableByBoat.set(entry.boat_id, entry);
    }
  });

  const touchedRaceIds = new Set<string>();
  edits.forEach(({ boatId, raceIndex }) => {
    const raceId = editableByBoat.get(boatId)?.race_ids?.[raceIndex];
    if (raceId == null) {
      throw new Error(
        `Cannot save race updates: missing race ID for boat ${boatId}.`,
      );
    }
    touchedRaceIds.add(String(raceId));
  });

  const cellsOf = (rows: LeaderboardEntry[], raceId: string): RaceCells =>
    rows.flatMap((entry) => {
      const i = (entry.race_ids || []).findIndex((id) => String(id) === raceId);
      if (i === -1) return [];
      const status = entry.race_statuses?.[i] || 'FINISHED';
      const edit = edits.get(`${entry.boat_id}-${i}`);
      const rdgRaceIds =
        status === 'RDG2' && edit?.rdgSelection
          ? edit.rdgSelection.seriesIndices
              .map((idx) => Number(entry.race_ids?.[idx]))
              .filter((id) => Number.isFinite(id))
          : undefined;
      const keepsPoints = status.startsWith('RDG') || status === 'DPI';
      const held = Number(entry.race_held_places?.[i] || NaN);
      return [
        {
          boatId: entry.boat_id,
          position: parseRaceNum(entry.races[i]),
          status,
          edited: edit != null,
          ...(rdgRaceIds ? { rdgRaceIds } : {}),
          ...(keepsPoints
            ? { heldPlace: Number.isFinite(held) ? held : null }
            : {}),
        },
      ];
    });

  const sameRace = (a: RaceCells, b: RaceCells) => {
    const bByBoat = new Map(b.map((cell) => [cell.boatId, cell]));
    return (
      a.length === b.length &&
      a.every((cell) => {
        const other = bByBoat.get(cell.boatId);
        return (
          other != null &&
          other.status === cell.status &&
          other.position === cell.position &&
          (other.heldPlace ?? null) === (cell.heldPlace ?? null) &&
          cell.rdgRaceIds == null
        );
      })
    );
  };

  const operations: SaveRaceOperation[] = [];
  touchedRaceIds.forEach((raceId) => {
    const cells = cellsOf(editable, raceId);
    if (sameRace(cells, cellsOf(original, raceId))) return;
    operations.push({ raceId, cells });
  });
  return operations;
}
