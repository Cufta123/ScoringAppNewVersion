import { PENALTY_CODES } from '../renderer/utils/leaderboardUtils';

describe('A10 status codes coverage', () => {
  it('includes additional A10 abbreviations used by scoring', () => {
    expect(PENALTY_CODES).toContain('ZFP');
    expect(PENALTY_CODES).toContain('SCP');
    expect(PENALTY_CODES).toContain('DGM');
    expect(PENALTY_CODES).toContain('DPI');
  });
});
