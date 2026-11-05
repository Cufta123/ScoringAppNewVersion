import {
  RESULT_CODES,
  RDG_TYPES,
  getRaceCellDisplay,
} from '../renderer/utils/leaderboardUtils';

describe('A10 status codes coverage', () => {
  it('includes additional A10 abbreviations used by scoring', () => {
    expect(RESULT_CODES).toContain('ZFP');
    expect(RESULT_CODES).toContain('T1');
    expect(RESULT_CODES).toContain('SCP');
    // RAF is not a 2025-2028 code (A10); stored RAF is read as RET.
    expect(RESULT_CODES).not.toContain('RAF');
    expect(RESULT_CODES).toContain('DGM');
    expect(RESULT_CODES).toContain('DPI');
  });

  // Pin the full supported vocabulary (AGENTS.md §5 / SHRS 2026-1 §5.3) so a
  // status silently dropped from this list (which would mis-classify it as a
  // plain finish rather than a penalty in getRaceCellDisplay) gets caught.
  it('carries the complete SHRS/RRS status vocabulary, excluding FINISHED', () => {
    expect(RESULT_CODES).toEqual(
      expect.arrayContaining([
        'DNF',
        'DNS',
        'DSQ',
        'OCS',
        'ZFP',
        'T1',
        'RET',
        'SCP',
        'BFD',
        'UFD',
        'DNC',
        'NSC',
        'WTH',
        'DNE',
        'DGM',
        'DPI',
        'RDG1',
        'RDG2',
        'RDG3',
      ]),
    );
    expect(RESULT_CODES).not.toContain('FINISHED');
  });

  it('lists exactly the three RDG variants', () => {
    expect(RDG_TYPES).toEqual(['RDG1', 'RDG2', 'RDG3']);
  });
});

describe('getRaceCellDisplay status classification', () => {
  const nonRdgPenalties = [...RESULT_CODES].filter(
    (code) => !RDG_TYPES.includes(code),
  );

  it.each(nonRdgPenalties)(
    'classifies %s as a penalty, not an RDG cell',
    (status) => {
      const { isPenalty, isRdgCell } = getRaceCellDisplay('5', status);
      expect(isPenalty).toBe(true);
      expect(isRdgCell).toBe(false);
    },
  );

  // RDG1/2/3 are also members of RESULT_CODES, so isPenalty is true for
  // them too. getRaceCellDisplay checks isRdgCell FIRST, so the RDG display
  // branch still wins regardless.
  it.each([...RDG_TYPES])(
    'classifies %s as an RDG cell, and the RDG branch wins the display text',
    (status) => {
      const { isPenalty, isRdgCell, displayText } = getRaceCellDisplay(
        '4.5',
        status,
      );
      expect(isPenalty).toBe(true);
      expect(isRdgCell).toBe(true);
      expect(displayText).toBe('RDG (4.5)');
    },
  );

  it('classifies FINISHED as neither a penalty nor an RDG cell', () => {
    const { isPenalty, isRdgCell } = getRaceCellDisplay('3', 'FINISHED');
    expect(isPenalty).toBe(false);
    expect(isRdgCell).toBe(false);
  });

  // M9 (RRS A10): DPI carries a protest-committee-set numeric score, so it is
  // displayed WITH its number ("DPI (5)"), like RDG — not as a bare code.
  it('shows the DPI number in the cell display (RRS A10 / M9)', () => {
    const { displayText, isPenalty } = getRaceCellDisplay('5', 'DPI');
    expect(displayText).toBe('DPI (5)');
    expect(isPenalty).toBe(true);
  });

  it('shows an excluded DPI cell with its number', () => {
    const { displayText, isExcluded } = getRaceCellDisplay('(5)', 'DPI');
    expect(displayText).toBe('(DPI (5))');
    expect(isExcluded).toBe(true);
  });
});
