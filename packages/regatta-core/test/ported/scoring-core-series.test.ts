/**
 * Ported from the app's src/__tests__/scoringCore.series.test.ts (the old
 * src/shared/scoring/series.ts). Scenarios the library suite already covers
 * are not repeated: discards keeping DNE / one score kept / exact tenths
 * (rules.test.ts), ranking by total (event.test.ts "one fleet"), shared
 * places 1, 2, 2, 4 (rules.test.ts, decided-rules.test.ts R6), single- vs
 * multi-heat (decided-rules.test.ts R8, explain.test.ts).
 */
import {
  explainScore,
  explainTie,
  finalStandings,
  qualifyingStandings,
  qualifyingTieBreak,
  type Decision,
} from '../../src';
import { boats, enter, sheet, stateOf } from './helpers';

const placeOf = (
  standings: Array<{ boat: string; place: number; total: number }>,
  boat: string,
) => standings.find((s) => s.boat === boat)!;

describe('qualifying series', () => {
  it('SHRS 5.7(i): single-heat event, A8.1 on kept scores, then A8.2 last race first', () => {
    // One heat of 4 (DNF = 5). b1: 1, 2.5, 5, 3; b2: 3, 2.5, 5, 1. One
    // discard (the 5) each: 6.5 apiece, kept 1, 2.5, 3 both (A8.1 level).
    // A8.2, last race first: b2 1 against b1 3.
    const state = stateOf([
      ...boats(4),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'b1', 'b3', 'b2', 'b4'),
      sheet('A1', 2, 'b3', 'b1', '=b2', 'b4'),
      sheet('A1', 3, 'b3', 'b4', 'b1:DNF', 'b2:DNF'),
      sheet('A1', 4, 'b2', 'b3', 'b1', 'b4'),
    ]);
    const { standings } = qualifyingStandings(state);
    expect(standings.map((s) => [s.boat, s.total, s.place])).toEqual([
      ['b3', 4, 1],
      ['b2', 6.5, 2],
      ['b1', 6.5, 3],
      ['b4', 10, 4],
    ]);
    expect(explainTie(state, 'b1', 'b2').steps.map((s) => s.rule)).toEqual([
      'SHRS 5.7(i)',
      'RRS A8.1',
      'RRS A8.2',
    ]);
  });

  it('SHRS 5.7(ii)(1)-(2): multi-heat, shared races decide with excluded scores included', () => {
    // Pre-assigned heats: A = a, b, x, y, z; B = c, d, e (largest 5, DNF 6).
    // a: 6, 3, 2.5, 1; b: 4, 1, 2.5, 3. One discard each: 6.5 apiece, kept
    // 1, 2.5, 3 both. With the excluded scores (5.7(ii)(2)): b 1, 2.5, 3, 4
    // against a 1, 2.5, 3, 6, so b. Plain A8 would have gone to A8.2 (last
    // race: a 1 against b 3) and put a ahead.
    const log: Decision[] = [
      ...['a', 'b', 'x', 'y', 'z', 'c', 'd', 'e'].map((id, i) =>
        enter(id, 'CRO', String(i + 1)),
      ),
      { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
      {
        type: 'heatsCreated',
        heatCount: 2,
        heats: [
          ['a', 'b', 'x', 'y', 'z'],
          ['c', 'd', 'e'],
        ],
      },
    ];
    const races = [
      ['x', 'y', 'z', 'b', 'a:DNF'],
      ['b', 'x', 'a', 'y', 'z'],
      ['x', 'a', '=b', 'y', 'z'],
      ['a', 'x', 'b', 'y', 'z'],
    ];
    races.forEach((order, i) => {
      if (i > 0) log.push({ type: 'roundCreated' });
      log.push(sheet(`A${i + 1}`, 1, ...order));
      log.push(sheet(`B${i + 1}`, 1, 'c', 'd', 'e'));
    });
    const state = stateOf(log);
    const { standings } = qualifyingStandings(state);
    expect(placeOf(standings, 'a').total).toBe(6.5);
    expect(placeOf(standings, 'b').total).toBe(6.5);
    expect(placeOf(standings, 'b').place).toBeLessThan(
      placeOf(standings, 'a').place,
    );
    expect(qualifyingTieBreak(state)('b', 'a')).toBeLessThan(0);
    expect(explainTie(state, 'a', 'b').steps[0].rule).toBe(
      'SHRS 5.7(ii)(1)-(2), RRS A8.1',
    );
  });

  it("SHRS 5.4: discards follow the series' completed races, not the boat's own", () => {
    // The old engine let a late boat keep only the races she sailed; here
    // she is DNC for the race she missed (RRS A5.1, R8), and the series'
    // 4 completed races give her one discard like everyone else.
    const state = stateOf([
      ...boats(3),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'b1', 'b2', 'b3'),
      enter('L', 'ITA', '1'),
      { type: 'boatAssigned', boat: 'L', heat: 'A1' },
      sheet('A1', 2, 'b1', 'L', 'b2', 'b3'),
      sheet('A1', 3, 'b1', 'L', 'b2', 'b3'),
      sheet('A1', 4, 'b1', 'b2', 'b3', 'L'),
    ]);
    const late = explainScore(state, 'L').qualifying!;
    expect(late.completedRaces).toBe(4);
    expect(late.discards.count).toBe(1);
    // DNC 5 (largest heat 4) excluded: 2 + 2 + 4.
    expect(late.races.map((r) => [r.code ?? r.points, r.excluded])).toEqual([
      ['DNC', true],
      [2, false],
      [2, false],
      [4, false],
    ]);
    expect(late.total).toBe(8);
    expect(placeOf(qualifyingStandings(state).standings, 'b1').total).toBe(3);
  });
});

