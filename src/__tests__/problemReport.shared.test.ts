import {
  REPORT_ID_PATTERN,
  areaForRoute,
  cleanProblemReportForm,
  newReportId,
  validateProblemReportForm,
  type ProblemReportForm,
} from '../shared/problemReport';

const complete: ProblemReportForm = {
  kind: 'wrong-results',
  area: 'leaderboard',
  happenedAt: '2026-11-04T14:30',
  problem: 'The boats behind a DSQ did not move up.',
  doing: '',
  expected: '',
  reporterName: '',
  reporterContact: '',
};

describe('validateProblemReportForm', () => {
  it('accepts a complete form with the optional fields empty', () => {
    expect(validateProblemReportForm(complete)).toEqual({});
  });

  it('names every missing or wrong field', () => {
    const errors = validateProblemReportForm({
      kind: '',
      area: 'nowhere' as never,
      happenedAt: 'yesterday',
      problem: '   broken ',
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['area', 'happenedAt', 'kind', 'problem'].sort(),
    );
  });

  it('refuses text past the limits', () => {
    const errors = validateProblemReportForm({
      ...complete,
      problem: 'x'.repeat(5001),
      reporterName: 'y'.repeat(201),
    });
    expect(errors.problem).toMatch(/5000/);
    expect(errors.reporterName).toMatch(/200/);
  });

  it('refuses a date that does not exist', () => {
    expect(
      validateProblemReportForm({ ...complete, happenedAt: '2026-13-45T25:00' })
        .happenedAt,
    ).toBeDefined();
  });
});

describe('cleanProblemReportForm', () => {
  it('trims every field and fills missing ones', () => {
    expect(
      cleanProblemReportForm({
        ...complete,
        problem: '  x  ',
        doing: undefined,
      }),
    ).toMatchObject({ problem: 'x', doing: '' });
  });
});

describe('areaForRoute', () => {
  it('starts on the area of the page the user was on', () => {
    expect(areaForRoute('#/')).toBe('events');
    expect(areaForRoute('#/event/Cup')).toBe('entries');
    expect(areaForRoute('#/event/Cup/heat-race')).toBe('scoring');
    expect(areaForRoute('#/event/Cup/leaderboard')).toBe('leaderboard');
    expect(areaForRoute('#/somewhere')).toBe('other');
  });
});

describe('newReportId', () => {
  it('makes a short reference the service accepts', () => {
    const id = newReportId(Date.UTC(2026, 10, 4), () => 0.5);
    expect(id).toMatch(REPORT_ID_PATTERN);
    expect(newReportId()).not.toBe(newReportId(Date.now() + 1));
  });
});
