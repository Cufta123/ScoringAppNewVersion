/* eslint-disable camelcase */
/**
 * Unit tests for src/shared/scoringPenalty.ts — RRS 44.3(c)/Appendix T1
 * scoring-penalty math shared by main + renderer. Under SHRS 5.2 the DNF
 * score is (boats in the largest heat) + 1, so the 20%/30% penalty must be
 * based on `maxBoats + 1`, not `maxBoats` (see docs/SCORING_AUDIT.md M5,
 * already fixed in source — these tests pin the rule-correct values at the
 * documented rounding-boundary heat sizes).
 */
import {
  scoringPenaltyStatuses,
  roundHalfUp,
  getScoringPenaltyPoints,
} from '../shared/scoringPenalty';

describe('scoringPenaltyStatuses', () => {
  it('contains exactly ZFP, SCP, and T1', () => {
    expect([...scoringPenaltyStatuses].sort()).toEqual(['SCP', 'T1', 'ZFP']);
  });
});

describe('roundHalfUp', () => {
  it('rounds an exact .5 up', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it('rounds down below .5', () => {
    expect(roundHalfUp(2.49)).toBe(2);
  });

  it('rounds up above .5', () => {
    expect(roundHalfUp(2.51)).toBe(3);
  });
});

describe('getScoringPenaltyPoints — RRS 44.3(c)/T1, base = DNF score = maxBoats + 1 (SHRS 5.2 / M5)', () => {
  // 20% (ZFP/SCP): heat sizes where maxBoats+1 crosses a .5 rounding
  // boundary that maxBoats alone would not — these are exactly the sizes
  // that distinguish the M5-fixed formula from the old off-by-one bug.
  it.each([
    [2, 1], // dnfScore=3, 3*0.2=0.6 -> 1
    [7, 2], // dnfScore=8, 8*0.2=1.6 -> 2
    [12, 3], // dnfScore=13, 13*0.2=2.6 -> 3
    [17, 4], // dnfScore=18, 18*0.2=3.6 -> 4
  ])(
    'ZFP: heat size %i adds %i penalty place(s)',
    (maxBoats, expectedPenaltyPlaces) => {
      const finishingPosition = 1;
      const result = getScoringPenaltyPoints(
        finishingPosition,
        maxBoats,
        'ZFP',
      );
      expect(result).toBe(finishingPosition + expectedPenaltyPlaces);
    },
  );

  it.each([
    [2, 1],
    [7, 2],
    [12, 3],
    [17, 4],
  ])(
    'SCP: heat size %i adds %i penalty place(s) (same 20%% rate as ZFP)',
    (maxBoats, expectedPenaltyPlaces) => {
      const result = getScoringPenaltyPoints(1, maxBoats, 'SCP');
      expect(result).toBe(1 + expectedPenaltyPlaces);
    },
  );

  // 30% (Appendix T1): same boundary logic at the T1 rate.
  it.each([
    [4, 2], // dnfScore=5, 5*0.3=1.5 -> 2
    [8, 3], // dnfScore=9, 9*0.3=2.7 -> 3
    [11, 4], // dnfScore=12, 12*0.3=3.6 -> 4
    [14, 5], // dnfScore=15, 15*0.3=4.5 -> 5
    [18, 6], // dnfScore=19, 19*0.3=5.7 -> 6
  ])(
    'T1: heat size %i adds %i penalty place(s) (30%% rate)',
    (maxBoats, expectedPenaltyPlaces) => {
      const result = getScoringPenaltyPoints(1, maxBoats, 'T1');
      expect(result).toBe(1 + expectedPenaltyPlaces);
    },
  );

  it('caps the penalty at the DNF score (maxBoats + 1)', () => {
    // Last-placed finisher (10th of 10 boats) plus a 20% penalty must not
    // exceed the DNF score itself (maxBoats+1 = 11).
    const maxBoats = 10;
    const dnfScore = maxBoats + 1;
    const result = getScoringPenaltyPoints(10, maxBoats, 'ZFP');
    // 10 + round(11*0.2=2.2)=2 -> 12, capped to 11.
    expect(result).toBe(dnfScore);
  });

  it('caps a T1 penalty at the DNF score too', () => {
    const maxBoats = 5;
    const dnfScore = maxBoats + 1; // 6
    const result = getScoringPenaltyPoints(5, maxBoats, 'T1');
    // 5 + round(6*0.3=1.8 -> 2) = 7, capped to 6.
    expect(result).toBe(dnfScore);
  });

  it('does not cap when the penalty keeps the boat within the fleet', () => {
    const result = getScoringPenaltyPoints(1, 12, 'ZFP');
    // 1 + 3 = 4, well under dnfScore=13.
    expect(result).toBe(4);
  });

  it('defaults to the 20% rate for any status other than T1', () => {
    const zfp = getScoringPenaltyPoints(1, 12, 'ZFP');
    const scp = getScoringPenaltyPoints(1, 12, 'SCP');
    const undefinedStatus = getScoringPenaltyPoints(1, 12, undefined);
    expect(scp).toBe(zfp);
    expect(undefinedStatus).toBe(zfp);
  });
});
