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
  // True only when NOTHING has been scored anywhere in the qualifying series.
  noRacesCompleted: boolean;
  // True when the most recent round of heats has been created but not sailed
  // yet (0 races), while earlier rounds DO have results. The Final Series then
  // falls back to the last completed round — the renderer tells the user so.
  latestRoundUnsailed: boolean;
  // Numeric suffix of the latest round (e.g. "Heat A7" -> 7), for the message.
  latestRoundNumber: number | null;
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
    latestRoundUnsailed: false,
    latestRoundNumber: null as number | null,
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

  // The newest round of heats exists but hasn't been sailed (0 created races),
  // yet earlier rounds were scored. Fleet assignment falls back to the last
  // completed round; the renderer surfaces this instead of "no races".
  const latestRoundUnsailed =
    racesFromHeats === 0 && completedQualifyingRaces > 0;
  const suffixMatch = latestHeats[0]?.heat_name.match(/Heat [A-Z]+(\d+)/);
  const latestRoundNumber = suffixMatch ? parseInt(suffixMatch[1], 10) : null;

  return {
    ok: true,
    reason: 'OK',
    numFinalHeats,
    completedQualifyingRaces,
    latestRoundUnsailed,
    latestRoundNumber,
    rule43Applies: completedQualifyingRaces > 5 && completedQualifyingRaces < 8,
    // Derive from the SAME count that drives rule43Applies. Using racesFromHeats
    // here (the latest round only) reported "no races completed" whenever a new
    // round of heats was created but not yet sailed — even though earlier rounds
    // had scored races. That made the renderer show the contradictory pair of
    // prompts: "no qualifying races completed" AND "Rule 4.3 applies for 6-7
    // completed races". Tying both flags to completedQualifyingRaces keeps them
    // consistent.
    noRacesCompleted: completedQualifyingRaces === 0,
    raceCountBreakdown,
  };
}
