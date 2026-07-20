/* eslint-disable camelcase */
/**
 * Unit tests for the pure score-status helpers extracted from
 * HeatRaceHandler into src/main/functions/scoreStatus.ts. These encode SHRS
 * 5.3 recording order and the RRS 44.3(c)/T1 scoring-penalty math, so they are
 * worth pinning down independently of the IPC layer.
 */
import {
  SeededRow,
  appendixFallbackStatusOrder,
  buildAlphanumericKey,
  compareSeededRows,
  deriveNonFinisherPoints,
  getHeatBaseFromName,
  getScoringPenaltyPoints,
  normalizeScoreStatus,
  normalizeStatus,
  roundHalfUp,
  shrsPrimaryStatusOrder,
  statusOrder,
} from '../main/functions/scoreStatus';

describe('normalizeScoreStatus', () => {
  it('defaults blank or non-string input to FINISHED', () => {
    expect(normalizeScoreStatus('')).toBe('FINISHED');
    expect(normalizeScoreStatus('   ')).toBe('FINISHED');
    expect(normalizeScoreStatus(undefined)).toBe('FINISHED');
    expect(normalizeScoreStatus(null)).toBe('FINISHED');
    expect(normalizeScoreStatus(42)).toBe('FINISHED');
  });

  it('trims and upper-cases recognised statuses', () => {
    expect(normalizeScoreStatus(' dnf ')).toBe('DNF');
    expect(normalizeScoreStatus('zfp')).toBe('ZFP');
    expect(normalizeScoreStatus('RDG2')).toBe('RDG2');
  });

  it('maps the RAF alias to RET', () => {
    expect(normalizeScoreStatus('raf')).toBe('RET');
  });

  it('keeps FINISHED explicit', () => {
    expect(normalizeScoreStatus('finished')).toBe('FINISHED');
  });

  it('throws on an unsupported status', () => {
    expect(() => normalizeScoreStatus('NOPE')).toThrow(
      'Unsupported score status: NOPE',
    );
  });

  // Full supported vocabulary (AGENTS.md §5): every penalty status, plus the
  // position-keeping penalties and RDG variants, must normalise cleanly
  // regardless of case/whitespace. Each of these was previously exercised only
  // indirectly (if at all) — pin every code the app claims to support.
  it.each([
    'DNF',
    'DNS',
    'DSQ',
    'OCS',
    'ZFP',
    'RET',
    'SCP',
    'T1',
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
  ])('normalises %s (including lower-case + padding)', (status) => {
    expect(normalizeScoreStatus(status)).toBe(status);
    expect(normalizeScoreStatus(status.toLowerCase())).toBe(status);
    expect(normalizeScoreStatus(`  ${status}  `)).toBe(status);
  });
});

describe('normalizeStatus', () => {
  it('returns empty string for non-strings', () => {
    expect(normalizeStatus(undefined)).toBe('');
    expect(normalizeStatus(null)).toBe('');
    expect(normalizeStatus(7)).toBe('');
  });

  it('trims, upper-cases and maps RAF to RET', () => {
    expect(normalizeStatus('  dnf ')).toBe('DNF');
    expect(normalizeStatus('raf')).toBe('RET');
  });

  it('does not validate against the allowed set', () => {
    expect(normalizeStatus('whatever')).toBe('WHATEVER');
  });
});

describe('roundHalfUp', () => {
  it('rounds a clean half upward', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(3.5)).toBe(4);
  });

  it('rounds normally otherwise', () => {
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(2.6)).toBe(3);
    expect(roundHalfUp(4)).toBe(4);
  });
});

describe('getScoringPenaltyPoints', () => {
  it('applies 20% of the fleet for ZFP/SCP (RRS 44.3c)', () => {
    // 20% of 20 = 4 places added.
    expect(getScoringPenaltyPoints(5, 20, 'ZFP')).toBe(9);
    expect(getScoringPenaltyPoints(5, 20, 'SCP')).toBe(9);
    expect(getScoringPenaltyPoints(5, 20)).toBe(9);
  });

  it('applies 30% of the fleet for T1', () => {
    // 30% of 20 = 6 places added.
    expect(getScoringPenaltyPoints(5, 20, 'T1')).toBe(11);
  });

  it('rounds the penalty places half-up', () => {
    // 20% of 15 = 3.0; 20% of 13 = 2.6 -> 3.
    expect(getScoringPenaltyPoints(1, 15, 'ZFP')).toBe(4);
    expect(getScoringPenaltyPoints(1, 13, 'ZFP')).toBe(4);
  });

  it('never exceeds maxBoats + 1', () => {
    expect(getScoringPenaltyPoints(19, 20, 'T1')).toBe(21);
    expect(getScoringPenaltyPoints(20, 20, 'ZFP')).toBe(21);
  });

  it('bases the penalty on the DNF score (largest heat + 1), not the heat size', () => {
    // RRS 44.3(c) via SHRS 5.2: DNF score = 12 + 1 = 13; 20% of 13 = 2.6 -> 3.
    // A base of maxBoats (12) would give 20% of 12 = 2.4 -> 2 and score 7.
    expect(getScoringPenaltyPoints(5, 12, 'ZFP')).toBe(8);
    // T1: DNF score = 11 + 1 = 12; 30% of 12 = 3.6 -> 4; 5 + 4 = 9.
    // A base of 11 would give 30% of 11 = 3.3 -> 3 and score 8.
    expect(getScoringPenaltyPoints(5, 11, 'T1')).toBe(9);
  });
});

