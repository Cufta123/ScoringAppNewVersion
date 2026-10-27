import {
  averageRedressPoints,
  parseRedressRaceIds,
  roundToTenthHalfUp,
} from '../shared/redress';
import { averageRacePoints } from '../renderer/utils/leaderboardUtils';

describe('RRS A9 average-points redress', () => {
  it('rounds to the nearest tenth, 0.05 upward', () => {
    expect(roundToTenthHalfUp(2.05)).toBe(2.1);
    expect(roundToTenthHalfUp(2.04)).toBe(2);
    expect(roundToTenthHalfUp(10 / 3)).toBe(3.3);
    expect(roundToTenthHalfUp(3.95)).toBe(4);
  });

  it('averages every other race, including penalty scores', () => {
    expect(
      averageRedressPoints([
        { points: 2, status: 'FINISHED' },
        { points: 21, status: 'DNF' },
        { points: 4, status: 'FINISHED' },
      ]),
    ).toBe(9);
  });

  it('leaves out races that were themselves scored by average redress', () => {
    expect(
      averageRedressPoints([
        { points: 2, status: 'FINISHED' },
        { points: 9.9, status: 'RDG1' },
        { points: 7.7, status: 'RDG2' },
        { points: 4, status: 'FINISHED' },
        { points: 5, status: 'RDG3' }, // PC-set points are her score
      ]),
    ).toBe(3.7);
  });

  it('has no average when nothing else has been sailed', () => {
    expect(averageRedressPoints([])).toBeNull();
    expect(averageRedressPoints([{ points: 3, status: 'RDG1' }])).toBeNull();
  });

  it('reads the stored RDG2 race selection defensively', () => {
    expect(parseRedressRaceIds('[3,5]')).toEqual([3, 5]);
    expect(parseRedressRaceIds(null)).toBeNull();
    expect(parseRedressRaceIds('not json')).toBeNull();
    expect(parseRedressRaceIds('[]')).toBeNull();
  });

  it('gives the edit preview the same answer as the backend', () => {
    // Race 2 is the redressed cell; race 3 is another RDG1 and is skipped.
    expect(
      averageRacePoints(['2', '0', '(9.9)', '5'], null, 1, 99, [
        'FINISHED',
        'RDG1',
        'RDG1',
        'FINISHED',
      ]),
    ).toBe(3.5);
  });
});
