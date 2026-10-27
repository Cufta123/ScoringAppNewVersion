/**
 * The score explanation (src/shared/scoring/explain.ts) on plain data: every
 * number is explained with the rule that produced it, and the explanation
 * excludes the same races and reaches the same total as the ranking.
 */
import {
  explainBoatSeries,
  explainRacePoints,
  ExplainRaceInput,
} from '../shared/scoring/explain';
import { scoreBoatSeries } from '../shared/scoring/series';
import {
  getExcludeCountForConfig,
  normalizeDiscardConfig,
} from '../shared/discardProfile';

const STANDARD = normalizeDiscardConfig('standard');

const race = (
  i: number,
  status: string,
  position: number,
  points: number,
  extra: Partial<ExplainRaceInput> = {},
): ExplainRaceInput => ({
  race_id: 100 + i,
  race_number: 1,
  label: `Q${i}`,
  status,
  position,
  points,
  ...extra,
});

describe('explainRacePoints', () => {
  const largestHeat = 15; // DNF score 16

  it('a finish scores its place (RRS A4)', () => {
    expect(
      explainRacePoints(race(1, 'FINISHED', 3, 3), [], largestHeat),
    ).toEqual({
      rule: 'RRS A4',
      text: 'Finished 3: 3 points.',
    });
  });

  it('a tie at the finish shares the points (RRS A7)', () => {
    expect(
      explainRacePoints(race(1, 'FINISHED', 2, 2.5), [], largestHeat).rule,
    ).toBe('RRS A7');
  });

  it('DNF is one more than the largest heat (SHRS 5.2)', () => {
    expect(explainRacePoints(race(1, 'DNF', 16, 16), [], largestHeat)).toEqual({
      rule: 'SHRS 5.2',
      text: 'DNF (did not finish): one more than the 15 boats in the largest heat = 16.',
    });
  });

  it('says so when a stored score does not match the rule', () => {
    expect(
      explainRacePoints(race(1, 'DNS', 12, 12), [], largestHeat).text,
    ).toContain('(recorded as 12 points)');
  });

  it('ZFP adds 20% of the DNF score, to the tenth (RRS 30.2, 44.3(c))', () => {
    expect(explainRacePoints(race(1, 'ZFP', 4, 7.2), [], largestHeat)).toEqual({
      rule: 'RRS 30.2, 44.3(c)',
      text: 'Finished 4 plus a Z flag penalty: 20% of the DNF score (16) is 3.2, so 4 + 3.2 = 7.2.',
    });
  });

  it('a penalty never scores worse than DNF', () => {
    const reason = explainRacePoints(race(1, 'T1', 14, 16), [], largestHeat);
    expect(reason.rule).toBe('RRS T1(b), 44.3(c)');
    expect(reason.text).toContain('cannot be worse than DNF, so 16');
  });

  it('RDG1 shows the races averaged, leaving out other redress (RRS A9(a))', () => {
    const series = [
      race(1, 'FINISHED', 1, 1),
      race(2, 'RDG1', 2.3, 2.3),
      race(3, 'FINISHED', 2, 2),
      race(4, 'RDG3', 5, 5),
      race(5, 'FINISHED', 4, 4),
      race(6, 'RDG1', 2.3, 2.3),
    ];
    const reason = explainRacePoints(series[1], series, largestHeat);
    expect(reason.rule).toBe('RRS A9(a), SHRS 5.6');
    // (1 + 2 + 5 + 4) / 4 = 3; RDG3 is a set value so it counts, the other
    // RDG1 does not.
    expect(reason.text).toContain('(Q1 1, Q3 2, Q4 5, Q5 4)');
    expect(reason.text).toContain('= 3 (recorded as 2.3)');
    expect(reason.text).toContain('other average-redress races are left out');
  });

  it('RDG2 averages only the chosen races', () => {
    const series = [
      race(1, 'FINISHED', 1, 1),
      race(2, 'FINISHED', 3, 3),
      race(3, 'RDG2', 2, 2, { rdg_race_ids: [101, 102] }),
      race(4, 'FINISHED', 9, 9),
    ];
    expect(explainRacePoints(series[2], series, largestHeat).text).toContain(
      'the races the protest committee chose (Q1 1, Q2 3), to the nearest tenth = 2.',
    );
  });

  it('protest-committee values are said to be set by the committee', () => {
    expect(explainRacePoints(race(1, 'RDG3', 4, 4), [], 15).rule).toBe(
      'RRS A9',
    );
    expect(explainRacePoints(race(1, 'DPI', 6, 6), [], 15).rule).toBe(
      'RRS A10',
    );
  });
});

