import {
  APPENDIX_FALLBACK_PENALTY_ORDER,
  SHRS_PENALTY_ORDER,
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

  it('pins the exact SHRS 5.3 text order and position-keeping set', () => {
    // SHRS 2026-1 §5.3: "...DNF, RET, NSC, OCS, DNS, DNC, WTH..., UFD, BFD,
    // DSQ or DNE." Keep this renderer-side copy in lockstep with the main-
    // process order in scoreStatus.ts — a divergence here would make the
    // data-entry ordering disagree with the recorded scoring order.
    expect(SHRS_PENALTY_ORDER).toEqual([
      'DNF',
      'RET',
      'NSC',
      'OCS',
      'DNS',
      'DNC',
      'WTH',
      'UFD',
      'BFD',
      'DSQ',
      'DNE',
    ]);
    expect(APPENDIX_FALLBACK_PENALTY_ORDER).toEqual(['DGM', 'DPI']);
    expect([...POSITION_KEEPING_PENALTIES].sort()).toEqual(
      ['SCP', 'T1', 'ZFP'].sort(),
    );
  });

  it('walks the full SHRS 5.3 order end-to-end (every adjacent pair, not just DNF/DSQ)', () => {
    for (let i = 0; i < SHRS_PENALTY_ORDER.length - 1; i += 1) {
      expect(getPenaltyRank(SHRS_PENALTY_ORDER[i])).toBeLessThan(
        getPenaltyRank(SHRS_PENALTY_ORDER[i + 1]),
      );
    }
  });

  it('orders DGM ahead of DPI among the appendix-fallback (post-DNE) statuses', () => {
    const result = orderBoatsByPenalty(
      ['1', '2'],
      { 1: 'DPI', 2: 'DGM' },
      compareBoatNumbers,
    );
    expect(result).toEqual(['2', '1']);
  });

  it('keeps DNE displaced to the back rather than treating it as position-keeping', () => {
    // DNE is a mandatory-displacement status (SHRS 5.3 recording order), not a
    // position-keeping penalty like ZFP/SCP/T1 — it must NOT be in
    // POSITION_KEEPING_PENALTIES and must sort after a finisher.
    expect(POSITION_KEEPING_PENALTIES.has('DNE')).toBe(false);
    const result = orderBoatsByPenalty(
      ['1', '2'],
      { 2: 'DNE' },
      compareBoatNumbers,
    );
    expect(result).toEqual(['1', '2']);
  });
});
