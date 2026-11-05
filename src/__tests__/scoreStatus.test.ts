/**
 * Reading a sent or stored status into the library's vocabulary
 * (src/main/functions/scoreStatus.ts). What each code scores, and the SHRS
 * 5.3 order, are regatta-core's (packages/regatta-core/test).
 */
import { normalizeScoreStatus } from '../main/functions/scoreStatus';

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
      '"NOPE" is not a result code this app knows.',
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
