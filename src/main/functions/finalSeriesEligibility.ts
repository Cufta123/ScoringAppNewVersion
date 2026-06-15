/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import { findLatestHeatsBySuffix } from './creatingNewHeatsUtls';
import { getRaceCountForHeat } from './heatQueries';

export type FinalSeriesEligibility = {
  ok: boolean;
  reason: 'OK' | 'NO_HEATS' | 'SINGLE_FLEET' | 'UNEQUAL_RACE_COUNTS';
  numFinalHeats: number;
  completedQualifyingRaces: number;
  rule43Applies: boolean;
  noRacesCompleted: boolean;
  raceCountBreakdown: { name: string; count: number }[];
};

// Pure SHRS validation of whether the Final Series can start. Lives in the
// main process so the rules (group counting, equal-race-count, Rule 4.3
// threshold) have one home; the renderer only renders prompts from the result.
export function getFinalSeriesEligibility(
  event_id: any,
): FinalSeriesEligibility {
  const empty = {
    numFinalHeats: 0,
    completedQualifyingRaces: 0,
    rule43Applies: false,
    noRacesCompleted: true,
    raceCountBreakdown: [] as { name: string; count: number }[],
  };

  const qualifyingHeats = db
    .prepare(
      `SELECT heat_name, heat_id FROM Heats WHERE event_id = ? AND heat_type = 'Qualifying'`,
    )
    .all(event_id) as { heat_name: string; heat_id: number }[];

  if (qualifyingHeats.length === 0) {
    return { ok: false, reason: 'NO_HEATS', ...empty };
  }

  const uniqueGroups = new Set<string>();
  qualifyingHeats.forEach((heat) => {
    const match = heat.heat_name.match(/Heat ([A-Z]+)/);
    if (match) {
      uniqueGroups.add(match[1]);
    }
  });
  const numFinalHeats = uniqueGroups.size;
  if (numFinalHeats < 2) {
    return { ok: false, reason: 'SINGLE_FLEET', ...empty, numFinalHeats };
  }

  const latestHeats = findLatestHeatsBySuffix(qualifyingHeats) as {
    heat_name: string;
    heat_id: number;
  }[];
  const raceCountBreakdown = latestHeats.map((heat) => ({
    name: heat.heat_name,
    count: getRaceCountForHeat(heat.heat_id),
  }));
  const uniqueCounts = [...new Set(raceCountBreakdown.map((r) => r.count))];
  if (uniqueCounts.length > 1) {
    return {
      ok: false,
      reason: 'UNEQUAL_RACE_COUNTS',
      ...empty,
      numFinalHeats,
      raceCountBreakdown,
    };
  }

  const racesFromHeats = uniqueCounts[0] || 0;
  // Completed races = the most races any boat has actually been scored in.
  // This catches the SHRS 4.3 window even when a next round's races have been
  // created but not yet sailed.
  const completedFromScores =
    (
      db
        .prepare(
          `SELECT MAX(cnt) AS maxcnt FROM (
             SELECT COUNT(*) AS cnt
             FROM Scores s
             JOIN Races r ON s.race_id = r.race_id
             JOIN Heats h ON r.heat_id = h.heat_id
             WHERE h.event_id = ? AND h.heat_type = 'Qualifying'
             GROUP BY s.boat_id
           )`,
        )
        .get(event_id) as { maxcnt: number | null } | undefined
    )?.maxcnt ?? 0;
  const completedQualifyingRaces =
    completedFromScores > 0 ? completedFromScores : racesFromHeats;

  return {
    ok: true,
    reason: 'OK',
    numFinalHeats,
    completedQualifyingRaces,
    rule43Applies: completedQualifyingRaces > 5 && completedQualifyingRaces < 8,
    noRacesCompleted: racesFromHeats === 0,
    raceCountBreakdown,
  };
}
