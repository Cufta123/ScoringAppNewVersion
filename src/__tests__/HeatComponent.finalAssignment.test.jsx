import { buildAdjustedFleetLeaderboard } from '../renderer/components/HeatComponent';

jest.mock('../renderer/utils/printNewHeats', () => jest.fn());

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

  it('keeps standard discard only when SHRS 4.3 temporary exclusion is disabled', () => {
    const rows = [
      {
        boat_id: 'A',
        race_points: '1,2,3,4,5,6',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
    ];

    const adjusted = buildAdjustedFleetLeaderboard(rows, false);

    // n=6 with SHRS 4.3 disabled => only one exclusion (6).
    expect(adjusted).toEqual([{ boat_id: 'A', totalPoints: 15 }]);
  });

  it('applies SHRS 4.3 temporary exclusion at 7 races when enabled', () => {
    const rows = [
      {
        boat_id: 'A',
        race_points: '1,2,3,4,5,6,7',
        race_statuses:
          'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
    ];

    const adjusted = buildAdjustedFleetLeaderboard(rows, true);

    // n=7 with SHRS 4.3 enabled => two exclusions (7 and 6).
    expect(adjusted).toEqual([{ boat_id: 'A', totalPoints: 15 }]);
  });

  it('uses custom qualifying threshold list when provided', () => {
    const rows = [
      {
        boat_id: 'A',
        race_points: '1,2,3,4,5,6',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
    ];

    const adjusted = buildAdjustedFleetLeaderboard(
      rows,
      false,
      JSON.stringify({ thresholds: [3, 5, 6] }),
    );

    // n=6 with thresholds [3,5,6] => three exclusions (6,5,4).
    expect(adjusted).toEqual([{ boat_id: 'A', totalPoints: 6 }]);
  });
});
