import {
  getHeatGroupFromName,
  getHeatRoundFromName,
} from '../../shared/heatNames';

export interface HeatForAssignment {
  heat_id: number;
  heat_name: string;
  heat_type: string;
  raceNumber: number;
  boats: { boat_id: number }[];
}

export interface EntryForAssignment {
  boat_id: number;
}

export interface UnassignedEntries<E> {
  /** Entered boats that are in no heat of the current qualifying round. */
  unassigned: E[];
  /** Current-round heats that have not raced yet — a boat may still join. */
  openHeats: HeatForAssignment[];
}

/**
 * Entered boats missing from the current qualifying round.
 *
 * Heats are built from the entry list, so a boat entered AFTER they were built
 * is in no heat. Nothing moves her into one later: the next round is seeded
 * from the previous round's results, which she has none of. She is then scored
 * DNC for every round (RRS A5.1 / SHRS 5.3) — correct if she really is not
 * racing, but usually the race office simply never placed her.
 *
 * The current round is the highest round number among the qualifying heats.
 * Returns nothing once the Final Series has started (fleets are fixed, SHRS
 * 4.1) or before any heats exist.
 */
export function findUnassignedEntries<E extends EntryForAssignment>(
  entries: E[],
  heats: HeatForAssignment[],
  finalSeriesStarted: boolean,
): UnassignedEntries<E> {
  const qualifying = heats.filter((heat) => heat.heat_type === 'Qualifying');
  if (finalSeriesStarted || qualifying.length === 0) {
    return { unassigned: [], openHeats: [] };
  }
  const rounds = qualifying
    .map((heat) => getHeatRoundFromName(heat.heat_name))
    .filter((round): round is number => round !== null);
  if (rounds.length === 0) return { unassigned: [], openHeats: [] };
  const currentRound = Math.max(...rounds);
  const currentHeats = qualifying
    .filter((heat) => getHeatRoundFromName(heat.heat_name) === currentRound)
    .sort((a, b) =>
      String(getHeatGroupFromName(a.heat_name)).localeCompare(
        String(getHeatGroupFromName(b.heat_name)),
      ),
    );

  const placed = new Set(
    currentHeats.flatMap((heat) => heat.boats.map((boat) => boat.boat_id)),
  );
  return {
    unassigned: entries.filter((entry) => !placed.has(entry.boat_id)),
    openHeats: currentHeats.filter((heat) => heat.raceNumber === 0),
  };
}

/** SHRS 2.2: heats as equal as possible — suggest the smallest open heat. */
export function suggestHeat(openHeats: HeatForAssignment[]): number | null {
  if (openHeats.length === 0) return null;
  return openHeats.reduce((best, heat) =>
    heat.boats.length < best.boats.length ? heat : best,
  ).heat_id;
}
