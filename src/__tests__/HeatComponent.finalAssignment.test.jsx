import { buildAdjustedFleetLeaderboard } from '../renderer/components/HeatComponent';

describe('HeatComponent final fleet assignment scoring', () => {
  it('uses race points (not positions) when building assignment totals', () => {
    const rows = [
      {
        boat_id: 'A',
        race_positions: '1,1,10,10,10,10',
        race_points: '1,1,1,1,1,1',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 'B',
        race_positions: '2,2,2,2,2,2',
        race_points: '2,2,2,2,2,2',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
    ];

    const adjusted = buildAdjustedFleetLeaderboard(rows).sort(
      (left, right) => left.totalPoints - right.totalPoints,
    );

    // n=6 => exclude 2 worst for final-fleet assignment (SHRS 4.2 temporary extra exclusion).
    expect(adjusted).toEqual([
      { boat_id: 'A', totalPoints: 4 },
      { boat_id: 'B', totalPoints: 8 },
    ]);
  });

  it('does not exclude DNE/DGM scores from assignment totals', () => {
    const rows = [
      {
        boat_id: 'A',
        race_points: '1,2,3,100,40,50',
        race_statuses: 'FINISHED,FINISHED,FINISHED,DNE,FINISHED,FINISHED',
      },
    ];

    const adjusted = buildAdjustedFleetLeaderboard(rows);

    // With n=6, two worst excludable scores are dropped (50,40), but DNE(100) stays.
    expect(adjusted).toEqual([{ boat_id: 'A', totalPoints: 106 }]);
  });
});
