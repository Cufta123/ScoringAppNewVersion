import {
  applyExclusions,
  processLeaderboardEntry,
} from '../renderer/utils/leaderboardUtils';

describe('leaderboardUtils applyExclusions edge cases', () => {
  it('does not exclude DNE/DGM even if they are worst scores', () => {
    const raw = ['10', '9', '8', '1'];
    const statuses = ['DNE', 'DGM', 'FINISHED', 'FINISHED'];
    const { markedRaces, total } = applyExclusions(raw, statuses, raw);

    expect(markedRaces).toEqual(['10', '9', '(8)', '1']);
    expect(total).toBe(20);
  });

  it('for equal worst scores excludes earliest race first', () => {
    const raw = ['7', '7', '2', '1'];
    const statuses = ['FINISHED', 'FINISHED', 'FINISHED', 'FINISHED'];
    const { markedRaces, total } = applyExclusions(raw, statuses, raw);

    expect(markedRaces).toEqual(['(7)', '7', '2', '1']);
    expect(total).toBe(10);
  });
});

describe('processLeaderboardEntry race_points handling', () => {
  it('uses race_points for exclusion logic while preserving displayed race_positions', () => {
    const entry = {
      boat_id: 'b1',
      total_points_event: 7,
      race_positions: '3,2,1,4',
      race_points: '5,2,1,4',
      race_ids: '1,2,3,4',
      race_statuses: 'ZFP,FINISHED,FINISHED,FINISHED',
    };

    const processed = processLeaderboardEntry(entry);
    expect(processed.races).toEqual(['(3)', '2', '1', '4']);
    expect(processed.race_points).toEqual(['5', '2', '1', '4']);
  });
});
