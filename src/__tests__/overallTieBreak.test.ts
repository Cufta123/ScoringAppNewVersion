/* eslint-disable camelcase */
/**
 * Direct unit tests for compareOverallTiePackets (overallTieBreak.ts).
 *
 * The handler-level tests exercise the SHARED-heat path (SHRS 5.6.ii.a / 5.7.2),
 * but the "tied boats never sailed in the same heat" fallback (SHRS 5.6.ii.b /
 * 5.7.2.5 -> plain RRS A8.1 then A8.2) and the final deterministic fallback were
 * uncovered. These pin those branches with rule-correct expectations.
 */
import {
  compareOverallTiePackets,
  resolveOverallTieGroupSequentially,
  OverallTiePacket,
  OverallRaceScore,
} from '../main/functions/overallTieBreak';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

function packet(
  raceIds: number[],
  a81KeptScores: number[],
  a82AllScores: number[],
  byRaceId: Map<number, OverallRaceScore> = new Map(),
): OverallTiePacket {
  return {
    raceIds: new Set(raceIds),
    byRaceId,
    a81KeptScores,
    a82AllScores,
  };
}

describe('compareOverallTiePackets — no shared heat (SHRS 5.6.ii.b, plain A8)', () => {
  it('breaks the tie by A8.1 (best-to-worst) when boats never shared a race', () => {
    // Disjoint race_ids -> no shared races -> plain A8.1 on kept scores.
    // X kept [1,2,4], Y kept [1,1,5]: first difference at the 2nd-best score
    // (2 vs 1), so Y wins.
    const x = packet([1, 2, 3], [1, 2, 4], [4, 2, 1]);
    const y = packet([4, 5, 6], [1, 1, 5], [5, 1, 1]);
    expect(compareOverallTiePackets('X', 'Y', x, y)).toBeGreaterThan(0); // Y first
    expect(compareOverallTiePackets('Y', 'X', y, x)).toBeLessThan(0);
  });

  it('falls through to A8.2 (last race backward) when A8.1 ties', () => {
    // Same kept multiset [1,2,4] so A8.1 ties; A8.2 compares last race first.
    // X a82 [4,2,1] vs Y a82 [1,2,4]: Y scored 1 in the last race vs X's 4, Y wins.
    const x = packet([1, 2, 3], [1, 2, 4], [4, 2, 1]);
    const y = packet([4, 5, 6], [1, 2, 4], [1, 2, 4]);
    expect(compareOverallTiePackets('X', 'Y', x, y)).toBeGreaterThan(0); // Y first
  });

  it('stays tied (returns 0) when A8.1 and A8.2 both tie — no boat-id fallback', () => {
    // Everything equal -> the boats remain tied (SHRS 5.7(ii)(4)); the order is
    // NOT invented from the internal boat_id.
    const b2 = packet([1, 2, 3], [1, 2, 3], [3, 2, 1]);
    const a1 = packet([4, 5, 6], [1, 2, 3], [3, 2, 1]);
    expect(compareOverallTiePackets('B2', 'A1', b2, a1)).toBe(0);
    expect(compareOverallTiePackets('A1', 'B2', a1, b2)).toBe(0);
  });
});

describe('compareOverallTiePackets — shared heat (SHRS 5.7.2.2, excluded scores used)', () => {
  const row = (
    race_id: number,
    race_number: number,
    points: number,
    heat_type: 'Qualifying' | 'Final' = 'Qualifying',
  ): OverallRaceScore => ({
    race_id,
    race_number,
    points,
    status: 'FINISHED',
    heat_type,
    heat_name: heat_type === 'Final' ? 'Final Gold' : 'Heat A1',
  });

  it('compares only the shared races, A8.2 taking the later race first', () => {
    // Both sailed races 1 and 2 in the same heat. A8.1 on the shared points
    // ties ([1,5] vs [1,5]); A8.2 uses the later race (race_number 2), where Y
    // scored 1 to X's 5, so Y wins.
    const xById = new Map([
      [1, row(1, 1, 5)],
      [2, row(2, 2, 5)],
    ]);
    const yById = new Map([
      [1, row(1, 1, 1)],
      [2, row(2, 2, 1)],
    ]);
    const x = packet([1, 2], [5, 5], [5, 5], xById);
    const y = packet([1, 2], [1, 1], [1, 1], yById);
    expect(compareOverallTiePackets('X', 'Y', x, y)).toBeGreaterThan(0); // Y first
  });

  it('resolves the A8.1 shared-race comparison directly when raw shared points differ (SHRS 5.7(ii)(2))', () => {
    // Both share races 1 and 2. Sorted-ascending shared points already differ
    // at the first position ([2,3] vs [1,4]), so A8.1 alone must decide —
    // A8.2 is never reached. Excluded-status is irrelevant here: this
    // primitive always uses the raw shared points regardless of status.
    const xById = new Map([
      [1, row(1, 1, 3)],
      [2, row(2, 2, 2)],
    ]);
    const yById = new Map([
      [1, row(1, 1, 4)],
      [2, row(2, 2, 1)],
    ]);
    const x = packet([1, 2], [], [], xById);
    const y = packet([1, 2], [], [], yById);
    // X sorted shared = [2,3], Y sorted shared = [1,4]: first diff 2 vs 1 -> Y wins.
    expect(compareOverallTiePackets('X', 'Y', x, y)).toBeGreaterThan(0); // Y first
    expect(compareOverallTiePackets('Y', 'X', y, x)).toBeLessThan(0);
  });

  it('M7: ranks a shared Final race ahead of a shared Qualifying race in A8.2, regardless of race_number magnitude', () => {
    // Final-series races restart numbering at 1, so a Qualifying race_number
    // 4 is NOT later than a Final race_number 1 — the Final race is always
    // the event's actual last race. A8.1 ties on the shared points ([1,5] vs
    // [1,5] for both boats); A8.2 must therefore be decided by the FINAL
    // race, not by the higher-numbered Qualifying race.
    const xById = new Map([
      [1, row(1, 4, 5, 'Qualifying')], // higher race_number, but NOT last
      [11, row(11, 1, 1, 'Final')], // lower race_number, but IS last
    ]);
    const yById = new Map([
      [1, row(1, 4, 1, 'Qualifying')],
      [11, row(11, 1, 5, 'Final')],
    ]);
    const x = packet([1, 11], [], [], xById);
    const y = packet([1, 11], [], [], yById);
    // If the Final race is (correctly) compared first: X=1 vs Y=5 -> X wins.
    // If a naive race_number-only sort were used, the Qualifying race would
    // be compared first instead (X=5 vs Y=1 -> Y would incorrectly win).
    expect(compareOverallTiePackets('X', 'Y', x, y)).toBeLessThan(0); // X first
    expect(compareOverallTiePackets('Y', 'X', y, x)).toBeGreaterThan(0);
  });
});