describe('explainBoatSeries', () => {
  it('names the discard rule, the race excluded and the sum', () => {
    const result = explainBoatSeries({
      races: [
        race(1, 'FINISHED', 2, 2),
        race(2, 'DNF', 16, 16),
        race(3, 'FINISHED', 1, 1),
        race(4, 'FINISHED', 3, 3),
      ],
      seriesRaceCount: 4,
      discardConfig: STANDARD,
      largestHeat: 15,
    });
    expect(result.races.map((r) => r.excluded)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(result.discards.rule).toBe('SHRS 5.4');
    expect(result.discards.text).toContain(
      '4 races completed in this series, so 1 worst score is excluded. Standard rule',
    );
    expect(result).toMatchObject({ gross: 22, total: 6 });
  });

  it('explains why a DNE stays and which of equal scores goes', () => {
    const result = explainBoatSeries({
      races: [
        race(1, 'FINISHED', 5, 5),
        race(2, 'DNE', 16, 16),
        race(3, 'FINISHED', 5, 5),
        race(4, 'FINISHED', 1, 1),
      ],
      seriesRaceCount: 4,
      discardConfig: STANDARD,
      largestHeat: 15,
    });
    expect(result.races[0].excluded).toBe(true);
    expect(result.races[1].exclusionNote?.text).toBe(
      'DNE can never be excluded.',
    );
    expect(result.races[2].exclusionNote?.rule).toBe('RRS A2.1');
    expect(result.total).toBe(22);
  });

  it('says when a boat with few scores keeps one', () => {
    const result = explainBoatSeries({
      races: [race(1, 'FINISHED', 2, 2)],
      seriesRaceCount: 8,
      discardConfig: STANDARD,
      largestHeat: 15,
    });
    expect(result.discards.count).toBe(0);
    expect(result.discards.text).toContain('She has only 1 score');
    expect(result.total).toBe(2);
  });

  it('describes a race committee change and "never discard"', () => {
    const custom = explainBoatSeries({
      races: [race(1, 'FINISHED', 2, 2), race(2, 'FINISHED', 3, 3)],
      seriesRaceCount: 2,
      discardConfig: normalizeDiscardConfig({ thresholds: [2, 5] }),
      largestHeat: 15,
    });
    expect(custom.discards.text).toContain('at each of 2, 5 races');
    const never = explainBoatSeries({
      races: [race(1, 'FINISHED', 2, 2)],
      seriesRaceCount: 9,
      discardConfig: normalizeDiscardConfig({ thresholds: [] }),
      largestHeat: 15,
    });
    expect(never.discards.text).toContain('never exclude a score');
  });

  it('excludes the same races and reaches the same total as the ranking', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let n = 0; n < 1000; n += 1) {
      const count = 1 + Math.floor(random() * 18);
      const seriesRaceCount = count + Math.floor(random() * 3);
      const races = Array.from({ length: count }, (_, i) => {
        const points =
          random() < 0.25
            ? Math.round(random() * 90) / 10
            : 1 + Math.floor(random() * 6);
        return race(
          i + 1,
          random() < 0.05 ? 'DNE' : 'FINISHED',
          points,
          points,
        );
      });
      const explained = explainBoatSeries({
        races,
        seriesRaceCount,
        discardConfig: STANDARD,
        largestHeat: 15,
      });
      const ranked = scoreBoatSeries(
        races,
        getExcludeCountForConfig(seriesRaceCount, STANDARD),
      );
      expect(explained.total).toBe(ranked.totalPoints);
      expect(
        explained.races
          .filter((r) => !r.excluded)
          .map((r) => r.points)
          .sort(),
      ).toEqual([...ranked.keptPoints].sort());
    }
  });
});
