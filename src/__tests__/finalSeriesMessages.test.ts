import {
  finalSeriesBlockedMessage,
  unsailedLatestRoundMessage,
} from '../renderer/utils/finalSeriesMessages';

/**
 * The renderer's mapping from getFinalSeriesEligibility's verdict to the
 * prompt a scorer reads. Previously only reachable by driving the heats screen.
 */
describe('finalSeriesBlockedMessage', () => {
  it('explains that heats must exist first', () => {
    expect(finalSeriesBlockedMessage({ reason: 'NO_HEATS' })).toContain(
      'create heats',
    );
  });

  it('cites SHRS 1.1 for a single-fleet event', () => {
    const message = finalSeriesBlockedMessage({ reason: 'SINGLE_FLEET' });
    expect(message).toContain('SHRS 1.1');
    expect(message).toContain('no Final Series applies');
  });

  it('cites SHRS 4.2 when no qualifying race has been sailed', () => {
    const message = finalSeriesBlockedMessage({
      reason: 'NO_RACES_COMPLETED',
    });
    expect(message).toContain('SHRS 4.2');
  });

  it('lists the per-heat race counts when the rounds are uneven', () => {
    const message = finalSeriesBlockedMessage({
      reason: 'UNEVEN_RACE_COUNTS',
      raceCountBreakdown: [
        { name: 'Heat A', count: 3 },
        { name: 'Heat B', count: 2 },
      ],
    });
    expect(message).toContain('Heat A: 3 race(s)');
    expect(message).toContain('Heat B: 2 race(s)');
  });

  it('falls back to the uneven-rounds wording for an unknown reason', () => {
    // An unrecognised reason must still produce an actionable prompt rather
    // than an empty dialog.
    expect(finalSeriesBlockedMessage({})).toContain(
      'not all heats have the same number of races',
    );
  });
});

describe('unsailedLatestRoundMessage', () => {
  it('names the round and the count it will fall back to', () => {
    const message = unsailedLatestRoundMessage({
      latestRoundNumber: 4,
      completedQualifyingRaces: 3,
    });
    expect(message).toContain('(round 4)');
    expect(message).toContain('3 qualifying race(s)');
  });

  it('omits the round label when the number is unknown', () => {
    const message = unsailedLatestRoundMessage({ completedQualifyingRaces: 2 });
    expect(message).not.toMatch(/\(round /);
    expect(message).toContain('2 qualifying race(s)');
  });

  it('reports zero completed races rather than undefined', () => {
    expect(unsailedLatestRoundMessage({})).toContain('0 qualifying race(s)');
  });
});
