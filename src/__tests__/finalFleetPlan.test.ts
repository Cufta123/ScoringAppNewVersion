import planFinalFleets, {
  NO_QUALIFYING_RESULTS_REFUSAL,
  findWithdrawnBoatIds,
  type FleetCandidate,
} from '../main/functions/finalFleetPlan';

/** n boats, boat i has i points, so boat 1 ranks first. */
const boats = (n: number): FleetCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    boat_id: i + 1,
    totalPoints: i + 1,
  }));

const sizes = (fleets: number[][]) => fleets.map((fleet) => fleet.length);

function mustPlan(plan: ReturnType<typeof planFinalFleets>) {
  if (!plan.ok) throw new Error(`expected a plan, got: ${plan.refusal}`);
  return plan.fleets;
}

describe('planFinalFleets', () => {
  it('splits the ranking into one fleet per qualifying heat, best boats first', () => {
    const fleets = mustPlan(
      planFinalFleets(boats(6), new Set(), 2, 'auto-increase', false),
    );
    expect(fleets).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('gives the earlier fleets the remainder when sizes cannot be equal', () => {
    const fleets = mustPlan(
      planFinalFleets(boats(11), new Set(), 3, 'auto-increase', false),
    );
    expect(sizes(fleets)).toEqual([4, 4, 3]);
    expect(fleets.flat()).toEqual(boats(11).map((boat) => boat.boat_id));
  });

  it.each([
    [7, 2, [4, 3]],
    [8, 3, [3, 3, 2]],
    [9, 4, [3, 2, 2, 2]],
    [13, 5, [3, 3, 3, 2, 2]],
  ])('%i boats in %i fleets are sized %j', (count, heats, expected) => {
    const fleets = mustPlan(
      planFinalFleets(boats(count), new Set(), heats, 'auto-increase', false),
    );
    expect(sizes(fleets)).toEqual(expected);
  });

  it('ranks by qualifying total whatever order the boats arrive in', () => {
    const shuffled: FleetCandidate[] = [
      { boat_id: 30, totalPoints: 9 },
      { boat_id: 10, totalPoints: 2 },
      { boat_id: 20, totalPoints: 5 },
      { boat_id: 40, totalPoints: 12 },
    ];
    const fleets = mustPlan(
      planFinalFleets(shuffled, new Set(), 2, 'auto-increase', false),
    );
    expect(fleets).toEqual([
      [10, 20],
      [30, 40],
    ]);
  });

  it('keeps the incoming order for boats with equal totals', () => {
    const tied: FleetCandidate[] = [
      { boat_id: 7, totalPoints: 3 },
      { boat_id: 5, totalPoints: 3 },
      { boat_id: 9, totalPoints: 3 },
    ];
    const fleets = mustPlan(
      planFinalFleets(tied, new Set(), 1, 'auto-increase', false),
    );
    expect(fleets).toEqual([[7, 5, 9]]);
  });

  it('does not change the list it is given', () => {
    const input = [
      { boat_id: 2, totalPoints: 5 },
      { boat_id: 1, totalPoints: 1 },
    ];
    planFinalFleets(input, new Set(), 1, 'auto-increase', false);
    expect(input.map((boat) => boat.boat_id)).toEqual([2, 1]);
  });

  describe('withdrawn boats', () => {
    it('go after everyone else, each group by points', () => {
      const ranked: FleetCandidate[] = [
        { boat_id: 1, totalPoints: 1 },
        { boat_id: 2, totalPoints: 2 },
        { boat_id: 3, totalPoints: 3 },
        { boat_id: 4, totalPoints: 4 },
      ];
      const fleets = mustPlan(
        planFinalFleets(ranked, new Set([1, 3]), 2, 'auto-increase', false),
      );
      expect(fleets).toEqual([
        [2, 4],
        [1, 3],
      ]);
    });

    it('still get a fleet when every boat has withdrawn', () => {
      const fleets = mustPlan(
        planFinalFleets(
          boats(5),
          new Set([1, 2, 3, 4, 5]),
          2,
          'auto-increase',
          false,
        ),
      );
      expect(fleets).toEqual([
        [1, 2, 3],
        [4, 5],
      ]);
    });
  });

  describe('fleet count', () => {
    it('makes fewer fleets than qualifying heats when there are fewer boats', () => {
      const fleets = mustPlan(
        planFinalFleets(boats(2), new Set(), 4, 'auto-increase', false),
      );
      expect(fleets).toEqual([[1], [2]]);
    });
    it('never makes more fleets than boats (no empty fleet)', () => {
      const fleets = mustPlan(
        planFinalFleets(boats(1), new Set(), 5, 'auto-increase', false),
      );
      expect(fleets).toEqual([[1]]);
    });

    it('makes one fleet for one qualifying heat', () => {
      const fleets = mustPlan(
        planFinalFleets(boats(4), new Set(), 1, 'auto-increase', false),
      );
      expect(fleets).toEqual([[1, 2, 3, 4]]);
    });

    it('treats a missing heat count as one fleet instead of dividing by zero', () => {
      const fleets = mustPlan(
        planFinalFleets(boats(3), new Set(), 0, 'auto-increase', false),
      );
      expect(sizes(fleets)).toEqual([3]);
    });
  });

  describe('more than 20 boats a fleet (SHRS 2.3)', () => {
    it('auto-increase adds fleets until none is over 20', () => {
      const fleets = mustPlan(
        planFinalFleets(boats(45), new Set(), 2, 'auto-increase', false),
      );
      expect(sizes(fleets)).toEqual([15, 15, 15]);
    });

    it('auto-increase does not need a confirmation', () => {
      const plan = planFinalFleets(
        boats(41),
        new Set(),
        2,
        'auto-increase',
        false,
      );
      expect(plan.ok).toBe(true);
    });

    it('exactly 20 a fleet is not oversize', () => {
      const fleets = mustPlan(
        planFinalFleets(
          boats(40),
          new Set(),
          2,
          'confirm-allow-oversize',
          false,
        ),
      );
      expect(sizes(fleets)).toEqual([20, 20]);
    });

    it('confirm-allow-oversize refuses without confirmation', () => {
      const plan = planFinalFleets(
        boats(41),
        new Set(),
        2,
        'confirm-allow-oversize',
        false,
      );
      expect(plan).toEqual({
        ok: false,
        refusal:
          'Final fleets would exceed 20 boats. Confirm oversize to continue or switch event policy to auto-increase heats.',
      });
    });

    it('confirm-allow-oversize keeps the heat count once confirmed', () => {
      const fleets = mustPlan(
        planFinalFleets(
          boats(41),
          new Set(),
          2,
          'confirm-allow-oversize',
          true,
        ),
      );
      expect(sizes(fleets)).toEqual([21, 20]);
    });
  });

  it('refuses when there are no boats', () => {
    expect(planFinalFleets([], new Set(), 2, 'auto-increase', false)).toEqual({
      ok: false,
      refusal: NO_QUALIFYING_RESULTS_REFUSAL,
    });
  });

  it('has no ids, SQL or "undefined" in any refusal', () => {
    const texts = [
      NO_QUALIFYING_RESULTS_REFUSAL,
      (
        planFinalFleets(
          boats(50),
          new Set(),
          2,
          'confirm-allow-oversize',
          false,
        ) as { refusal: string }
      ).refusal,
    ];
    texts.forEach((text) => {
      expect(text).not.toMatch(/undefined|SELECT|boat_id|\d{3,}/);
    });
  });
});

describe('findWithdrawnBoatIds', () => {
  it('finds boats with WTH in any race, ignoring case and spaces', () => {
    const ids = findWithdrawnBoatIds([
      { boat_id: 1, race_statuses: 'FINISHED,FINISHED' },
      { boat_id: 2, race_statuses: 'FINISHED, wth ,DNF' },
      { boat_id: 3, race_statuses: 'WTH' },
      { boat_id: 4, race_statuses: null },
      { boat_id: 5, race_statuses: '' },
    ]);
    expect([...ids].sort()).toEqual([2, 3]);
  });
});
