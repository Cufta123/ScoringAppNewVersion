import {
  getPenaltyRank,
  orderBoatsByPenalty,
  POSITION_KEEPING_PENALTIES,
} from '../renderer/utils/penaltyOrder';

const compareBoatNumbers = (a, b) =>
  String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

describe('penaltyOrder', () => {
  it('keeps finishers in their given order', () => {
    const result = orderBoatsByPenalty(['5', '3', '9'], {}, compareBoatNumbers);
    expect(result).toEqual(['5', '3', '9']);
  });

  it('treats position-keeping penalties as keeping their place', () => {
    POSITION_KEEPING_PENALTIES.forEach((status) => {
      const result = orderBoatsByPenalty(
        ['5', '3'],
        { 3: status },
        compareBoatNumbers,
      );
      expect(result).toEqual(['5', '3']);
    });
  });

  it('pushes displaced penalties to the back in SHRS 5.3 severity order', () => {
    // DNF (rank 0) is recorded before DSQ; both come after finishers.
    const result = orderBoatsByPenalty(
      ['1', '2', '3'],
      { 1: 'DSQ', 3: 'DNF' },
      compareBoatNumbers,
    );
    // 2 keeps its place; DNF before DSQ.
    expect(result).toEqual(['2', '3', '1']);
  });

  it('breaks penalty ties alphanumerically by sail number', () => {
    const result = orderBoatsByPenalty(
      ['10', '2'],
      { 10: 'DNF', 2: 'DNF' },
      compareBoatNumbers,
    );
    expect(result).toEqual(['2', '10']);
  });

  it('ranks unknown statuses last', () => {
    expect(getPenaltyRank('DNF')).toBeLessThan(getPenaltyRank('ZZZ'));
  });
});
