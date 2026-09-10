import {
  MAX_HEATS,
  SHRS_MAX_BOATS_PER_HEAT,
  minimumHeatsForEntries,
} from '../shared/heatSizing';

// SHRS 2.1 "the number of heats shall be as few as possible", bounded by
// 2.3 "the maximum number of boats in a heat shall be 20".
describe('minimumHeatsForEntries', () => {
  it('keeps a club-sized entry list in a single heat', () => {
    // The case the old default of 5 got wrong: twelve boats became five heats
    // of two or three unless the user changed the dropdown.
    expect(minimumHeatsForEntries(12)).toBe(1);
    expect(minimumHeatsForEntries(20)).toBe(1);
  });

  it('splits as soon as one heat would break SHRS 2.3', () => {
    expect(minimumHeatsForEntries(21)).toBe(2);
    expect(minimumHeatsForEntries(40)).toBe(2);
    expect(minimumHeatsForEntries(41)).toBe(3);
  });

  it('never returns fewer heats than the entries need', () => {
    for (let entries = 1; entries <= 300; entries += 1) {
      const heats = minimumHeatsForEntries(entries);
      expect(Math.ceil(entries / heats)).toBeLessThanOrEqual(
        SHRS_MAX_BOATS_PER_HEAT,
      );
      // ...and never more than they need (2.1).
      if (heats > 1) {
        expect(Math.ceil(entries / (heats - 1))).toBeGreaterThan(
          SHRS_MAX_BOATS_PER_HEAT,
        );
      }
    }
  });

  it('falls back to one heat for an empty or unusable entry count', () => {
    expect(minimumHeatsForEntries(0)).toBe(1);
    expect(minimumHeatsForEntries(-4)).toBe(1);
    expect(minimumHeatsForEntries(Number.NaN)).toBe(1);
  });

  it('stops at the app’s heat-naming limit', () => {
    // Heats are named "Heat A1".."Heat Z1"; beyond that the main process
    // rejects the count, so the default must not offer an impossible value.
    expect(minimumHeatsForEntries(10_000)).toBe(MAX_HEATS);
  });
});
