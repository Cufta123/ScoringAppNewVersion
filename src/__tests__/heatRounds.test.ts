import { laterRoundHeatNames } from '../shared/heatNames';
import {
  laterRoundBlocksUndoMessage,
  raceAgainWarning,
  unmatchedSailsMessage,
} from '../renderer/utils/heatRounds';

const heats = [
  'Heat A1',
  'Heat B1',
  'Heat A2',
  'Heat B2',
  'Heat A3',
  'Final Gold',
].map((heat_name) => ({ heat_name }));

describe('laterRoundHeatNames', () => {
  it('lists later rounds of the same group only', () => {
    expect(laterRoundHeatNames(heats, 'Heat A1')).toEqual([
      'Heat A2',
      'Heat A3',
    ]);
    expect(laterRoundHeatNames(heats, 'Heat B1')).toEqual(['Heat B2']);
  });

  it('is empty for the latest round', () => {
    expect(laterRoundHeatNames(heats, 'Heat A3')).toEqual([]);
  });

  it('compares rounds as numbers, not text', () => {
    const many = ['Heat A2', 'Heat A10'].map((heat_name) => ({ heat_name }));
    expect(laterRoundHeatNames(many, 'Heat A2')).toEqual(['Heat A10']);
    expect(laterRoundHeatNames(many, 'Heat A10')).toEqual([]);
  });

  it('is empty for a name that is not a qualifying heat', () => {
    expect(laterRoundHeatNames(heats, 'Final Gold')).toEqual([]);
  });
});

describe('messages', () => {
  it('words the SHRS 3.2 warning with the next race number', () => {
    const text = raceAgainWarning('Heat A1', 2);
    expect(text).toContain('"Heat A1" has already completed Race 2');
    expect(text).toContain('score Race 3 anyway');
  });

  it('lists the unmatched sails and what to do', () => {
    const text = unmatchedSailsMessage('Heat A1', [12, 'ITA 7']);
    expect(text).toContain('not in Heat A1: 12, ITA 7.');
    expect(text).toContain('3) Re-enter the race results');
  });

  it('names the rounds that block the undo', () => {
    expect(laterRoundBlocksUndoMessage(['Heat A2', 'Heat A3'])).toContain(
      'The next round (Heat A2, Heat A3)',
    );
  });
});
