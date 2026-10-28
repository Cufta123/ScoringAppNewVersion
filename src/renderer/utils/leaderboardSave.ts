import { parseRaceNum } from './leaderboardUtils';
import type { UserRaceEdit } from './leaderboardEdit';
import type { LeaderboardEntry } from '../types';

/** One touched race, saved whole as the edit screen shows it. */
export interface SaveRaceOperation {
  raceId: string;
  cells: {
    boatId: number;
    position: number;
    status: string;
    /** RDG2: the races whose average was granted, so it stays live. */
    rdgRaceIds?: number[];
    /**
     * The user typed in this cell this session. A boat that only moved because
     * of another cell (RRS A6.1 promotion, place ripple) is false. SHRS 3.1.5:
     * only edited cells are protest decisions or race-office corrections.
     */
    edited: boolean;
  }[];
}

type RaceCells = SaveRaceOperation['cells'];

/**
 * The races to write on Save: every race the user touched, WHOLE, exactly as
 * the screen shows it. The main process checks it and scores it again from the
 * rules (applyRaceColumnState), so what is saved is what was shown. Replaying
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
      return [
        {
          boatId: entry.boat_id,
          position: parseRaceNum(entry.races[i]),
          status,
          edited: edit != null,
          ...(rdgRaceIds ? { rdgRaceIds } : {}),
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