describe('final series', () => {
  // A1 = b1, b4; B1 = b2, b3. Gold = b1, b2; Silver = b3, b4.
  const qualifying: Decision[] = [
    ...boats(4),
    { type: 'heatsCreated', heatCount: 2 },
    sheet('A1', 1, 'b1', 'b4'),
    sheet('B1', 1, 'b2', 'b3'),
    { type: 'finalSeriesStarted' },
  ];

  it('SHRS 5.1 / 5.4 / 4.5: each fleet scored on its own, discards by its own race count', () => {
    // Gold sails 4 races (1 discard), Silver 2 (none). DNF = 3 (fleets of 2).
    const state = stateOf([
      ...qualifying,
      sheet('Gold', 1, 'b1', 'b2'),
      sheet('Gold', 2, 'b1', 'b2'),
      sheet('Gold', 3, 'b1', 'b2'),
      sheet('Gold', 4, 'b2', 'b1:DNF'),
      sheet('Silver', 1, 'b3', 'b4'),
      sheet('Silver', 2, 'b4', 'b3:DNF'),
    ]);
    const [gold, silver] = finalStandings(state);
    expect(gold.races).toBe(4);
    // b1: 1, 1, 1, (3) = 3; b2: (2), 2, 2, 1 = 5.
    expect(gold.standings.map((s) => [s.boat, s.total, s.place])).toEqual([
      ['b1', 3, 1],
      ['b2', 5, 2],
    ]);
    expect(silver.races).toBe(2);
    // No discard yet: b4 2 + 1 = 3, b3 1 + 3 = 4.
    expect(silver.standings.map((s) => [s.boat, s.total, s.place])).toEqual([
      ['b4', 3, 1],
      ['b3', 4, 2],
    ]);
    expect(
      silver.standings.flatMap((s) => s.scores).some((s) => s.excluded),
    ).toBe(false);
  });

  it('SHRS 5.7(ii)(2): a fleet tie is broken on all scores, excluded ones included', () => {
    // b1: 3, 1, 2, 1 (3 out) = 4; b2: 1, 2, 1, 2 (the first 2 out) = 4.
    // All scores best first: b2 1, 1, 2, 2 against b1 1, 1, 2, 3, so b2.
    const state = stateOf([
      ...qualifying,
      sheet('Gold', 1, 'b2', 'b1:DNF'),
      sheet('Gold', 2, 'b1', 'b2'),
      sheet('Gold', 3, 'b2', 'b1'),
      sheet('Gold', 4, 'b1', 'b2'),
    ]);
    const gold = finalStandings(state)[0];
    expect(gold.standings.map((s) => [s.boat, s.total, s.place])).toEqual([
      ['b2', 4, 1],
      ['b1', 4, 2],
    ]);
    expect(explainTie(state, 'b1', 'b2', 'final')).toMatchObject({
      ahead: 'b2',
      steps: [{ rule: 'SHRS 5.7(ii)(2), RRS A8.1' }],
    });
  });
});
