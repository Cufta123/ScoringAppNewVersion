/**
 * The scoring core (src/shared/scoring/series.ts) on plain data: no database,
 * no mocks. Each case is a small, legal event written as races.
 */
import {
  isSingleHeatSeries,
  rankFinalSeries,
  rankQualifyingSeries,
  RaceScore,
  scoreBoatSeries,
} from '../shared/scoring/series';
import { applyExclusions } from '../renderer/utils/leaderboardUtils';
import {
  getExcludeCountForConfig,
  normalizeDiscardConfig,
} from '../shared/discardProfile';

const STANDARD = normalizeDiscardConfig('standard');

/** Races 1..n of one heat, in order. */
const races = (points: number[], firstRaceId = 1): RaceScore[] =>
  points.map((p, i) => ({
    race_id: firstRaceId + i,
    race_number: 1,
    points: p,
    status: 'FINISHED',
  }));

const placesOf = (table: Array<{ boat_id: string; place: number }>) =>
  Object.fromEntries(table.map((row) => [row.boat_id, row.place]));

describe('scoreBoatSeries', () => {
  it('discards the worst score, keeping DNE', () => {
    const scores = races([2, 9, 3, 1]);
    scores[1].status = 'DNE';
    // 4 races -> 1 discard; the 9 is a DNE so the 3 goes instead.
    expect(scoreBoatSeries(scores, 1)).toEqual({
      totalPoints: 12,
      keptPoints: [9, 2, 1],
    });
  });

  it('never discards every score of a boat with fewer races', () => {
    expect(scoreBoatSeries(races([5]), 2).totalPoints).toBe(5);
  });

  it('sums tenths without float noise', () => {
    expect(scoreBoatSeries(races([0.1, 0.2, 87.1 - 0.3]), 0).totalPoints).toBe(
      87.1,
    );
  });
});

describe('rankQualifyingSeries', () => {
  it('ranks by total, lowest first', () => {
    const table = rankQualifyingSeries(
      [
        { boat_id: 'a', scores: races([3, 3]) },
        { boat_id: 'b', scores: races([1, 2]) },
      ],
      { discardConfig: STANDARD },
    );
    expect(table).toEqual([
      { boat_id: 'b', totalPoints: 3, place: 1 },
      { boat_id: 'a', totalPoints: 6, place: 2 },
    ]);
  });

  it('single-heat event: A8.1 on kept scores, then A8.2 last race first', () => {
    // Same races for everyone. a and b: kept [1, 2, 3] after one discard,
    // so A8.1 cannot split them; in the last race b scored 1, a scored 3.
    const table = rankQualifyingSeries(
      [
        { boat_id: 'a', scores: races([1, 2, 9, 3]) },
        { boat_id: 'b', scores: races([3, 2, 9, 1]) },
      ],
      { discardConfig: STANDARD },
    );
    expect(placesOf(table)).toEqual({ b: 1, a: 2 });
  });

  it('multi-heat event: shared races decide, excluded scores included', () => {
    // a and b sailed races 1-4 together; c sailed elsewhere, so the event is
    // multi-heat. a and b keep [1, 2, 3]; a's discarded 9 is worse than b's 7.
    const table = rankQualifyingSeries(
      [
        { boat_id: 'a', scores: races([1, 2, 3, 9]) },
        { boat_id: 'b', scores: races([3, 2, 1, 7]) },
        { boat_id: 'c', scores: races([5, 5, 5, 5], 100) },
      ],
      { discardConfig: STANDARD },
    );
    expect(placesOf(table)).toEqual({ b: 1, a: 2, c: 3 });
  });

  it('boats that cannot be separated share the place', () => {
    const table = rankQualifyingSeries(
      [
        { boat_id: 'a', scores: races([1, 1]) },
        { boat_id: 'b', scores: races([2, 2]) },
        { boat_id: 'c', scores: races([2, 2]) },
        { boat_id: 'd', scores: races([3, 3]) },
      ],
      { discardConfig: STANDARD },
    );
    expect(table.map((row) => row.place)).toEqual([1, 2, 2, 4]);
  });

  it('uses the series race count for discards, not the boat’s own', () => {
    // 4 races in the series -> 1 discard for everyone, including the boat
    // that has only 3 scores.
    const table = rankQualifyingSeries(
      [
        { boat_id: 'full', scores: races([1, 1, 1, 9]) },
        { boat_id: 'late', scores: races([2, 2, 9], 50) },
      ],
      { discardConfig: STANDARD },
    );
    expect(table).toEqual([
      { boat_id: 'full', totalPoints: 3, place: 1 },
      { boat_id: 'late', totalPoints: 4, place: 2 },
    ]);
  });
});

describe('rankFinalSeries', () => {
  it('scores each fleet on its own, discards per fleet', () => {
    const ranked = rankFinalSeries(
      [
        { boat_id: 'g1', fleet: 'Gold', scores: races([1, 1, 1, 9]) },
        { boat_id: 'g2', fleet: 'Gold', scores: races([2, 2, 2, 2]) },
        { boat_id: 's1', fleet: 'Silver', scores: races([1, 9], 10) },
      ],
      { discardConfig: STANDARD },
    );
    expect(ranked.get('Gold')).toEqual([
      { boat_id: 'g1', totalPoints: 3, place: 1 },
      { boat_id: 'g2', totalPoints: 6, place: 2 },
    ]);
    // Two races in Silver -> no discard yet.
    expect(ranked.get('Silver')).toEqual([
      { boat_id: 's1', totalPoints: 10, place: 1 },
    ]);
  });

  it('breaks a tie on ALL scores, excluded ones included (SHRS 5.7(ii)(2))', () => {
    const ranked = rankFinalSeries(
      [
        { boat_id: 'a', fleet: 'Gold', scores: races([1, 2, 3, 9]) },
        { boat_id: 'b', fleet: 'Gold', scores: races([3, 2, 1, 7]) },
      ],
      { discardConfig: STANDARD },
    );
    expect(placesOf(ranked.get('Gold')!)).toEqual({ b: 1, a: 2 });
  });
});

describe('isSingleHeatSeries', () => {
  it('is single-heat only when every boat sailed the same races', () => {
    expect(
      isSingleHeatSeries([{ scores: races([1]) }, { scores: races([2]) }]),
    ).toBe(true);
    expect(
      isSingleHeatSeries([{ scores: races([1]) }, { scores: races([2], 9) }]),
    ).toBe(false);
  });
});

describe('the leaderboard screen and the stored scores agree', () => {
  /** mulberry32 */
  const rng = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it('gives the same total and discards for 2,000 random boats', () => {
    const random = rng(2026);
    for (let n = 0; n < 2000; n += 1) {
      const count = 1 + Math.floor(random() * 20);
      const seriesRaces = count + Math.floor(random() * 3);
      const scores = races(
        Array.from({ length: count }, () =>
          random() < 0.2
            ? Math.round(random() * 100) / 10
            : 1 + Math.floor(random() * 8),
        ),
      );
      scores.forEach((s) => {
        if (random() < 0.05) s.status = 'DNE';
      });

      const core = scoreBoatSeries(
        scores,
        getExcludeCountForConfig(seriesRaces, STANDARD),
      );
      const screen = applyExclusions(
        scores.map((s) => s.points),
        scores.map((s) => s.status ?? 'FINISHED'),
        scores.map((s) => s.points),
        'standard',
        seriesRaces,
      );
      expect(screen.total).toBe(core.totalPoints);
    }
  });
});
