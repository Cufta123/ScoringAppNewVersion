/** @jest-environment jsdom */
import { plainReason } from '../renderer/utils/userFeedback';

jest.mock('react-toastify', () => ({
  toast: {
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    isActive: jest.fn(() => false),
    update: jest.fn(),
  },
}));

describe('plainReason: what a refusal tells the race officer', () => {
  it('shows the reason the main process gave, without the IPC wrapping', () => {
    expect(
      plainReason(
        new Error(
          "Error invoking remote method 'createNewHeatsBasedOnLeaderboard': Error: Heat B3 has not raced yet. Score the current round before creating the next one.",
        ),
      ),
    ).toBe(
      'Heat B3 has not raced yet. Score the current round before creating the next one.',
    );
  });

  it.each([
    'SQLITE_BUSY: database is locked',
    'FOREIGN KEY constraint failed',
    "TypeError: Cannot read properties of undefined (reading 'x')",
    'Position for FINISHED must be a positive integer (received null).',
    'Operation failed: heatRaceDB.insertScore',
  ])('hides a technical message: %s', (message) => {
    expect(plainReason(new Error(message))).toBeNull();
  });
});

/** The title and body of the first toast a mock was asked to show. */
const shownProps = (mock: jest.Mock, call = 0) => {
  const element = mock.mock.calls[call][0];
  return { title: element.props.title, body: element.props.body };
};

describe('reportError: what the toast says', () => {
  // eslint-disable-next-line global-require
  const { toast } = require('react-toastify');
  // eslint-disable-next-line global-require
  const {
    reportError,
    describeError,
  } = require('../renderer/utils/userFeedback');
  const logError = jest.fn();

  beforeEach(() => {
    toast.error.mockClear();
    logError.mockClear();
    (window as any).electron = { appEvents: { logError } };
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    delete (window as any).electron;
    jest.restoreAllMocks();
  });

  it('says what failed and why, for a refusal', () => {
    reportError(
      'Could not create heats.',
      new Error(
        "Error invoking remote method 'createInitialHeatsAtomic': Error: No boats are registered for this event yet.",
      ),
    );
    expect(shownProps(toast.error)).toEqual({
      title: 'Could not create heats.',
      body: 'No boats are registered for this event yet.',
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('never leaves a fault in the app unexplained: a code, also in the log', () => {
    reportError(
      'Could not save race scores.',
      new TypeError("Cannot read properties of undefined (reading 'x')"),
    );
    const { title, body } = shownProps(toast.error);
    expect(title).toBe('Could not save race scores.');
    expect(body).toMatch(/^The app ran into an unexpected problem/);
    const ref = body.match(/note the code (\w+)/)?.[1];
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        ref,
        message: "Cannot read properties of undefined (reading 'x')",
      }),
    );
  });

  it('still explains when the log is not reachable', () => {
    delete (window as any).electron;
    expect(describeError(new RangeError('bad'))).toMatch(/unexpected problem/);
  });
});

describe('toasts: bold title over the body, never duplicated', () => {
  // eslint-disable-next-line global-require
  const { toast } = require('react-toastify');
  // eslint-disable-next-line global-require
  const feedback = require('../renderer/utils/userFeedback');

  beforeEach(() => {
    Object.values<jest.Mock>(toast).forEach((fn) => fn.mockClear());
    toast.isActive.mockReturnValue(false);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps title and body apart instead of gluing them into one sentence', () => {
    feedback.reportInfo(
      'Your leaderboard changes have been saved.',
      'Leaderboard saved',
    );
    expect(shownProps(toast.info)).toEqual({
      title: 'Leaderboard saved',
      body: 'Your leaderboard changes have been saved.',
    });
  });

  it('keeps line breaks of a multi-line body', () => {
    feedback.reportWarning('1) one\n2) two', 'Steps');
    expect(shownProps(toast.warning).body).toBe('1) one\n2) two');
  });

  it('gives identical toasts the same id, different ones different ids', () => {
    const a = feedback.toastKey('warning', 'Title', 'Body');
    expect(feedback.toastKey('warning', 'Title', 'Body')).toBe(a);
    expect(feedback.toastKey('error', 'Title', 'Body')).not.toBe(a);
    expect(feedback.toastKey('warning', 'Title', 'Other')).not.toBe(a);
    expect(feedback.toastKey('warning', 'Other', 'Body')).not.toBe(a);
    // "A|B" + "" must not collide with "A" + "B"
    expect(feedback.toastKey('warning', 'A', 'B')).not.toBe(
      feedback.toastKey('warning', 'AB', ''),
    );
  });

  it('shows a repeated warning once: the second call refreshes the toast on screen', () => {
    feedback.reportWarning(
      'Still missing: sail 102.',
      'Some boats are not scored yet',
    );
    const { toastId } = toast.warning.mock.calls[0][1];
    expect(toastId).toBe(
      feedback.toastKey(
        'warning',
        'Some boats are not scored yet',
        'Still missing: sail 102.',
      ),
    );

    toast.isActive.mockImplementation((id: string) => id === toastId);
    feedback.reportWarning(
      'Still missing: sail 102.',
      'Some boats are not scored yet',
    );
    feedback.reportWarning(
      'Still missing: sail 102.',
      'Some boats are not scored yet',
    );

    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.update).toHaveBeenCalledTimes(2);
    expect(toast.update.mock.calls[0][0]).toBe(toastId);
  });

  it('shows the same text again once the first toast was dismissed', () => {
    feedback.reportInfo('Saved.', 'Done');
    feedback.reportInfo('Saved.', 'Done');
    expect(toast.info).toHaveBeenCalledTimes(2);
  });

  it('honours an explicit toast id', () => {
    feedback.reportWarning('x', 'y', { toastId: 'automatic-backup-status' });
    expect(toast.warning.mock.calls[0][1].toastId).toBe(
      'automatic-backup-status',
    );
  });

  it('keeps errors and warnings on screen until dismissed, infos not', () => {
    feedback.reportWarning('x', 'y');
    feedback.reportError('z', new Error('Plain refusal.'));
    feedback.reportInfo('x', 'y');
    expect(toast.warning.mock.calls[0][1].autoClose).toBe(false);
    expect(toast.error.mock.calls[0][1].autoClose).toBe(false);
    expect(toast.info.mock.calls[0][1].autoClose).toBeUndefined();
  });
});
