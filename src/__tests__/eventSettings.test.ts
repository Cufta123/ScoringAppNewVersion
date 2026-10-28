import {
  HEAT_OVERFLOW_POLICIES,
  QUALIFYING_ASSIGNMENT_MODES,
  normalizeHeatOverflowPolicy,
  normalizeQualifyingAssignmentMode,
} from '../shared/eventSettings';

describe('normalizeQualifyingAssignmentMode', () => {
  it('keeps every allowed mode', () => {
    QUALIFYING_ASSIGNMENT_MODES.forEach((mode) => {
      expect(normalizeQualifyingAssignmentMode(mode)).toBe(mode);
    });
  });

  it('ignores case and surrounding spaces', () => {
    expect(normalizeQualifyingAssignmentMode('  Pre-Assigned ')).toBe(
      'pre-assigned',
    );
  });

  it.each([undefined, null, '', 'random', 7])(
    'falls back to progressive for %p',
    (value) => {
      expect(normalizeQualifyingAssignmentMode(value)).toBe('progressive');
    },
  );
});

describe('normalizeHeatOverflowPolicy', () => {
  it('keeps every allowed policy', () => {
    HEAT_OVERFLOW_POLICIES.forEach((policy) => {
      expect(normalizeHeatOverflowPolicy(policy)).toBe(policy);
    });
  });

  it('ignores case and surrounding spaces', () => {
    expect(normalizeHeatOverflowPolicy(' CONFIRM-allow-oversize')).toBe(
      'confirm-allow-oversize',
    );
  });

  it.each([undefined, null, '', 'allow', {}])(
    'falls back to auto-increase for %p',
    (value) => {
      expect(normalizeHeatOverflowPolicy(value)).toBe('auto-increase');
    },
  );
});
