/**
 * Ported from the app's src/__tests__/scoringCore.explain.test.ts (the old
 * src/shared/scoring/explain.ts). Covered already in explain.test.ts: a tie
 * at the finish (A7), a Z flag penalty, the explanation agreeing with the
 * ranking (random events); in rules.test.ts: a boat keeps one score. "A
 * stored score that does not match the rule" has no library counterpart
 * (nothing derived is stored).
 */
import { explainScore, type Decision, type DiscardProfile } from '../../src';
import { boats, protest, sheet, stateOf } from './helpers';

/** One heat of b1 … bn; each race a finishing order (helpers `line`). */
const fleet = (n: number, ...races: string[][]): Decision[] => [
  ...boats(n),
  { type: 'heatsCreated', heatCount: 1 },
  ...races.map((order, i) => sheet('A1', i + 1, ...order)),
];
const racesOf = (log: Decision[], boat = 'b1') =>
  explainScore(stateOf(log), boat).qualifying!.races;

describe('race points explained', () => {
  it('RRS A4: a finish scores its place', () => {
    const [race] = racesOf(fleet(4, ['b2', 'b3', 'b1', 'b4']));
    expect(race.reason).toEqual({
      rule: 'RRS A4',
      text: 'Finished 3: 3 points.',
    });
  });

  it('SHRS 5.2: DNF is one more than the largest heat', () => {
    const [race] = racesOf(fleet(4, ['b2', 'b3', 'b4', 'b1:DNF']));
    expect(race.reason).toEqual({
      rule: 'SHRS 5.2',
      text: 'DNF (did not finish): one more than the 4 boats in the largest heat = 5.',
    });
  });

  it('RRS T1(b), 44.3(c): a penalty never scores worse than DNF', () => {
    // 4 boats: DNF 5, 30% = 1.5; 4th + 1.5 = 5.5, capped at 5.
    const [race] = racesOf(fleet(4, ['b2', 'b3', 'b4', 'b1:T1']));
    expect(race.points).toBe(5);
    expect(race.reason.rule).toBe('RRS T1(b), 44.3(c)');
    expect(race.reason.text).toContain(
      'a penalty cannot make her score worse than DNF, so 5.',
    );
  });

  it('RRS A9(a): RDG1 lists the races averaged, other average redress left out, RDG3 kept', () => {
    // b1: 1, RDG1, 2, RDG3 5, 4, RDG1. (1 + 2 + 5 + 4) / 4 = 3.
    const log: Decision[] = [
      ...fleet(
        5,
        ['b1', 'b2', 'b3', 'b4', 'b5'],
        ['b2', 'b1', 'b3', 'b4', 'b5'],
        ['b2', 'b1', 'b3', 'b4', 'b5'],
        ['b2', 'b3', 'b1', 'b4', 'b5'],
        ['b2', 'b3', 'b4', 'b1', 'b5'],
        ['b2', 'b1', 'b3', 'b4', 'b5'],
      ),
      protest('A1', 2, 'b1', { kind: 'RDG1' }),
      protest('A1', 4, 'b1', { kind: 'RDG3', points: 5 }),
      protest('A1', 6, 'b1', { kind: 'RDG1' }),
    ];
    const races = racesOf(log);
    expect(races[1].points).toBe(3);
    expect(races[1].reason.rule).toBe('RRS A9(a), SHRS 5.6');
    expect(races[1].reason.text).toContain('(Q1 1, Q3 2, Q4 5, Q5 4)');
    expect(races[1].reason.text).toContain(
      'other average-redress races left out',
    );
    expect(races[1].reason.text).toContain('= 3.');
  });

  it('RRS A9: RDG2 averages only the races the protest committee chose', () => {
    // b1: 1, 3, RDG2 of races 1 and 2, 5 (DNF). (1 + 3) / 2 = 2.
    const log: Decision[] = [
      ...fleet(
        4,
        ['b1', 'b2', 'b3', 'b4'],
        ['b2', 'b3', 'b1', 'b4'],
        ['b2', 'b1', 'b3', 'b4'],
        ['b2', 'b3', 'b4', 'b1:DNF'],
      ),
      protest('A1', 3, 'b1', {
        kind: 'RDG2',
        races: [
          { heat: 'A1', race: 1 },
          { heat: 'A1', race: 2 },
        ],
      }),
    ];
    const races = racesOf(log);
    expect(races[2].points).toBe(2);
    expect(races[2].reason.rule).toBe('RRS A9, SHRS 5.6');
    expect(races[2].reason.text).toContain(
      'the races the protest committee chose (Q1 1, Q2 3)',
    );
    expect(races[2].reason.text).toContain('to the nearest tenth = 2.');
  });

  it('RRS A9 / A10: RDG3 and DPI points are set by the protest committee', () => {
    const log: Decision[] = [
      ...fleet(4, ['b1', 'b2', 'b3', 'b4']),
      protest('A1', 1, 'b1', { kind: 'RDG3', points: 4 }),
      protest('A1', 1, 'b2', { kind: 'DPI', points: 6 }),
    ];
    expect(racesOf(log, 'b1')[0]).toMatchObject({
      points: 4,
      reason: { rule: 'RRS A9' },
    });
    expect(racesOf(log, 'b2')[0]).toMatchObject({
      points: 6,
      reason: { rule: 'RRS A10' },
    });
  });
});

