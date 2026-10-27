/**
 * The overall standings core (src/shared/scoring/overall.ts) on plain data:
 * SHRS 5.5 fleet order and Q + F totals, SHRS 5.7(ii) tie-break across both
 * series, shared ranks.
 */
import {
  OverallRaceScore,
  OverallTiePacket,
  compareOverallTiePackets,
  overallTiePacketFromScores,
  rankOverallStandings,
} from '../shared/scoring/overall';
import { normalizeDiscardConfig } from '../shared/discardProfile';

const NEVER = normalizeDiscardConfig({ thresholds: [] });
const STANDARD = normalizeDiscardConfig('standard');

const score = (
  race_id: number,
  heat_type: 'Qualifying' | 'Final',
  race_number: number,
  points: number,
  heat_name = heat_type === 'Final' ? 'Final Gold' : 'Heat A1',
): OverallRaceScore => ({
  race_id,
  race_number,
  points,
  status: 'FINISHED',
  heat_type,
  heat_name,
});

const packet = (scores: OverallRaceScore[], discard = NEVER) =>
  overallTiePacketFromScores(scores, {
    qualifyingDiscardConfig: discard,
    finalDiscardConfig: discard,
    qualifyingRaceCount: scores.filter((s) => s.heat_type === 'Qualifying')
      .length,
    finalFleetRaceCount: scores.filter((s) => s.heat_type === 'Final').length,
  });

describe('overallTiePacketFromScores', () => {
  it('lists final races before qualifying races for RRS A8.2', () => {
    const p = packet([
      score(1, 'Qualifying', 1, 4),
      score(2, 'Qualifying', 2, 5),
      score(3, 'Final', 1, 1),
      score(4, 'Final', 2, 2),
    ]);
    expect(p.a82AllScores).toEqual([2, 1, 5, 4]);
    expect(p.a81KeptScores).toEqual([1, 2, 4, 5]);
  });

  it('leaves the excluded scores of each series out of the A8.1 list', () => {
    const qualifying = [1, 2, 3, 4].map((n) => score(n, 'Qualifying', n, n));
    const final = [1, 2, 3, 4].map((n) => score(10 + n, 'Final', n, n * 2));
    // Standard SHRS 5.4: 4 races, 1 excluded in each series.
    expect(packet([...qualifying, ...final], STANDARD).a81KeptScores).toEqual([
      1, 2, 2, 3, 4, 6,
    ]);
  });
});

describe('compareOverallTiePackets', () => {
  it('boats that never met: A8.2 starts from the last FINAL race', () => {
    // Same scores, so A8.1 is level. Different final fleets, no shared race.
    // In the last race sailed (the final) X scored better.
    const x = packet([score(1, 'Qualifying', 1, 3), score(3, 'Final', 1, 1)]);
    const y = packet([score(2, 'Qualifying', 1, 1), score(4, 'Final', 1, 3)]);
    expect(compareOverallTiePackets(x, y)).toBeLessThan(0);
    expect(compareOverallTiePackets(y, x)).toBeGreaterThan(0);
  });

  it('boats that met are compared on shared races only, excluded ones too', () => {
    const shared = (a: number, b: number) => [
      score(1, 'Final', 1, a),
      score(2, 'Final', 2, b),
    ];
    // X has a 1 in the shared races, Y does not; X's other score is worse.
    const x = packet([score(9, 'Qualifying', 1, 9), ...shared(1, 4)]);
    const y = packet([score(8, 'Qualifying', 1, 1), ...shared(2, 3)]);
    expect(compareOverallTiePackets(x, y)).toBeLessThan(0);
  });

  it('a tie no rule can break stays a tie', () => {
    const x = packet([score(1, 'Final', 1, 2)]);
    const y = packet([score(2, 'Final', 1, 2)]);
    expect(compareOverallTiePackets(x, y)).toBe(0);
  });
});

describe('rankOverallStandings', () => {
  const packets = new Map<string, OverallTiePacket>();
  const getPacket = (id: string) => packets.get(id) as OverallTiePacket;
  const row = (boat_id: string, placement_group: string, points: number) => ({
    boat_id,
    placement_group,
    overall_points: points,
  });

  beforeEach(() => {
    packets.clear();
    // Every boat sailed the same single final race with the same score.
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id) =>
      packets.set(id, packet([score(1, 'Final', 1, 3)])),
    );
  });

  it('ranks every Gold boat before every Silver boat (SHRS 5.5), Fleet 5 last', () => {
    const ranked = rankOverallStandings(
      [
        row('a', 'Fleet 5', 1),
        row('b', 'Silver', 2),
        row('c', 'Gold', 30),
        row('d', 'Copper', 3),
        row('e', 'Gold', 20),
        row('f', 'Bronze', 4),
      ],
      getPacket,
    );
    expect(ranked.map((r) => [r.boat_id, r.overall_rank])).toEqual([
      ['e', 1],
      ['c', 2],
      ['b', 3],
      ['f', 4],
      ['d', 5],
      ['a', 6],
    ]);
  });

  it('boats the tie-break cannot separate share a rank: 1, 2, 2, 4', () => {
    const ranked = rankOverallStandings(
      [
        row('a', 'Gold', 5),
        row('b', 'Gold', 7),
        row('c', 'Gold', 7),
        row('d', 'Gold', 9),
      ],
      getPacket,
    );
    expect(ranked.map((r) => r.overall_rank)).toEqual([1, 2, 2, 4]);
  });

  it('breaks a points tie with SHRS 5.7(ii) and does not share the rank', () => {
    packets.set('b', packet([score(1, 'Final', 1, 4)]));
    packets.set('c', packet([score(1, 'Final', 1, 2)]));
    const ranked = rankOverallStandings(
      [row('b', 'Gold', 7), row('c', 'Gold', 7)],
      getPacket,
    );
    expect(ranked.map((r) => [r.boat_id, r.overall_rank])).toEqual([
      ['c', 1],
      ['b', 2],
    ]);
  });

  it('equal points in different fleets are not a tie', () => {
    const ranked = rankOverallStandings(
      [row('a', 'Silver', 7), row('b', 'Gold', 7)],
      getPacket,
    );
    expect(ranked.map((r) => [r.boat_id, r.overall_rank])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
  });
});
