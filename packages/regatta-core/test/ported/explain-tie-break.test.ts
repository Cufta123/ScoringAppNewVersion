/**
 * Ported from the app's src/__tests__/explainTieBreak.test.ts (the old
 * src/main/functions/explainTieBreak.ts, the leaderboard compare panel).
 * Covered already: "not tied when totals differ" (explain.test.ts "not tied
 * at all"); boats that never met in either series (explain.test.ts, and the
 * qualifying case below: two boats of one fleet have always met). Skipped
 * as plumbing: a boat whose final Heat_Boat row is missing (database
 * repair); the rule behind it, discards by each fleet's own race count, is
 * in scoring-core-series.test.ts.
 */
import {
  explainScore,
  explainTie,
  overallStandings,
  qualifyingStandings,
  type Decision,
} from '../../src';
import { enter, sheet, stateOf } from './helpers';

const entries = (...ids: string[]) =>
  ids.map((id, i) => enter(id, 'CRO', String(i + 1)));
const preAssigned = (heats: string[][]): Decision[] => [
  { type: 'settingsChanged', settings: { qualifyingMode: 'pre-assigned' } },
  { type: 'heatsCreated', heatCount: heats.length, heats },
];
/** Rounds of pre-assigned heats, each heat's finishing order per round. */
const rounds = (...orders: string[][][]): Decision[] =>
  orders.flatMap((round, r) => [
    ...(r > 0 ? [{ type: 'roundCreated' } as Decision] : []),
    ...round.map((order, h) => sheet(`${'AB'[h]}${r + 1}`, 1, ...order)),
  ]);

