/**
 * Ported from the app's src/__tests__/leaderboardRecompute.test.ts: only its
 * rule scenarios (SHRS 5.2 points re-derived from the current largest heat,
 * SHRS 1.5 before the Final Series). The SQL, transaction and table glue it
 * tested has no counterpart: the library stores no derived value.
 */
import {
  finalStandings,
  overallStandings,
  qualifyingStandings,
  type Decision,
} from '../../src';
import { boats, enter, protest, sheet, stateOf } from './helpers';

const scoreOf = (log: Decision[], boat: string) =>
  qualifyingStandings(stateOf(log)).standings.find((s) => s.boat === boat)!
    .scores[0];

describe('SHRS 5.2: no place = the largest heat + 1', () => {
  it('every no-place code scores the largest heat + 1 (12 boats: 13)', () => {
    const codes = [
      'DNF',
      'DSQ',
      'RET',
      'OCS',
      'BFD',
      'UFD',
      'DNC',
      'NSC',
      'WTH',
      'DNE',
      'DGM',
    ];
    const log: Decision[] = [
      ...boats(12),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'b1', ...codes.map((code, i) => `b${i + 2}:${code}`)),
    ];
    const { standings } = qualifyingStandings(stateOf(log));
    expect(
      standings
        .filter((s) => s.boat !== 'b1')
        .map((s) => [s.scores[0].code, s.scores[0].points]),
    ).toEqual(expect.arrayContaining(codes.map((code) => [code, 13])));
    expect(standings).toHaveLength(12);
  });

  describe('an earlier race follows a heat that grows later (late entries)', () => {
    // A1 = b1, b4; B1 = b2, b3. Largest heat 2: DNF 3, ZFP 1 + 0.6.
    const round1: Decision[] = [
      ...boats(4),
      { type: 'heatsCreated', heatCount: 2 },
      sheet('A1', 1, 'b1', 'b4:DNF'),
      sheet('B1', 1, 'b2:ZFP', 'b3'),
      protest('B1', 1, 'b3', { kind: 'RDG3', points: 1.5 }),
    ];
    // Round 2: A2 = b1, b3; two late entries join A2, so 4 boats.
    const grown: Decision[] = [
      ...round1,
      { type: 'roundCreated' },
      enter('b5', 'CRO', '5'),
      enter('b6', 'CRO', '6'),
      { type: 'boatAssigned', boat: 'b5', heat: 'A2' },
      { type: 'boatAssigned', boat: 'b6', heat: 'A2' },
    ];

    it('the same DNF scores 3, then 5 once the largest heat is 4', () => {
      expect(scoreOf(round1, 'b4')).toMatchObject({ code: 'DNF', points: 3 });
      expect(scoreOf(grown, 'b4')).toMatchObject({ code: 'DNF', points: 5 });
    });

    it('RRS 44.3(c): the ZFP follows too (1 + 20% of 5 = 2)', () => {
      expect(scoreOf(round1, 'b2')).toMatchObject({ code: 'ZFP', points: 1.6 });
      expect(scoreOf(grown, 'b2')).toMatchObject({ code: 'ZFP', points: 2 });
    });

    it('a finish and RDG3 points stay as they were', () => {
      expect(scoreOf(grown, 'b1').points).toBe(1);
      expect(scoreOf(grown, 'b3')).toMatchObject({ code: 'RDG3', points: 1.5 });
    });
  });
});

describe('SHRS 1.5: before the Final Series starts', () => {
  it('there are no final standings, and the overall is the qualifying ranking', () => {
    const state = stateOf([
      ...boats(4),
      { type: 'heatsCreated', heatCount: 2 },
      sheet('A1', 1, 'b1', 'b4'),
      sheet('B1', 1, 'b2', 'b3'),
    ]);
    expect(finalStandings(state)).toEqual([]);
    const q = qualifyingStandings(state).standings;
    expect(overallStandings(state)).toEqual(
      q.map((s) => ({
        boat: s.boat,
        place: s.place,
        qualifying: s.total,
        final: 0,
        total: s.total,
      })),
    );
  });
});
