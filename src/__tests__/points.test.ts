import { roundPoints, sumPoints } from '../shared/points';
import { applyExclusions } from '../renderer/utils/leaderboardUtils';
import { computeAdjustedFleetTotals } from '../shared/fleetAssignment';

// Tenth-point scores (RRS A9 redress averages) are not exact in binary, so a
// plain sum leaves noise and two equal totals stop comparing equal — which
// silently skips the SHRS 5.7 tie-break.
describe('point totals compare exactly', () => {
  const noisy = [15.1, 19.6, 12.9, 9.3, 0.7, 17.7, 11.8];

  it('removes float noise from a sum of tenths', () => {
    expect(noisy.reduce((a, b) => a + b, 0)).not.toBe(87.1);
    expect(sumPoints(noisy)).toBe(87.1);
  });

  it('keeps real differences', () => {
    expect(sumPoints([1.5, 2.5])).toBe(4);
    expect(roundPoints(10.05)).toBe(10.05);
    expect(sumPoints([0.1, 0.2])).not.toBe(sumPoints([0.1, 0.3]));
  });

  it('gives the same total whatever order the scores are summed in', () => {
    const reversed = [...noisy].reverse();
    expect(applyExclusions(noisy, [], noisy, 'standard', 3).total).toBe(
      applyExclusions(reversed, [], reversed, 'standard', 3).total,
    );
  });

  it('makes equal fleet-assignment totals tie', () => {
    const totals = computeAdjustedFleetTotals(
      [
        { boat_id: 1, race_points: '15.1,19.6,12.9,9.3,0.7,17.7,11.8' },
        { boat_id: 2, race_points: '87.1,0,0,0,0,0,0' },
      ],
      { getExcludeCount: () => 0, applyShs43TemporarySecondDiscard: false },
    );
    expect(totals[0].totalPoints).toBe(totals[1].totalPoints);
  });
});