describe('qualifying series', () => {
  it("SHRS 5.4: a late entry's discards follow the series' 8 races, not her 5", () => {
    // One heat; a and b join after race 3 (DNC = 5, largest heat 4).
    const late: Decision[] = [
      ...entries('c', 'd'),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'c', 'd'),
      sheet('A1', 2, 'c', 'd'),
      sheet('A1', 3, 'c', 'd'),
      enter('a', 'ITA', '1'),
      enter('b', 'ITA', '2'),
      { type: 'boatAssigned', boat: 'a', heat: 'A1' },
      { type: 'boatAssigned', boat: 'b', heat: 'A1' },
      sheet('A1', 4, 'c', 'd', 'a', 'b'),
      sheet('A1', 5, 'c', 'd', 'a', 'b'),
      sheet('A1', 6, 'a', 'b', 'c', 'd'),
      sheet('A1', 7, 'a', 'b', 'c', 'd'),
      sheet('A1', 8, 'a', 'b', 'c', 'd'),
    ];
    const state = stateOf(late);
    const a = explainScore(state, 'a').qualifying!;
    expect(a.discards.count).toBe(2);
    // a: DNC 5, 5, 5, then 3, 3, 1, 1, 1; two of the DNCs go: 14.
    expect(a.races.map((r) => r.excluded)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(a.total).toBe(14);
    // b: 5, 5, 5, 4, 4, 2, 2, 2; two DNCs go: 19.
    expect(explainScore(state, 'b').qualifying!.total).toBe(19);
    expect(explainTie(state, 'a', 'b')).toMatchObject({
      ahead: 'a',
      steps: [{ rule: 'RRS A2.1' }],
    });
  });

  it('SHRS 5.7(i): a single-heat event (3+ boats, the same races) uses A8.1 without changes', () => {
    // a: 4, 1; b: 3, 2 (5 each). A8.1 best first: 1 against 2, a.
    const state = stateOf([
      ...entries('a', 'b', 'c', 'd'),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'c', 'd', 'b', 'a'),
      sheet('A1', 2, 'a', 'b', 'c', 'd'),
    ]);
    expect(explainTie(state, 'a', 'b')).toMatchObject({
      ahead: 'a',
      steps: [{ rule: 'SHRS 5.7(i)' }, { rule: 'RRS A8.1' }],
    });
  });

  it('SHRS 5.7(ii)(2): boats that sailed every race together are compared with excluded scores', () => {
    // A = a, b, x, y, z; B = c, d, e (DNF 6). a: 6, 3, 2.5, 1; b: 4, 1,
    // 2.5, 3; 6.5 each, kept scores level. With the excluded 6 and 4: b.
    const state = stateOf([
      ...entries('a', 'b', 'x', 'y', 'z', 'c', 'd', 'e'),
      ...preAssigned([
        ['a', 'b', 'x', 'y', 'z'],
        ['c', 'd', 'e'],
      ]),
      ...rounds(
        [
          ['x', 'y', 'z', 'b', 'a:DNF'],
          ['c', 'd', 'e'],
        ],
        [
          ['b', 'x', 'a', 'y', 'z'],
          ['c', 'd', 'e'],
        ],
        [
          ['x', 'a', '=b', 'y', 'z'],
          ['c', 'd', 'e'],
        ],
        [
          ['a', 'x', 'b', 'y', 'z'],
          ['c', 'd', 'e'],
        ],
      ),
    ]);
    const tie = explainTie(state, 'a', 'b');
    expect(tie.ahead).toBe('b');
    expect(tie.steps[0].rule).toBe('SHRS 5.7(ii)(1)-(2), RRS A8.1');
  });

  it('SHRS 5.7(ii): equal in every race they sailed together, they stay tied (no winner)', () => {
    // a and b tie at the finish in both rounds: 1.5 + 2.5 each.
    const state = stateOf([
      ...entries('a', 'b', 'x', 'c', 'd'),
      ...preAssigned([
        ['a', 'b', 'x'],
        ['c', 'd'],
      ]),
      ...rounds(
        [
          ['a', '=b', 'x'],
          ['c', 'd'],
        ],
        [
          ['x', 'a', '=b'],
          ['c', 'd'],
        ],
      ),
    ]);
    const tie = explainTie(state, 'a', 'b');
    expect(tie.ahead).toBeNull();
    expect(tie.steps[0].rule).toBe('SHRS 5.7(ii)(1)-(2), RRS A8.1');
    expect(tie.steps.at(-1)!.text).toBe(
      'No rule separates them, so they share the place.',
    );
    const { standings } = qualifyingStandings(state);
    const place = (id: string) => standings.find((s) => s.boat === id)!.place;
    expect(place('a')).toBe(place('b'));
  });

  it('SHRS 5.7(ii)(4): boats that never met use RRS A8.1 without changes', () => {
    // a (heat A): 1, 4; b (heat B): 2, 3. A8.1: 1 against 2, a.
    const state = stateOf([
      ...entries('a', 'x1', 'x2', 'x3', 'b', 'y1', 'y2', 'y3'),
      ...preAssigned([
        ['a', 'x1', 'x2', 'x3'],
        ['b', 'y1', 'y2', 'y3'],
      ]),
      ...rounds(
        [
          ['a', 'x1', 'x2', 'x3'],
          ['y1', 'b', 'y2', 'y3'],
        ],
        [
          ['x1', 'x2', 'x3', 'a'],
          ['y1', 'y2', 'b', 'y3'],
        ],
      ),
    ]);
    expect(explainTie(state, 'a', 'b')).toMatchObject({
      ahead: 'a',
      steps: [{ rule: 'SHRS 5.7(ii)(4)' }, { rule: 'RRS A8.1' }],
    });
  });
});