describe('deriveNonFinisherPoints (SHRS 5.2 re-derivation)', () => {
  it('scores DNF-class statuses as largest heat + 1', () => {
    expect(deriveNonFinisherPoints('DNS', 21, 20)).toBe(21);
    expect(deriveNonFinisherPoints('DNF', 5, 20)).toBe(21);
    expect(deriveNonFinisherPoints('DSQ', 5, 20)).toBe(21);
    expect(deriveNonFinisherPoints('DNC', 5, 12)).toBe(13);
  });

  // The rest of the SHRS 5.3 displacement list (and the appendix-only DGM)
  // shares the same "largest heat + 1" rule as DNF/DNS/DSQ/DNC above — every
  // one of these was previously untested for deriveNonFinisherPoints even
  // though the source treats them identically via `penaltyStatuses`.
  it.each(['RET', 'OCS', 'BFD', 'UFD', 'NSC', 'WTH', 'DNE', 'DGM'])(
    'scores %s as largest heat + 1',
    (status) => {
      expect(deriveNonFinisherPoints(status, 5, 12)).toBe(13);
    },
  );

  it('scores ZFP/SCP/T1 from the finishing place and the DNF-score base', () => {
    // 3 + roundHalfUp(0.2 * (20 + 1)) = 3 + 4 = 7.
    expect(deriveNonFinisherPoints('ZFP', 3, 20)).toBe(7);
    expect(deriveNonFinisherPoints('SCP', 3, 20)).toBe(7);
    // 3 + roundHalfUp(0.3 * 21) = 3 + 6 = 9.
    expect(deriveNonFinisherPoints('T1', 3, 20)).toBe(9);
  });

  it('leaves FINISHED and RDG scores alone (returns null)', () => {
    expect(deriveNonFinisherPoints('FINISHED', 4, 20)).toBeNull();
    expect(deriveNonFinisherPoints('RDG1', 4, 20)).toBeNull();
    expect(deriveNonFinisherPoints('RDG2', 4, 20)).toBeNull();
    expect(deriveNonFinisherPoints('RDG3', 4, 20)).toBeNull();
  });

  // M9 (docs/SCORING_AUDIT.md, fixed): DPI (RRS A10 discretionary penalty
  // imposed by the protest committee) must NOT be auto-scored as largest-heat+1
  // like DSQ. Its points are PC-set, so `deriveNonFinisherPoints` returns null
  // (keep the stored value) — the same treatment as RDG. The write path
  // (`applyRaceResultUpdate`) likewise keeps the frontend-provided value, and
  // the leaderboard edit flow provides the points-entry field.
  it('does NOT auto-score DPI as largest-heat + 1 — points are protest-committee-set (RRS A10)', () => {
    expect(deriveNonFinisherPoints('DPI', 5, 20)).toBeNull();
  });
});

describe('buildAlphanumericKey', () => {
  it('upper-cases and joins country and sail number', () => {
    expect(buildAlphanumericKey('cro', 12)).toBe('CRO-12');
    expect(buildAlphanumericKey('Aus', 'a7')).toBe('AUS-A7');
  });

  it('tolerates null/undefined parts', () => {
    expect(buildAlphanumericKey(null, undefined)).toBe('-');
  });
});

describe('getHeatBaseFromName', () => {
  it('extracts the base letters from a heat name', () => {
    expect(getHeatBaseFromName('Heat A')).toBe('A');
    expect(getHeatBaseFromName('Heat AB2')).toBe('AB');
  });

  it('throws on an unrecognised heat name', () => {
    expect(() => getHeatBaseFromName('Group 1')).toThrow(
      'Invalid heat name format: Group 1',
    );
  });
});