describe('a series explained', () => {
  it('SHRS 5.4: names the discard rule, the race excluded and the sum', () => {
    // b1: 2, DNF 5, 1, 3; 4 races, one discard (the DNF).
    const q = explainScore(
      stateOf(
        fleet(
          4,
          ['b2', 'b1', 'b3', 'b4'],
          ['b2', 'b3', 'b4', 'b1:DNF'],
          ['b1', 'b2', 'b3', 'b4'],
          ['b2', 'b3', 'b1', 'b4'],
        ),
      ),
      'b1',
    ).qualifying!;
    expect(q.races.map((r) => r.excluded)).toEqual([false, true, false, false]);
    expect(q.discards.rule).toBe('SHRS 5.4');
    expect(q.discards.text).toContain(
      '4 races completed in this series, so 1 worst score is excluded. Standard rule',
    );
    expect(q).toMatchObject({ gross: 11, total: 6 });
  });

  it('RRS 90.3(b) / A2.1: a DNE stays, and of equal scores the earliest goes', () => {
    // b1: 4, DNE 5, 4, 1. One discard: the DNE cannot go, the first 4 does.
    const q = explainScore(
      stateOf(
        fleet(
          4,
          ['b2', 'b3', 'b4', 'b1'],
          ['b2', 'b3', 'b4', 'b1:DNE'],
          ['b2', 'b3', 'b4', 'b1'],
          ['b1', 'b2', 'b3', 'b4'],
        ),
      ),
      'b1',
    ).qualifying!;
    expect(q.races.map((r) => r.excluded)).toEqual([true, false, false, false]);
    expect(q.races[1].note).toEqual({
      rule: 'RRS 90.3(b)',
      text: 'DNE can never be excluded.',
    });
    expect(q.races[2].note?.rule).toBe('RRS A2.1');
    expect(q.total).toBe(10);
  });

  it.each([
    [
      { kind: 'thresholds', at: [2, 5] } as DiscardProfile,
      'one more score is excluded at each of 2, 5 races',
    ],
    [{ kind: 'none' } as DiscardProfile, 'exclude no score'],
  ])('SHRS 5.4: describes a race committee change (%j)', (profile, words) => {
    const log: Decision[] = [
      {
        type: 'settingsChanged',
        settings: {
          discards: { qualifying: profile, final: { kind: 'standard' } },
        },
      },
      ...fleet(4, ['b2', 'b1', 'b3', 'b4'], ['b2', 'b3', 'b1', 'b4']),
    ];
    const q = explainScore(stateOf(log), 'b1').qualifying!;
    expect(q.discards.text).toContain(words);
    expect(q.discards.count).toBe(profile.kind === 'none' ? 0 : 1);
  });
});
