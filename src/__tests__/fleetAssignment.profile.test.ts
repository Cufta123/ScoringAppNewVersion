/**
 * Fleet-assignment totals (SHRS 4.2/4.3) read a boat's scored POINTS, not her
 * finishing places, and honour the event's discard profile. These two
 * behaviours were once pinned only by a renderer copy of the function; they
 * are pinned here against the shared one both processes use.
 */
import { computeAdjustedFleetTotals } from '../shared/fleetAssignment';
import { getExcludeCountForProfile } from '../shared/discardProfile';

describe('computeAdjustedFleetTotals — inputs and discard profile', () => {
  it('uses race points, not finishing places, for the totals', () => {
    const rows = [
      {
        boat_id: 1,
        race_positions: '1,1,10,10,10,10',
        race_points: '1,1,1,1,1,1',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 2,
        race_positions: '2,2,2,2,2,2',
        race_points: '2,2,2,2,2,2',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
    ];

    const totals = computeAdjustedFleetTotals(rows, {
      getExcludeCount: (n) => getExcludeCountForProfile(n, 'standard'),
    });

    // 6 races: SHRS 5.4 drops one score and SHRS 4.3 a second one, so four
    // scores are kept per boat.
    expect(totals).toEqual([
      { boat_id: 1, totalPoints: 4 },
      { boat_id: 2, totalPoints: 8 },
    ]);
  });

  it('applies the event discard profile (custom thresholds)', () => {
    const rows = [
      {
        boat_id: 1,
        race_points: '1,2,3,4,5,6',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED,FINISHED,FINISHED',
      },
    ];
    const profile = JSON.stringify({ thresholds: [3, 5, 6] });

    const [withProfileOnly] = computeAdjustedFleetTotals(rows, {
      applyShs43TemporarySecondDiscard: false,
      getExcludeCount: (n) => getExcludeCountForProfile(n, profile),
    });
    // 6 races reach all three thresholds: three exclusions (6, 5, 4).
    expect(withProfileOnly.totalPoints).toBe(1 + 2 + 3);

    const [withBoth] = computeAdjustedFleetTotals(rows, {
      getExcludeCount: (n) => getExcludeCountForProfile(n, profile),
    });
    // SHRS 4.3's second-worst (5) is already dropped by the profile, so the
    // temporary exclusion adds nothing.
    expect(withBoth.totalPoints).toBe(1 + 2 + 3);
  });
});
