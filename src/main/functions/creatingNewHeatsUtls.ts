import { compareNationalSail } from '../../shared/sailOrder';
import {
  getHeatGroupFromName,
  getHeatRoundFromName,
} from '../../shared/heatNames';

/**
 * SHRS 3 seeding order without a seeding list: national letters alphabetically,
 * then sail number. Sail numbers are TEXT and can be alphanumeric, so compare
 * numeric-aware ("9" < "10") — plain SQL ORDER BY would sort "10" before "9".
 * Single source of truth for both initial heat creation and pre-assigned
 * redistribution so every round seeds boats in the same order.
 *
 * Delegates to the shared `compareNationalSail` (SHRS 5.3 / 3.1(iv)) so heat
 * seeding breaks a tie identically to recording order, including the
 * case-insensitive national-letter comparison.
 */
export function compareByCountryThenSail(
  left: { country?: string | null; sail_number?: string | number | null },
  right: { country?: string | null; sail_number?: string | number | null },
): number {
  return compareNationalSail(left, right);
}

/**
 * SHRS 3.1 serpentine seeding for the FIRST round: walk the heats
 * A,B,…,E,E,…,B,A,A,B,… (boundary heats doubled) so adjacent-strength boats
 * spread evenly. Returns one heat index per boat, in boat order.
 */
export function assignBoatsToInitialHeatsSerpentine(
  boatCount: number,
  numHeats: number,
): number[] {
  if (numHeats <= 0) {
    throw new Error('Number of heats must be greater than 0.');
  }
  const heatIndices: number[] = [];
  let heatIndex = 0;
  let direction = 1;
  for (let i = 0; i < boatCount; i += 1) {
    heatIndices.push(heatIndex);
    if (direction === 1 && heatIndex === numHeats - 1) {
      direction = -1; // stay on the boundary heat once, then reverse
    } else if (direction === -1 && heatIndex === 0) {
      direction = 1;
    } else {
      heatIndex += direction;
    }
  }
  return heatIndices;
}

export function getNextHeatIndexByMovementTable(
  previousHeatIndex: number,
  finishingPlaceInHeat: number,
  numberOfHeats: number,
) {
  if (numberOfHeats <= 0) {
    throw new Error('Number of heats must be greater than 0.');
  }
  if (finishingPlaceInHeat <= 0) {
    throw new Error('Finishing place must be greater than 0.');
  }
  if (previousHeatIndex < 0 || previousHeatIndex >= numberOfHeats) {
    throw new Error('Previous heat index is out of range.');
  }

  // SHRS 2026-1 Heat Movement Table (Table 1 / Table 2): 1st place stays in the
  // same heat; each additional place rotates the boat DOWN the heat list (Heat
  // 2 -> Heat 1, Heat 1 -> last heat), wrapping around. That is a negative
  // rotation by (place - 1). Adding the shift instead rotates the wrong way and
  // only happens to match for 2 heats (where +1 and -1 are equal mod 2).
  const shift = (finishingPlaceInHeat - 1) % numberOfHeats;
  return (
    (((previousHeatIndex - shift) % numberOfHeats) + numberOfHeats) %
    numberOfHeats
  );
}

type HeatRef = { heat_name: string; heat_id: number };

/**
 * Group heats by their base letters ("Heat A2" -> base "A", suffix 2) and
 * keep only the heat with the highest numeric suffix for each base.
 */
function buildLatestHeatMapByBase(
  heats: HeatRef[],
): Record<string, { suffix: number; heat: HeatRef | null }> {
  return heats.reduce(
    (acc: Record<string, { suffix: number; heat: HeatRef | null }>, heat) => {
      const base = getHeatGroupFromName(heat.heat_name);
      const numericSuffix = getHeatRoundFromName(heat.heat_name);
      if (base !== null && numericSuffix !== null) {
        acc[base] = acc[base] || { suffix: -1, heat: null };
        if (numericSuffix >= acc[base].suffix) {
          acc[base] = { suffix: numericSuffix, heat };
        }
      }
      return acc;
    },
    {},
  );
}

export function findLatestHeatsBySuffix(existingHeats: HeatRef[]) {
  return Object.values(buildLatestHeatMapByBase(existingHeats))
    .map((entry) => entry.heat as HeatRef)
    .filter((heat) => heat !== null);
}

/** The part of the database this check needs (a prepared `COUNT(*)` read). */
interface RaceCountDb {
  prepare(sql: string): { get(heat_id: number): { race_count: number } };
}

export function checkRaceCountForLatestHeats(
  lastHeats: { heat_name: string; heat_id: number }[],
  db: RaceCountDb,
) {
  const raceCountQuery = db.prepare(
    `SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?`,
  );

  const heatRaceCounts = lastHeats.map((heat) => {
    const raceCount = raceCountQuery.get(heat.heat_id).race_count;
    return { heat_name: heat.heat_name, raceCount };
  });

  const uniqueRaceCounts = [
    ...new Set(heatRaceCounts.map((item) => item.raceCount)),
  ];

  if (uniqueRaceCounts.length > 1) {
    const breakdown = heatRaceCounts
      .map((h) => `${h.heat_name}: ${h.raceCount} race(s)`)
      .join(', ');
    throw new Error(
      `Not all heats have the same number of races yet — you need to finish the current round before redistributing.\n\nCurrent state: ${breakdown}`,
    );
  }
}

export function generateNextHeatNames(latestHeats: HeatRef[]) {
  const heatMap = buildLatestHeatMapByBase(latestHeats);
  return Object.keys(heatMap).map(
    (base) => `Heat ${base}${heatMap[base].suffix + 1}`,
  );
}