describe('overall (qualifying + final)', () => {
  it('SHRS 5.7(ii)(1)-(2): an overall tie uses the shared races of both series', () => {
    // A = a, b, x1, x2 both rounds: a 1, 1; b 2, 2. Gold = a, c1, b, c2.
    // Gold: a 3, 4; b 2, 3. Overall 9 each. Shared races of both series,
    // best first: a 1, 1, 3, 4 against b 2, 2, 2, 3, so a (the final
    // series alone would have put b ahead).
    const state = stateOf([
      ...entries('a', 'b', 'x1', 'x2', 'c1', 'c2', 'c3', 'c4'),
      ...preAssigned([
        ['a', 'b', 'x1', 'x2'],
        ['c1', 'c2', 'c3', 'c4'],
      ]),
      ...rounds(
        [
          ['a', 'b', 'x1', 'x2'],
          ['c1', 'c2', 'c3', 'c4'],
        ],
        [
          ['a', 'b', 'x1', 'x2'],
          ['c1', 'c2', 'c3', 'c4'],
        ],
      ),
      { type: 'finalSeriesStarted' },
      sheet('Gold', 1, 'c1', 'b', 'a', 'c2'),
      sheet('Gold', 2, 'c1', 'c2', 'b', 'a'),
    ]);
    expect([...state.fleets![0].boats].sort()).toEqual(['a', 'b', 'c1', 'c2']);
    const overall = overallStandings(state);
    const of = (id: string) => overall.find((s) => s.boat === id)!;
    expect([of('a').total, of('b').total]).toEqual([9, 9]);
    expect(of('a').place).toBeLessThan(of('b').place);
    const tie = explainTie(state, 'a', 'b', 'overall');
    expect(tie.ahead).toBe('a');
    expect(tie.steps[0].rule).toBe('SHRS 5.7(ii)(1)-(2), RRS A8.1');
    expect(tie.steps[0].text).toContain('A1, A2, Gold race 1, Gold race 2');
  });

  // A1: b 1, a 2, x 3; B1: every boat DNF (4). Gold = b, a, x.
  // Gold race 1: a 1, b 2, x 3. Overall 3 each; A8.1 1, 2 both.
  const lastRace = stateOf([
    ...entries('a', 'b', 'x', 'c1', 'c2', 'c3'),
    ...preAssigned([
      ['a', 'b', 'x'],
      ['c1', 'c2', 'c3'],
    ]),
    sheet('A1', 1, 'b', 'a', 'x'),
    sheet('B1', 1, 'c1:DNF', 'c2:DNF', 'c3:DNF'),
    { type: 'finalSeriesStarted' },
    sheet('Gold', 1, 'a', 'b', 'x'),
  ]);

  it('RRS A8.2: the last race of the event is the last final race, not the qualifying race', () => {
    const overall = overallStandings(lastRace);
    const of = (id: string) => overall.find((s) => s.boat === id)!;
    expect([of('a').total, of('b').total]).toEqual([3, 3]);
    expect(of('a').place).toBe(1);
    expect(of('b').place).toBe(2);
  });

  it('RRS A8.2: the explanation cites the shared final race as the one that decides', () => {
    const tie = explainTie(lastRace, 'a', 'b', 'overall');
    expect(tie.ahead).toBe('a');
    const last = tie.steps.at(-1)!;
    expect(last.rule).toBe('SHRS 5.7(ii)(1), RRS A8.2');
    expect(last.text).toContain('(Gold race 1) decides: 1 against 2');
  });

  it('SHRS 5.7(ii): equal in every shared race of both series, they stay tied (no winner)', () => {
    // a and b tie at the finish in A1 (1.5) and in Gold (2.5): 4 each.
    const state = stateOf([
      ...entries('a', 'b', 'x', 'c1', 'c2', 'c3'),
      ...preAssigned([
        ['a', 'b', 'x'],
        ['c1', 'c2', 'c3'],
      ]),
      sheet('A1', 1, 'a', '=b', 'x'),
      sheet('B1', 1, 'c1', 'c2', 'c3'),
      { type: 'finalSeriesStarted' },
      sheet('Gold', 1, 'c1', 'a', '=b'),
    ]);
    expect([...state.fleets![0].boats].sort()).toEqual(['a', 'b', 'c1']);
    const overall = overallStandings(state);
    const of = (id: string) => overall.find((s) => s.boat === id)!;
    expect([of('a').total, of('b').total]).toEqual([4, 4]);
    expect(of('a').place).toBe(of('b').place);
    expect(explainTie(state, 'a', 'b', 'overall').ahead).toBeNull();
  });
});
