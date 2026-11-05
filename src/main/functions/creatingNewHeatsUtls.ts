import {
  getHeatGroupFromName,
  getHeatRoundFromName,
} from '../../shared/heatNames';

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
