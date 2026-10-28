import planNextRound, {
  type NextRoundPlan,
  type PreAssignedBoat,
} from '../main/functions/nextRoundPlan';

const heat = (heat_id: number, heat_name: string) => ({ heat_id, heat_name });

function mustPlan(plan: NextRoundPlan) {
  if (!plan.ok) throw new Error(`expected a plan, got: ${plan.refusal}`);
  return plan;
}

/** boat ids that go into each new heat, by heat index */
function byNewHeat(plan: ReturnType<typeof mustPlan>) {
  const result: number[][] = plan.heatNames.map(() => []);
  plan.assignments.forEach(({ heatIndex, boatId }) => {
    result[heatIndex].push(boatId);
  });
  return result;
}

const noBoats = new Map<number, PreAssignedBoat[]>();
const noRanking = new Map<number, number[]>();

describe('planNextRound, progressive (Heat Movement Table)', () => {
  it('moves boats by heat and place: 1st stays, each further place rotates down', () => {
    // Heat Movement Table for 3 heats, places 1/2/3: A -> A, C, B ; B -> B, A, C ; C -> C, B, A
    const plan = mustPlan(
      planNextRound({
        latestHeats: [
          heat(1, 'Heat A1'),
          heat(2, 'Heat B1'),
          heat(3, 'Heat C1'),
        ],
        mode: 'progressive',
        boatsByHeatId: noBoats,
        rankedBoatIdsByHeatId: new Map([
          [1, [11, 12, 13]],
          [2, [21, 22, 23]],
          [3, [31, 32, 33]],
        ]),
      }),
    );
    expect(plan.heatNames).toEqual(['Heat A2', 'Heat B2', 'Heat C2']);
    expect(plan.roundNumber).toBe(2);
    expect(plan.heatCount).toBe(3);
    expect(byNewHeat(plan)).toEqual([
      [11, 22, 33],
      [13, 21, 32],
      [12, 23, 31],
    ]);
  });

  it('works with two heats of different sizes (odd heat sizes)', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(1, 'Heat A1'), heat(2, 'Heat B1')],
        mode: 'progressive',
        boatsByHeatId: noBoats,
        rankedBoatIdsByHeatId: new Map([
          [1, [1, 2, 3, 4]],
          [2, [5, 6, 7]],
        ]),
      }),
    );
    // 1st stays, 2nd swaps, 3rd stays, 4th swaps.
    expect(byNewHeat(plan)).toEqual([
      [1, 3, 6],
      [2, 4, 5, 7],
    ]);
    expect(plan.assignments).toHaveLength(7);
  });

  it('plans one heat as a round of its own', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(9, 'Heat A3')],
        mode: 'progressive',
        boatsByHeatId: noBoats,
        rankedBoatIdsByHeatId: new Map([[9, [4, 5]]]),
      }),
    );
    expect(plan.heatNames).toEqual(['Heat A4']);
    expect(plan.roundNumber).toBe(4);
    expect(byNewHeat(plan)).toEqual([[4, 5]]);
  });

  it('orders the heats by letter whatever order they come in', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(2, 'Heat B1'), heat(1, 'Heat A1')],
        mode: 'progressive',
        boatsByHeatId: noBoats,
        rankedBoatIdsByHeatId: new Map([
          [1, [1, 2]],
          [2, [3, 4]],
        ]),
      }),
    );
    expect(plan.heatNames).toEqual(['Heat A2', 'Heat B2']);
    expect(byNewHeat(plan)).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });

  it('numbers two-letter heats and later rounds from the heat name', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(1, 'Heat AA5'), heat(2, 'Heat AB5')],
        mode: 'progressive',
        boatsByHeatId: noBoats,
        rankedBoatIdsByHeatId: new Map([
          [1, [1]],
          [2, [2]],
        ]),
      }),
    );
    expect(plan.heatNames).toEqual(['Heat AA6', 'Heat AB6']);
    expect(plan.roundNumber).toBe(6);
  });

  it('ignores a heat that has no ranking but plans the others', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(1, 'Heat A1'), heat(2, 'Heat B1')],
        mode: 'progressive',
        boatsByHeatId: noBoats,
        rankedBoatIdsByHeatId: new Map([[1, [1, 2]]]),
      }),
    );
    expect(plan.assignments).toHaveLength(2);
  });

  it('refuses, in plain English, when no heat has a result', () => {
    const plan = planNextRound({
      latestHeats: [heat(1, 'Heat A1'), heat(2, 'Heat B1')],
      mode: 'progressive',
      boatsByHeatId: noBoats,
      rankedBoatIdsByHeatId: noRanking,
    });
    expect(plan).toEqual({
      ok: false,
      refusal:
        'Cannot build round 2: no boats could be assigned from Heat A1, Heat B1. Those heats have no recorded results to move boats from. Check that the previous round is fully scored before redistributing.',
    });
  });
});