describe('compareSeededRows (SHRS 5.3 ordering)', () => {
  const row = (over: Partial<SeededRow>): SeededRow => ({
    position: null,
    status: 'FINISHED',
    country: 'CRO',
    sail_number: 1,
    ...over,
  });

  it('orders finishers by finishing position', () => {
    const a = row({ position: 1, sail_number: 1 });
    const b = row({ position: 2, sail_number: 2 });
    expect(compareSeededRows(a, b)).toBeLessThan(0);
    expect(compareSeededRows(b, a)).toBeGreaterThan(0);
  });

  it('ranks any finisher ahead of any penalised boat', () => {
    const finisher = row({ position: 10 });
    const penalised = row({ status: 'DNF' });
    expect(compareSeededRows(finisher, penalised)).toBeLessThan(0);
    expect(compareSeededRows(penalised, finisher)).toBeGreaterThan(0);
  });

  it('orders penalised boats by SHRS displacement rank', () => {
    // DNF ranks ahead of DNE in statusOrder.
    const dnf = row({ status: 'DNF', sail_number: 9 });
    const dne = row({ status: 'DNE', sail_number: 1 });
    expect(compareSeededRows(dnf, dne)).toBeLessThan(0);
  });

  it('breaks ties on the alphanumeric sail key', () => {
    const a = row({ status: 'DNF', country: 'AUS', sail_number: 5 });
    const b = row({ status: 'DNF', country: 'CRO', sail_number: 5 });
    expect(compareSeededRows(a, b)).toBeLessThan(0);
  });

  it('breaks same-country ties by NUMERICAL sail number (SHRS 5.3 / rule 3)', () => {
    // Sail 9 must sort ahead of sail 10; a string compare would invert them.
    const sail9 = row({ status: 'DNF', country: 'CRO', sail_number: 9 });
    const sail10 = row({ status: 'DNF', country: 'CRO', sail_number: 10 });
    expect(compareSeededRows(sail9, sail10)).toBeLessThan(0);
    expect(compareSeededRows(sail10, sail9)).toBeGreaterThan(0);

    // National letter still takes precedence over the sail number.
    const cro2 = row({ status: 'DNF', country: 'CRO', sail_number: 2 });
    const ger1 = row({ status: 'DNF', country: 'GER', sail_number: 1 });
    expect(compareSeededRows(cro2, ger1)).toBeLessThan(0);
  });

  it('treats appendix-only statuses as ranked after SHRS statuses', () => {
    expect(statusOrder.indexOf('DGM')).toBeGreaterThan(
      statusOrder.indexOf('DNE'),
    );
  });

  it('pins the exact SHRS 5.3 text order: DNF, RET, NSC, OCS, DNS, DNC, WTH, UFD, BFD, DSQ, DNE', () => {
    // docs/SHRS-2026-1.md §5.3 / AGENTS.md §5: "Boats shall be recorded in the
    // order of their finishing place in the heat and then... DNF, RET, NSC,
    // OCS, DNS, DNC, WTH..., UFD, BFD, DSQ or DNE." A silent reorder here would
    // change 5.3 recording order and next-round seeding without any other test
    // noticing, since the other tests only check relative pairs.
    expect(shrsPrimaryStatusOrder).toEqual([
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
    // Appendix-only codes (not named in SHRS 5.3 text) are appended last, in a
    // stable order, so they still sort deterministically.
    expect(appendixFallbackStatusOrder).toEqual(['DGM', 'DPI']);
  });

  it('walks the full SHRS 5.3 displacement order end-to-end via compareSeededRows', () => {
    // Every adjacent pair in the official order must compare as "earlier
    // recorded" (lower rank), not just the DNF/DNE pair already covered above.
    for (let i = 0; i < shrsPrimaryStatusOrder.length - 1; i += 1) {
      const earlier = row({
        status: shrsPrimaryStatusOrder[i],
        sail_number: 1,
      });
      const later = row({
        status: shrsPrimaryStatusOrder[i + 1],
        sail_number: 1,
      });
      expect(compareSeededRows(earlier, later)).toBeLessThan(0);
      expect(compareSeededRows(later, earlier)).toBeGreaterThan(0);
    }
  });

  it('ranks DGM ahead of DPI among the appendix-fallback statuses', () => {
    const dgm = row({ status: 'DGM', sail_number: 1 });
    const dpi = row({ status: 'DPI', sail_number: 1 });
    expect(compareSeededRows(dgm, dpi)).toBeLessThan(0);
  });

  describe('position-keeping penalties (ZFP/SCP/T1) keep finishing place — SHRS 5.3', () => {
    // ZFP/SCP/T1 are deliberately NOT in statusRankMap (statusOrder only lists
    // the displaced statuses), so compareSeededRows treats them as ordinary
    // "finishers" sorted by their recorded position field, never displaced to
    // the back with DNF/DSQ/etc.
    it.each(['ZFP', 'SCP', 'T1'])(
      '%s outranks a displaced non-finisher regardless of position value',
      (status) => {
        // Position-keeping boat finished (worse) 15th; a DNF boat has no
        // meaningful position. The penalty boat must still sort ahead because
        // it keeps its finishing place rather than being displaced.
        const penalised = row({ status, position: 15, sail_number: 1 });
        const displaced = row({ status: 'DNF', sail_number: 2 });
        expect(compareSeededRows(penalised, displaced)).toBeLessThan(0);
        expect(compareSeededRows(displaced, penalised)).toBeGreaterThan(0);
      },
    );

    it.each(['ZFP', 'SCP', 'T1'])(
      '%s sorts by its own finishing position among other position-keeping/finished boats',
      (status) => {
        const better = row({ status, position: 3, sail_number: 1 });
        const worse = row({ status: 'FINISHED', position: 5, sail_number: 2 });
        expect(compareSeededRows(better, worse)).toBeLessThan(0);
        expect(compareSeededRows(worse, better)).toBeGreaterThan(0);
      },
    );
  });
});
