import computeTiePlacements from '../shared/raceTieScoring';

/**
 * RRS A7 place walk, shared by the main process (applyRaceTieScoring) and the
 * renderer's edit preview (rerankRaceColumn). These cases pin the behaviour
 * both sides now depend on.
 */
describe('computeTiePlacements (RRS A7)', () => {
  const finished = (position: number) => ({ position, status: 'FINISHED' });

  it('leaves an already-contiguous finishing order untouched', () => {
    const rows = [finished(1), finished(2), finished(3)];
    expect(computeTiePlacements(rows)).toEqual([
      { index: 0, position: 1, points: 1 },
      { index: 1, position: 2, points: 2 },
      { index: 2, position: 3, points: 3 },
    ]);
  });

  it('shares averaged points between two boats on the same place', () => {
    // Two boats tied for 2nd take places 2 and 3 => (2+3)/2 = 2.5 each.
    const rows = [finished(1), finished(2), finished(2), finished(4)];
    expect(computeTiePlacements(rows)).toEqual([
      { index: 0, position: 1, points: 1 },
      { index: 1, position: 2, points: 2.5 },
      { index: 2, position: 2, points: 2.5 },
      { index: 3, position: 4, points: 4 },
    ]);
  });

  it('averages a three-way tie across the three places it occupies', () => {
    // Places 1, 2, 3 => (1+3)/2 = 2 each.
    const rows = [finished(1), finished(1), finished(1)];
    expect(computeTiePlacements(rows)).toEqual([
      { index: 0, position: 1, points: 2 },
      { index: 1, position: 1, points: 2 },
      { index: 2, position: 1, points: 2 },
    ]);
  });

  it('compacts a gap left by a removed boat', () => {
    // 1, 3, 4 => the boats behind close up to 2 and 3.
    const rows = [finished(1), finished(3), finished(4)];
    expect(computeTiePlacements(rows)).toEqual([
      { index: 0, position: 1, points: 1 },
      { index: 1, position: 2, points: 2 },
      { index: 2, position: 3, points: 3 },
    ]);
  });

  it('lets a position-keeping penalty consume a place without re-scoring it', () => {
    // RRS 44.3(c): ZFP holds 2nd, so the boat behind is 3rd, not 2nd. The ZFP
    // boat itself is not returned — its points are a percentage of the DNF
    // score and are set by the caller, not by the place walk.
    const rows = [finished(1), { position: 2, status: 'ZFP' }, finished(3)];
    expect(computeTiePlacements(rows)).toEqual([
      { index: 0, position: 1, points: 1 },
      { index: 2, position: 3, points: 3 },
    ]);
  });

  it('ignores boats that hold no finishing place', () => {
    // DNF/DNS/DSQ are scored at largest-heat + 1 (SHRS 5.2) and take no slot,
    // so the finishers around them still rank 1 and 2.
    const rows = [
      finished(1),
      { position: 21, status: 'DNF' },
      finished(5),
      { position: 21, status: 'DSQ' },
    ];
    expect(computeTiePlacements(rows)).toEqual([
      { index: 0, position: 1, points: 1 },
      { index: 2, position: 2, points: 2 },
    ]);
  });

  it('breaks ties on input order, so the caller controls the sequence', () => {
    // Both callers pass a stable order (score_id in main, row order in the
    // renderer); the earlier row takes the earlier slot.
    const rows = [finished(2), finished(1), finished(2)];
    const placements = computeTiePlacements(rows);
    expect(placements).toEqual([
      { index: 1, position: 1, points: 1 },
      { index: 0, position: 2, points: 2.5 },
      { index: 2, position: 2, points: 2.5 },
    ]);
  });

  it('returns nothing for an empty race', () => {
    expect(computeTiePlacements([])).toEqual([]);
  });
});
