/* eslint-disable camelcase */
/**
 * Unit tests for the pure score-status helpers extracted from
 * HeatRaceHandler into src/main/functions/scoreStatus.ts. These encode SHRS
 * 5.3 recording order and the RRS 44.3(c)/T1 scoring-penalty math, so they are
 * worth pinning down independently of the IPC layer.
 */
import {
  SeededRow,
  buildAlphanumericKey,
  compareSeededRows,
  getHeatBaseFromName,
  getScoringPenaltyPoints,
  normalizeScoreStatus,
  normalizeStatus,
  roundHalfUp,
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

  it('treats appendix-only statuses as ranked after SHRS statuses', () => {
    expect(statusOrder.indexOf('DGM')).toBeGreaterThan(
      statusOrder.indexOf('DNE'),
    );
  });
});