describe('planNextRound, pre-assigned (carry forward)', () => {
  const boat = (
    boat_id: number,
    country: string | null,
    sail_number: string | number | null,
  ): PreAssignedBoat => ({ boat_id, country, sail_number });

  it('keeps every boat in the heat letter she sailed in', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(1, 'Heat A1'), heat(2, 'Heat B1')],
        mode: 'pre-assigned',
        boatsByHeatId: new Map([
          [1, [boat(1, 'CRO', 1), boat(2, 'CRO', 2)]],
          [2, [boat(3, 'CRO', 3)]],
        ]),
        rankedBoatIdsByHeatId: noRanking,
      }),
    );
    expect(plan.heatNames).toEqual(['Heat A2', 'Heat B2']);
    expect(byNewHeat(plan)).toEqual([[1, 2], [3]]);
  });

  it('ignores the finishing order', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(1, 'Heat A1'), heat(2, 'Heat B1')],
        mode: 'pre-assigned',
        boatsByHeatId: new Map([
          [1, [boat(1, 'CRO', 1)]],
          [2, [boat(2, 'CRO', 2)]],
        ]),
        rankedBoatIdsByHeatId: new Map([
          [1, [1]],
          [2, [2]],
        ]),
      }),
    );
    expect(byNewHeat(plan)).toEqual([[1], [2]]);
  });

  it('orders boats by national letters then sail number, numerically', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(1, 'Heat A1')],
        mode: 'pre-assigned',
        boatsByHeatId: new Map([
          [
            1,
            [
              boat(1, 'CRO', 10),
              boat(2, 'CRO', 9),
              boat(3, 'AUT', 12),
              boat(4, 'CRO', 100),
            ],
          ],
        ]),
        rankedBoatIdsByHeatId: noRanking,
      }),
    );
    expect(plan.assignments.map((a) => a.boatId)).toEqual([3, 2, 1, 4]);
  });

  it('settles identical seeding keys by boat id', () => {
    const plan = mustPlan(
      planNextRound({
        latestHeats: [heat(1, 'Heat A1')],
        mode: 'pre-assigned',
        boatsByHeatId: new Map([
          [1, [boat(8, null, null), boat(5, null, null)]],
        ]),
        rankedBoatIdsByHeatId: noRanking,
      }),
    );
    expect(plan.assignments.map((a) => a.boatId)).toEqual([5, 8]);
  });

  it('refuses, in plain English, when the heats have no boats', () => {
    const plan = planNextRound({
      latestHeats: [heat(1, 'Heat A2'), heat(2, 'Heat B2')],
      mode: 'pre-assigned',
      boatsByHeatId: new Map([
        [1, []],
        [2, []],
      ]),
      rankedBoatIdsByHeatId: noRanking,
    });
    expect(plan).toEqual({
      ok: false,
      refusal:
        'Cannot build round 3: no boats could be assigned from Heat A2, Heat B2. Those heats have no boats assigned to them. Check that the previous round is fully scored before redistributing.',
    });
  });
});

describe('planNextRound, no heats', () => {
  it('refuses instead of failing on an empty list', () => {
    const plan = planNextRound({
      latestHeats: [],
      mode: 'progressive',
      boatsByHeatId: noBoats,
      rankedBoatIdsByHeatId: noRanking,
    });
    expect(plan).toEqual({
      ok: false,
      refusal:
        'This event has no qualifying heats yet. Create the heats first.',
    });
  });
});