describe('compareOverallTiePackets — M8: unresolved tie must stay tied, not be ordered by boat_id', () => {
  // Regression guard (fixed in 7ec1616). SHRS 5.7(ii)(4) / RRS A8.1+A8.2: when
  // neither rule can separate two boats they remain tied. `compareOverallTiePackets`
  // returns 0 rather than inventing a non-rule order from the internal DB boat_id,
  // for both the no-shared-heat and shared-heat branches below.
  it('no-shared-heat: returns 0 (tied) when A8.1 and A8.2 are both fully identical', () => {
    const b2 = packet([1, 2, 3], [1, 2, 3], [3, 2, 1]);
    const a1 = packet([4, 5, 6], [1, 2, 3], [3, 2, 1]);
    expect(compareOverallTiePackets('B2', 'A1', b2, a1)).toBe(0);
    expect(compareOverallTiePackets('A1', 'B2', a1, b2)).toBe(0);
  });

  it('shared-heat: returns 0 (tied) when shared-race A8.1 and A8.2 are both fully identical', () => {
    const row = (
      race_id: number,
      race_number: number,
      points: number,
    ): OverallRaceScore => ({
      race_id,
      race_number,
      points,
      status: 'FINISHED',
      heat_type: 'Qualifying',
      heat_name: 'Heat A1',
    });
    const zById = new Map([
      [1, row(1, 1, 3)],
      [2, row(2, 2, 1)],
    ]);
    const wById = new Map([
      [1, row(1, 1, 3)],
      [2, row(2, 2, 1)],
    ]);
    const z = packet([1, 2], [], [], zById);
    const w = packet([1, 2], [], [], wById);
    expect(compareOverallTiePackets('Z9', 'W1', z, w)).toBe(0);
  });
});

describe('resolveOverallTieGroupSequentially — SHRS 5.7(ii)(3), resolve higher-placed tie first', () => {
  it('resolves a 3-way tie by repeatedly extracting the current best boat', () => {
    // A beats B and C on a direct shared-race A8.1 comparison; once A is
    // extracted, B and C are re-compared on their own shared race. This
    // exercises the "resolve highest place before re-evaluating the rest"
    // requirement (SHRS 5.7(ii)(3)) rather than a single one-shot sort.
    const row = (
      race_id: number,
      race_number: number,
      points: number,
    ): OverallRaceScore => ({
      race_id,
      race_number,
      points,
      status: 'FINISHED',
      heat_type: 'Qualifying',
      heat_name: 'Heat A1',
    });

    const packets: Record<string, OverallTiePacket> = {
      A: packet(
        [1, 2],
        [],
        [],
        new Map([
          [1, row(1, 1, 1)],
          [2, row(2, 2, 1)],
        ]),
      ),
      B: packet(
        [1, 2],
        [],
        [],
        new Map([
          [1, row(1, 1, 2)],
          [2, row(2, 2, 3)],
        ]),
      ),
      C: packet(
        [1, 2],
        [],
        [],
        new Map([
          [1, row(1, 1, 3)],
          [2, row(2, 2, 2)],
        ]),
      ),
    };

    const rows = [{ boat_id: 'C' }, { boat_id: 'A' }, { boat_id: 'B' }];
    const resolved = resolveOverallTieGroupSequentially(
      rows,
      (boatId) => packets[boatId],
    );
    // A's shared points [1,1] beat both B [2,3] and C [3,2] at A8.1 position 1.
    // Between B and C: sorted shared [2,3] vs [2,3] ties at A8.1, so A8.2
    // (last race backward, race 2) decides: B=3 vs C=2 -> C wins.
    expect(resolved.map((r) => r.boat_id)).toEqual(['A', 'C', 'B']);
  });
});
