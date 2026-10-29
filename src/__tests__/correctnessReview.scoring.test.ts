/**
 * Correctness review of the pure scoring core. Each test pins a bug found by
 * reading the rules against the code; it failed before its fix.
 */
import { normalizeDiscardConfig } from '../shared/discardProfile';
import { rankQualifyingSeries } from '../shared/scoring/series';
import {
  OverallRaceScore,
  compareOverallTiePackets,
  overallTiePacketFromScores,
} from '../shared/scoring/overall';

const NEVER = normalizeDiscardConfig({ thresholds: [] });

describe('RRS A8.2: "the last race" is the latest race sailed', () => {
  // Races.race_number counts races WITHIN a heat, so a heat that sails two
  // races before the round is rebuilt gives: round 1 = race_id 1 (no. 1) and
  // race_id 2 (no. 2), round 2 = race_id 3 (no. 1). Race 3 is the last race
  // sailed, although its race_number is the smallest.
  const race = (
    race_id: number,
    race_number: number,
    points: number,
    round = race_id === 3 ? 2 : 1,
  ) => ({
    race_id,
    race_number,
    points,
    round,
  });

  it('qualifying: breaks an A8.1 tie on the race sailed last, not the highest race number', () => {
    // Same boats in the same heat in every race, so SHRS 5.7(i)/(ii)(1): A8.1
    // on the same set of scores (equal), then A8.2.
    const ranked = rankQualifyingSeries(
      [
        {
          boat_id: 'X',
          scores: [race(1, 1, 2), race(2, 2, 3), race(3, 1, 4)],
        },
        {
          boat_id: 'Y',
          scores: [race(1, 1, 3), race(2, 2, 4), race(3, 1, 2)],
        },
      ],
      { discardConfig: NEVER },
    );
    // Both total 9 with scores {2, 3, 4}. Last race sailed (race_id 3): Y 2,
    // X 4, so Y is ahead.
    expect(ranked.map((b) => b.boat_id)).toEqual(['Y', 'X']);
    expect(ranked.map((b) => b.place)).toEqual([1, 2]);
  });

  it('overall: the same rule for the A8.2 list and the shared-race comparison', () => {
    const q = (race_id: number, race_number: number, points: number) =>
      ({
        race_id,
        race_number,
        points,
        status: 'FINISHED',
        heat_type: 'Qualifying',
        heat_name: race_id === 3 ? 'Heat A2' : 'Heat A1',
      }) as OverallRaceScore;
    const context = {
      qualifyingDiscardConfig: NEVER,
      finalDiscardConfig: NEVER,
      qualifyingRaceCount: 3,
      finalFleetRaceCount: 0,
    };
    const x = overallTiePacketFromScores(
      [q(1, 1, 2), q(2, 2, 3), q(3, 1, 4)],
      context,
    );
    const y = overallTiePacketFromScores(
      [q(1, 1, 3), q(2, 2, 4), q(3, 1, 2)],
      context,
    );
    // Last race first: race 3, then race 2, then race 1.
    expect(x.a82AllScores).toEqual([4, 3, 2]);
    expect(y.a82AllScores).toEqual([2, 4, 3]);
    // Y scored 2 against X's 4 in the last race sailed: Y ranks ahead (< 0
    // means the left packet ranks ahead).
    expect(compareOverallTiePackets(y, x)).toBeLessThan(0);
    expect(compareOverallTiePackets(x, y)).toBeGreaterThan(0);
  });
});
