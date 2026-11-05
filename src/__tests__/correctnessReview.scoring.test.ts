/**
 * Correctness review of the pure scoring core. Each test pins a bug found by
 * reading the rules against the code; it failed before its fix.
 */
import {
  DEFAULT_RESULTS_OPTIONS,
  buildResultsModel,
} from '../renderer/exports/resultsModel';
import type { LeaderboardEntry } from '../renderer/types';

describe('exported totals carry no floating-point noise', () => {
  // 1.1 + 2.2 is 3.3000000000000003 in binary floating point. Tenth-point
  // scores (RRS A7 halves, A9 redress averages) are common, and the screen
  // already sums through sumPoints; the export summed them with a plain +.
  const entry = (boat_id: number, points: string[]) =>
    ({
      boat_id,
      name: 'A',
      surname: 'B',
      country: 'CRO',
      boat_number: boat_id,
      boat_type: 'IOM',
      place: 1,
      races: points,
      race_points: points,
      race_statuses: points.map(() => 'FINISHED'),
      computed_total: 3.3,
      total_points_combined: 3.3,
      overall_rank: 1,
      placement_group: 'Gold',
    }) as unknown as LeaderboardEntry;

  const model = (input: {
    finalSeriesStarted: boolean;
    leaderboard: LeaderboardEntry[];
    eventLeaderboard: LeaderboardEntry[];
  }) =>
    buildResultsModel(
      {
        ...input,
        clubs: {},
      },
      DEFAULT_RESULTS_OPTIONS,
    );
  const totalOf = (data: ReturnType<typeof model>) =>
    data.sections[0].rows[0].total;

  it('qualifying export: Total is the exact sum of the race points', () => {
    const data = model({
      finalSeriesStarted: false,
      leaderboard: [],
      eventLeaderboard: [entry(1, ['1.1', '2.2'])],
    });
    expect(totalOf(data)).toBe(3.3);
  });

  it('final export: Total is the exact sum of qualifying + final points', () => {
    const data = model({
      finalSeriesStarted: true,
      leaderboard: [entry(1, ['2.2'])],
      eventLeaderboard: [entry(1, ['1.1'])],
    });
    expect(totalOf(data)).toBe(3.3);
  });
});
