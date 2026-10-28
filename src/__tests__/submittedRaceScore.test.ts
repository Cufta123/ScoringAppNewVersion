import scoreSubmittedBoat, {
  penaltyHeatSize,
} from '../main/functions/submittedRaceScore';

const entry = (place: unknown, status: unknown, boatNumber = 12) => ({
  boatNumber,
  place,
  status,
});

describe('penaltyHeatSize', () => {
  it('uses the largest heat of the series when there is one', () => {
    expect(penaltyHeatSize(16, 12)).toBe(16);
  });

  it('falls back to the number of boats scored before any heat size is known', () => {
    expect(penaltyHeatSize(0, 12)).toBe(12);
  });
});

describe('scoreSubmittedBoat', () => {
  describe('FINISHED', () => {
    it('keeps the place as position and points', () => {
      expect(scoreSubmittedBoat(entry(3, 'FINISHED'), 10)).toEqual({
        status: 'FINISHED',
        position: 3,
        points: 3,
        finished: true,
      });
    });

    it('treats a missing or blank code as FINISHED', () => {
      expect(scoreSubmittedBoat(entry(2, undefined), 10).status).toBe(
        'FINISHED',
      );
      expect(scoreSubmittedBoat(entry(2, '  '), 10).status).toBe('FINISHED');
    });

    it('accepts a place sent as text', () => {
      expect(scoreSubmittedBoat(entry('4', 'FINISHED'), 10).position).toBe(4);
    });

    it.each([0, -1, 2.5, 'abc', '', null, undefined, NaN])(
      'refuses the place %p and names the sail',
      (place) => {
        expect(() =>
          scoreSubmittedBoat(entry(place, 'FINISHED', 77), 10),
        ).toThrow(/^The place of sail 77 must be a whole number of 1 or more/);
      },
    );
  });

  describe('ZFP / SCP / T1 keep the place and add the penalty (RRS 44.3(c))', () => {
    it('ZFP adds 20% of the DNF score', () => {
      // 16 boats: DNF score 17, 20% = 3.4
      expect(scoreSubmittedBoat(entry(5, 'ZFP'), 16)).toEqual({
        status: 'ZFP',
        position: 5,
        points: 8.4,
        finished: false,
      });
    });

    it('SCP behaves like ZFP', () => {
      expect(scoreSubmittedBoat(entry(5, 'SCP'), 16).points).toBe(8.4);
    });

    it('T1 adds 30% of the DNF score', () => {
      // 16 boats: DNF score 17, 30% = 5.1
      expect(scoreSubmittedBoat(entry(5, 'T1'), 16)).toEqual({
        status: 'T1',
        position: 5,
        points: 10.1,
        finished: false,
      });
    });

    it('never scores more than the DNF score', () => {
      expect(scoreSubmittedBoat(entry(16, 'ZFP'), 16).points).toBe(17);
    });

    it('needs a real place, since it keeps it', () => {
      expect(() => scoreSubmittedBoat(entry(0, 'ZFP', 9), 16)).toThrow(
        'The place of sail 9 must be a whole number of 1 or more, not 0.',
      );
    });

    it('does not count as a finisher for the tie scoring', () => {
      expect(scoreSubmittedBoat(entry(5, 'ZFP'), 16).finished).toBe(false);
    });
  });

  describe('every other code takes the largest heat + 1 (SHRS 5.2)', () => {
    it.each(['DNF', 'DNS', 'DSQ', 'OCS', 'BFD', 'UFD', 'RET', 'DNC', 'WTH'])(
      '%s',
      (status) => {
        expect(scoreSubmittedBoat(entry(2, status), 16)).toEqual({
          status,
          position: 17,
          points: 17,
          finished: false,
        });
      },
    );

    it('ignores the place typed, even an invalid one', () => {
      [0, '', null, undefined, 'x', -4].forEach((place) => {
        const score = scoreSubmittedBoat(entry(place, 'DNF'), 16);
        expect(score.position).toBe(17);
        expect(score.points).toBe(17);
      });
    });

    it('redress codes also start from the penalty place', () => {
      expect(scoreSubmittedBoat(entry(3, 'RDG1'), 16)).toEqual({
        status: 'RDG1',
        position: 17,
        points: 17,
        finished: false,
      });
    });

    it('works for a heat of one boat', () => {
      expect(scoreSubmittedBoat(entry(1, 'DNF'), 1)).toMatchObject({
        position: 2,
        points: 2,
      });
    });

    it('reads codes in lower case and RAF as RET', () => {
      expect(scoreSubmittedBoat(entry(1, ' dnf '), 8).status).toBe('DNF');
      expect(scoreSubmittedBoat(entry(1, 'raf'), 8).status).toBe('RET');
    });
  });

  it('refuses a code the app does not know, in plain words', () => {
    expect(() => scoreSubmittedBoat(entry(1, 'XYZ'), 8)).toThrow(
      /^"XYZ" is not a result code this app knows\. Use a place, or one of: /,
    );
  });
});
