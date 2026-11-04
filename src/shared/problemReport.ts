/**
 * A problem report sent from inside the app (Help > Report a problem).
 *
 * The window collects the form; the main process adds what helps to solve
 * the problem (the event's data, its change history, the error log, a
 * screenshot and the computer's details), keeps the report in an outbox on
 * disk and sends it to the report service, which e-mails it to the
 * developer. One definition of the form and its rules for both processes.
 */

export const PROBLEM_KINDS = [
  { value: 'wrong-results', label: 'Wrong results, points or places' },
  { value: 'error-message', label: 'An error message appeared' },
  { value: 'cannot-do', label: 'I cannot do something I need' },
  { value: 'froze', label: 'The app froze, closed or went blank' },
  { value: 'export-print', label: 'Export, PDF or printing' },
  { value: 'other', label: 'Something else' },
] as const;

export const APP_AREAS = [
  { value: 'events', label: 'Event list (home page)' },
  { value: 'entries', label: 'Event page: sailors and entries' },
  { value: 'heats', label: 'Event page: heats' },
  { value: 'scoring', label: 'Scoring a race' },
  { value: 'leaderboard', label: 'Leaderboard and corrections' },
  { value: 'final-series', label: 'Final Series' },
  { value: 'exports', label: 'Exports and printing' },
  { value: 'history', label: 'History and undo' },
  { value: 'other', label: 'Somewhere else' },
] as const;

export type ProblemKind = (typeof PROBLEM_KINDS)[number]['value'];
export type AppArea = (typeof APP_AREAS)[number]['value'];

export interface ProblemReportForm {
  kind: ProblemKind | '';
  area: AppArea | '';
  /** When it happened, as the date/time field gives it: "2026-11-04T14:30". */
  happenedAt: string;
  /** What went wrong. The one field that must be filled in. */
  problem: string;
  /** What the user was doing just before. */
  doing: string;
  /** What the user expected instead. */
  expected: string;
  reporterName: string;
  /** Phone or e-mail for a reply. */
  reporterContact: string;
}

/** What the report carries besides the form; each can be switched off. */
export interface ProblemReportIncludes {
  /** The event's data: entries, heats, races, scores, standings. */
  snapshot: boolean;
  /** The event's change history. */
  history: boolean;
  /** The app's error log. */
  errorLog: boolean;
  /** A picture of the window and the computer's details. */
  screenshot: boolean;
}

/** Where the user was when they opened the form. */
export interface ProblemReportContext {
  /** The page's route, e.g. "#/event/Cup/leaderboard". */
  route: string;
  /** The event open on the page, if any. */
  eventId: number | null;
  /** Inner size of the window, "1366x705". */
  windowSize: string;
}

export interface ProblemReportRequest {
  form: ProblemReportForm;
  includes: ProblemReportIncludes;
  context: ProblemReportContext;
  /** The JPEG data URL taken before the form opened, or null. */
  screenshot: string | null;
}

export type ProblemReportResult =
  | { status: 'sent'; reportId: string }
  /** Saved on this computer; sent automatically when the service answers. */
  | { status: 'queued'; reportId: string; reason: string };

/** Longest text kept per field, so a pasted log cannot make the mail huge. */
export const FIELD_MAX_CHARS = 5000;
export const SHORT_FIELD_MAX_CHARS = 200;

export type ProblemReportErrors = Partial<
  Record<keyof ProblemReportForm, string>
>;

const isKnown = <T extends { value: string }>(
  list: readonly T[],
  value: string,
): boolean => list.some((item) => item.value === value);

/** "2026-11-04T14:30" (seconds allowed), a real date and time. */
const isDateTime = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) &&
  !Number.isNaN(new Date(value).getTime());

/**
 * What is wrong with the form, field by field, in words for the user; an
 * empty object when it can be sent. The main process checks it again.
 */
export function validateProblemReportForm(
  form: Partial<ProblemReportForm>,
): ProblemReportErrors {
  const errors: ProblemReportErrors = {};
  const text = (value: unknown) => String(value ?? '').trim();

  if (!isKnown(PROBLEM_KINDS, text(form.kind))) {
    errors.kind = 'Choose what kind of problem it is.';
  }
  if (!isKnown(APP_AREAS, text(form.area))) {
    errors.area = 'Choose where in the app it happened.';
  }
  if (!isDateTime(text(form.happenedAt))) {
    errors.happenedAt = 'Enter the date and time it happened.';
  }
  const problem = text(form.problem);
  if (problem.length < 10) {
    errors.problem =
      'Describe what went wrong in a sentence or two (at least 10 letters).';
  } else if (problem.length > FIELD_MAX_CHARS) {
    errors.problem = `Keep this under ${FIELD_MAX_CHARS} characters.`;
  }
  (['doing', 'expected'] as const).forEach((field) => {
    if (text(form[field]).length > FIELD_MAX_CHARS) {
      errors[field] = `Keep this under ${FIELD_MAX_CHARS} characters.`;
    }
  });
  (['reporterName', 'reporterContact'] as const).forEach((field) => {
    if (text(form[field]).length > SHORT_FIELD_MAX_CHARS) {
      errors[field] = `Keep this under ${SHORT_FIELD_MAX_CHARS} characters.`;
    }
  });
  return errors;
}

/** The form as it is sent: every field a trimmed string. */
export function cleanProblemReportForm(
  form: Partial<ProblemReportForm>,
): ProblemReportForm {
  const text = (value: unknown) => String(value ?? '').trim();
  return {
    kind: text(form.kind) as ProblemKind,
    area: text(form.area) as AppArea,
    happenedAt: text(form.happenedAt),
    problem: text(form.problem),
    doing: text(form.doing),
    expected: text(form.expected),
    reporterName: text(form.reporterName),
    reporterContact: text(form.reporterContact),
  };
}

/** The area the form starts on, from the page the user was on. */
export function areaForRoute(route: string): AppArea {
  const path = route.replace(/^#/, '');
  if (/\/heat-race\/?$/.test(path)) return 'scoring';
  if (/\/leaderboard\/?$/.test(path)) return 'leaderboard';
  if (/^\/event\//.test(path)) return 'entries';
  if (path === '' || path === '/') return 'events';
  return 'other';
}

export const labelOf = (
  list: readonly { value: string; label: string }[],
  value: string,
): string => list.find((item) => item.value === value)?.label ?? value;

/**
 * A short reference the user can quote ("R-4K2M9Q"), unique enough for one
 * developer's inbox: time in base 36 plus random letters.
 */
export function newReportId(now = Date.now(), random = Math.random): string {
  const time = now.toString(36).slice(-5).toUpperCase();
  const tail = Math.floor(random() * 36 ** 3)
    .toString(36)
    .padStart(3, '0')
    .toUpperCase();
  return `R-${time}${tail}`;
}

export const REPORT_ID_PATTERN = /^R-[0-9A-Z]{8}$/;
