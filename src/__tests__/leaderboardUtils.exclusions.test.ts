import { processLeaderboardEntry } from '../renderer/utils/leaderboardUtils';

// Which scores are excluded and the totals are regatta-core's (SHRS 5.4,
// packages/regatta-core/test); the row only shows them.
describe('processLeaderboardEntry shows the library’s discards', () => {
  it('brackets the scores marked excluded and keeps the points as sent', () => {
    const entry = {
      boat_id: 1,
      total_points_event: 7,
      race_positions: '3,2,1,4',
      race_points: '5,2,1,4',
      race_ids: '1,2,3,4',
      race_statuses: 'ZFP,FINISHED,FINISHED,FINISHED',
      race_excluded: '1,0,0,0',
    };

    const processed = processLeaderboardEntry(entry);
    expect(processed.races).toEqual(['(3)', '2', '1', '4']);
    expect(processed.race_points).toEqual(['5', '2', '1', '4']);
    expect(processed.computed_total).toBe(7);
    expect(processed).not.toHaveProperty('race_excluded');
  });

  it('takes the library’s total, not a sum worked out here', () => {
    const entry = {
      boat_id: 7,
      total_points_event: 10,
      race_positions: '5,4,3,2,1',
      race_points: '5,4,3,2,1',
      race_ids: '1,2,3,4,5',
      race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      race_excluded: '1,0,0,0,0',
    };
    const processed = processLeaderboardEntry(entry);
    expect(processed.computed_total).toBe(10);
    expect(processed.races).toEqual(['(5)', '4', '3', '2', '1']);
  });

  it('works no discards out for a row without the library’s flags', () => {
    const entry = {
      boat_id: 2,
      race_positions: '5,4,3,2,1',
      race_points: '5,4,3,2,1',
      race_ids: '1,2,3,4,5',
      race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
    };
    const processed = processLeaderboardEntry(entry);
    expect(processed.races).toEqual(['5', '4', '3', '2', '1']);
    expect(processed.computed_total).toBe(15);
  });
});
