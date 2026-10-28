import {
  countQualifyingGroups,
  getHeatGroupFromName,
  getHeatRoundFromName,
} from '../shared/heatNames';

const names = (...list: string[]) => list.map((heat_name) => ({ heat_name }));

describe('heat names', () => {
  it('reads the group letters and round of a qualifying heat', () => {
    expect(getHeatGroupFromName('Heat B3')).toBe('B');
    expect(getHeatGroupFromName('Heat AA12')).toBe('AA');
    expect(getHeatRoundFromName('Heat B3')).toBe(3);
    expect(getHeatRoundFromName('Heat AA12')).toBe(12);
    expect(getHeatRoundFromName('Heat A')).toBe(0);
  });

  it('returns null for names that are not qualifying heats', () => {
    expect(getHeatGroupFromName('Final Gold')).toBeNull();
    expect(getHeatRoundFromName('Final Gold')).toBeNull();
  });

  describe('countQualifyingGroups', () => {
    it('counts each group once however many rounds it has', () => {
      expect(
        countQualifyingGroups(
          names('Heat A1', 'Heat B1', 'Heat A2', 'Heat B2', 'Heat A3'),
        ),
      ).toBe(2);
    });

    it('keeps multi-letter groups apart', () => {
      expect(countQualifyingGroups(names('Heat A1', 'Heat AA1'))).toBe(2);
    });

    it('is 1 for a single-heat event and 0 for none', () => {
      expect(countQualifyingGroups(names('Heat A1', 'Heat A2'))).toBe(1);
      expect(countQualifyingGroups([])).toBe(0);
    });

    it('ignores names that are not qualifying heats', () => {
      expect(
        countQualifyingGroups(names('Heat A1', 'Final Gold', 'Final Silver')),
      ).toBe(1);
    });
  });
});
