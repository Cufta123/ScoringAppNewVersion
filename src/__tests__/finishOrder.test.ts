import {
  buildPlaceNumbers,
  buildScoredRace,
  pruneTies,
  reorderBoats,
  tieKey,
} from '../renderer/utils/finishOrder';

/**
 * The finish-order rules behind the scoring-entry screen. These were only
 * reachable by rendering ScoringInputComponent and driving the DOM; the cases
 * below pin the RRS A7 tie handling and SHRS 5.3 penalty ordering directly.
 */
describe('buildPlaceNumbers (RRS A7)', () => {
  it('numbers an untied order 1..n', () => {
    expect(buildPlaceNumbers(['10', '20', '30'])).toEqual({
      10: 1,
      20: 2,
      30: 3,
    });
  });

  it('gives a tied boat the place of the boat above it', () => {
    // 10 and 20 dead-heat for 1st, so they share place 1 and the next boat is
    // 3rd — place 2 is consumed by the tie.
    const ties = new Set([tieKey('20', '10')]);
    expect(buildPlaceNumbers(['10', '20', '30'], ties)).toEqual({
      10: 1,
      20: 1,
      30: 3,
    });
  });

  it('carries a three-way tie through to the following boat', () => {
    const ties = new Set([tieKey('20', '10'), tieKey('30', '20')]);
    expect(buildPlaceNumbers(['10', '20', '30', '40'], ties)).toEqual({
      10: 1,
      20: 1,
      30: 1,
      40: 4,
    });
  });

  it('ignores a tie between boats that are not adjacent', () => {
    // The key encodes adjacency, so a 30::10 tie never applies while 20 sits
    // between them.
    const ties = new Set([tieKey('30', '10')]);
    expect(buildPlaceNumbers(['10', '20', '30'], ties)).toEqual({
      10: 1,
      20: 2,
      30: 3,
    });
  });
});

describe('pruneTies', () => {
  const ties = () => new Set([tieKey('20', '10')]);

  it('keeps a tie whose boats are still adjacent and unpenalised', () => {
    expect(pruneTies(['10', '20', '30'], {}, ties())).toEqual(ties());
  });

  it('drops a tie when one boat leaves the finish order', () => {
    expect(pruneTies(['10', '30'], {}, ties()).size).toBe(0);
  });

  it('drops a tie once the boats are no longer adjacent', () => {
    // A reorder put 30 between them; the tie must not silently reactivate if
    // adjacency is restored later.
    expect(pruneTies(['10', '30', '20'], {}, ties()).size).toBe(0);
  });

  it('drops a tie when a boat takes a displacing penalty', () => {
    // SHRS 5.3 sends a DNF to the end, so it is no longer tied at the line.
    expect(pruneTies(['10', '20'], { 20: 'DNF' }, ties()).size).toBe(0);
  });

  it('keeps a tie when the penalty keeps the boat in place', () => {
    // ZFP holds its finishing place (RRS 44.3(c)), so the tie survives.
    expect(pruneTies(['10', '20'], { 20: 'ZFP' }, ties())).toEqual(ties());
  });
});

describe('reorderBoats', () => {
  it('moves a boat and renumbers the places', () => {
    const result = reorderBoats(['10', '20', '30'], {}, new Set(), 2, 0);
    expect(result?.boats).toEqual(['30', '10', '20']);
    expect(result?.places).toEqual({ 30: 1, 10: 2, 20: 3 });
  });

  it('drops a tie the move separated', () => {
    const result = reorderBoats(
      ['10', '20', '30'],
      {},
      new Set([tieKey('20', '10')]),
      2,
      1,
    );
    expect(result?.boats).toEqual(['10', '30', '20']);
    expect(result?.ties.size).toBe(0);
  });

  it('returns null for a no-op or out-of-range move', () => {
    expect(reorderBoats(['10', '20'], {}, new Set(), 1, 1)).toBeNull();
    expect(reorderBoats(['10', '20'], {}, new Set(), 0, -1)).toBeNull();
  });
});

describe('buildScoredRace', () => {
  it('scores plain finishers by their place', () => {
    const { boatPlaces, missingBoats } = buildScoredRace({
      boatNumbers: ['10', '20'],
      penalties: {},
      placeNumbers: { 10: 1, 20: 2 },
      validBoats: ['10', '20'],
    });
    expect(missingBoats).toEqual([]);
    expect(boatPlaces).toEqual([
      { boatNumber: '10', place: 1, status: 'FINISHED' },
      { boatNumber: '20', place: 2, status: 'FINISHED' },
    ]);
  });

  it('submits tied boats on the same place', () => {
    const { boatPlaces } = buildScoredRace({
      boatNumbers: ['10', '20', '30'],
      penalties: {},
      placeNumbers: { 10: 1, 20: 1, 30: 3 },
      validBoats: ['10', '20', '30'],
    });
    expect(boatPlaces.map((b) => b.place)).toEqual([1, 1, 3]);
  });

  it('keeps a position-keeping penalty on its finishing place', () => {
    // RRS 44.3(c): ZFP scores from its place, so it holds place 2 rather than
    // being sent to the end.
    const { boatPlaces } = buildScoredRace({
      boatNumbers: ['10', '20'],
      penalties: { 20: 'ZFP' },
      placeNumbers: { 10: 1, 20: 2 },
      validBoats: ['10', '20'],
    });
    expect(boatPlaces).toContainEqual({
      boatNumber: '20',
      place: 2,
      status: 'ZFP',
    });
  });

  it('numbers displacing penalties consecutively after the finishers', () => {
    const { boatPlaces } = buildScoredRace({
      boatNumbers: ['10', '20', '30'],
      penalties: { 20: 'DNF', 30: 'DNS' },
      placeNumbers: { 10: 1, 20: 2, 30: 3 },
      validBoats: ['10', '20', '30'],
    });
    const byBoat = Object.fromEntries(
      boatPlaces.map((b) => [b.boatNumber, b.place]),
    );
    // One finisher, then the penalised boats take slots 2 and 3.
    expect(byBoat['10']).toBe(1);
    expect(byBoat['20']).toBe(2);
    expect(byBoat['30']).toBe(3);
  });

  it('reports boats with neither a place nor a penalty', () => {
    const { missingBoats } = buildScoredRace({
      boatNumbers: ['10'],
      penalties: {},
      placeNumbers: { 10: 1 },
      validBoats: ['10', '20', '30'],
    });
    expect(missingBoats).toEqual(['20', '30']);
  });

  it('still submits a penalised boat that never entered the finish order', () => {
    const { boatPlaces, missingBoats } = buildScoredRace({
      boatNumbers: ['10'],
      penalties: { 20: 'DNC' },
      placeNumbers: { 10: 1 },
      validBoats: ['10', '20'],
    });
    expect(missingBoats).toEqual([]);
    expect(boatPlaces).toContainEqual({
      boatNumber: '20',
      place: 2,
      status: 'DNC',
    });
  });
});
