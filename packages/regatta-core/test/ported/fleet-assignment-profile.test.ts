/**
 * Ported from the app's src/__tests__/fleetAssignment.profile.test.ts: the
 * fleet split reads a boat's points, not her places, and follows the
 * event's discard profile.
 */
import { qualifyingStandings } from '../../src';
import { splitEvent, splitOrder } from './fleetSplitBuilder';

it('SHRS 4.2 / 4.3: the split uses race points (RDG3), not finishing places', () => {
  // X finishes 1, 1, 10, 10, 10, 10 but gets redress of 1 point (RDG3) in
  // the four races she finished 10th. 6 races: 5.4 and 4.3 leave out two.
  const rdg = { place: 10, points: 1 };
  const state = splitEvent({
    heats: 2,
    heatSize: 10,
    races: 6,
    featured: {
      X: { heat: 0, scores: [1, 1, rdg, rdg, rdg, rdg] },
      Y: { heat: 1, scores: [2, 2, 2, 2, 2, 2] },
    },
  });
  // Split: X 4, Y 8. On places X would have 22.
  expect(splitOrder(state, ['X', 'Y'])).toEqual(['X', 'Y']);
});

describe('SHRS 5.4 changed to discards at 3, 5 and 6 races', () => {
  // 6 races: three scores out by the profile, which already include the
  // second-worst, so 4.3 leaves out nothing more.
  const event = (rule43: boolean) =>
    splitEvent({
      heats: 2,
      heatSize: 10,
      races: 6,
      rule43,
      discards: { kind: 'thresholds', at: [3, 5, 6] },
      featured: {
        X: { heat: 0, scores: [1, 2, 3, 4, 5, 6] },
        Y: { heat: 1, scores: [5, 5, 5, 5, 1, 1] },
      },
    });

  it('SHRS 5.4: the profile leaves out three scores (6, 5, 4)', () => {
    const { standings } = qualifyingStandings(event(false));
    expect(standings.find((s) => s.boat === 'X')!.total).toBe(6);
    expect(standings.find((s) => s.boat === 'Y')!.total).toBe(7);
  });

  it.each([false, true])(
    'SHRS 4.3 (on: %p): adds nothing when the profile already left out the second-worst',
    (rule43) => {
      // X 6 against Y 7. One more score out would give X 3, Y 2.
      expect(splitOrder(event(rule43), ['X', 'Y'])).toEqual(['X', 'Y']);
    },
  );
});
