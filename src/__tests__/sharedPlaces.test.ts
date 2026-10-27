import { assignPlaces, findUnbrokenTies } from '../shared/scoring/ranking';

// RRS A8 breaks a series tie only where the boats' scores differ. Boats whose
// scores never differ remain tied and share the place (1, 2, 2, 4).
describe('shared places for unbreakable ties', () => {
  const compareByScores = (
    a: { boat_id: string; scores: number[] },
    b: { boat_id: string; scores: number[] },
  ) => {
    for (let i = 0; i < a.scores.length; i += 1) {
      if (a.scores[i] !== b.scores[i]) return a.scores[i] - b.scores[i];
    }
    return 0;
  };

  it('finds only boats still level with the boat above', () => {
    const order = [
      { boat_id: 'a', scores: [1, 2] },
      { boat_id: 'b', scores: [1, 3] },
      { boat_id: 'c', scores: [1, 3] },
      { boat_id: 'd', scores: [2, 2] },
    ];
    expect([...findUnbrokenTies(order, compareByScores)]).toEqual(['c']);
  });

  it('numbers 1, 2, 2, 4 — the next boat skips the shared place', () => {
    const table = [
      { boat_id: 'a', totalPoints: 3 },
      { boat_id: 'b', totalPoints: 4 },
      { boat_id: 'c', totalPoints: 4 },
      { boat_id: 'd', totalPoints: 5 },
    ];
    assignPlaces(table, new Set(['c']));
    expect(table.map((row: any) => row.place)).toEqual([1, 2, 2, 4]);
  });

  it('never shares a place across different totals', () => {
    const table = [
      { boat_id: 'a', totalPoints: 3 },
      { boat_id: 'b', totalPoints: 4 },
    ];
    // Even if mistakenly flagged, a different total is a different place.
    assignPlaces(table, new Set(['b']));
    expect(table.map((row: any) => row.place)).toEqual([1, 2]);
  });
});
