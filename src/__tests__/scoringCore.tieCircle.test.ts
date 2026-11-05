import { rankQualifyingSeries } from '../shared/scoring/series';
import { resolveTiesSequentially } from '../shared/scoring/ranking';

/**
 * SHRS 5.7(ii) compares each pair of tied boats on the races they sailed
 * together, so it is not transitive. The order used to come from sorting
 * with that comparator, which follows the input (database) order and could
 * put a boat above one that beat her head-to-head. Both cases below were
 * found by regattaCore.differential.integration.test.ts.
 */

const NO_DISCARDS = {
  firstDiscardAt: 99,
  secondDiscardAt: 100,
  additionalEvery: 8,
};
const race = (race_id: number, round: number, points: number) => ({
  race_id,
  race_number: 1,
  round,
  points,
  status: 'FINISHED',
});
// Two heats, two rounds: A1 = 1, B1 = 2, A2 = 3, B2 = 4.

describe('SHRS 5.7 ties that are not transitive', () => {
  it('a boat is never ranked above one that beat her, in any input order', () => {
    // On 10 points: 5 beats everyone; 13 and 3 cannot be split; both beat 4;
    // 8 beats 3 but loses to 13 and 4 (8 > 3 > 4 > 8 is a circle).
    const boats = [
      { boat_id: '5', scores: [race(2, 1, 2), race(3, 2, 8)] },
      { boat_id: '13', scores: [race(1, 1, 6), race(4, 2, 4)] },
      { boat_id: '3', scores: [race(2, 1, 6), race(3, 2, 4)] },
      { boat_id: '4', scores: [race(2, 1, 4), race(3, 2, 6)] },
      { boat_id: '8', scores: [race(2, 1, 5), race(4, 2, 5)] },
    ];
    const orders = [
      [0, 1, 2, 3, 4],
      [4, 3, 2, 1, 0],
      [0, 4, 2, 3, 1],
    ];
    orders.forEach((order) => {
      const ranked = rankQualifyingSeries(
        order.map((i) => boats[i]),
        { discardConfig: NO_DISCARDS },
      );
      const placeOf = (id: string) =>
        ranked.find((r) => r.boat_id === id)!.place;
      expect(placeOf('5')).toBe(1);
      // 13 beat 8 on B2: 13 must stay above her.
      expect(placeOf('13')).toBeLessThan(placeOf('8'));
    });
  });

  it('gives the place to the boat no tied boat beats', () => {
    // 6 beats 3, 3 beats 5, 6 and 5 level: 6, 3, 5 whatever the input.
    const wins: Record<string, string[]> = { '6': ['3'], '3': ['5'] };
    const compare = (a: string, b: string) => {
      if (wins[a]?.includes(b)) return -1;
      if (wins[b]?.includes(a)) return 1;
      return 0;
    };
    expect(resolveTiesSequentially(['3', '5', '6'], compare)).toEqual([
      '6',
      '3',
      '5',
    ]);
    expect(resolveTiesSequentially(['5', '3', '6'], compare)).toEqual([
      '6',
      '3',
      '5',
    ]);
  });

  it('settles a true circle by the fallback', () => {
    const beats: Record<string, string> = { a: 'b', b: 'c', c: 'a' };
    const compare = (x: string, y: string) => {
      if (beats[x] === y) return -1;
      if (beats[y] === x) return 1;
      return 0;
    };
    const fallback = (x: string, y: string) => (x < y ? 1 : -1); // prefers c
    expect(resolveTiesSequentially(['a', 'b', 'c'], compare, fallback)).toEqual(
      ['c', 'a', 'b'],
    );
  });
});
