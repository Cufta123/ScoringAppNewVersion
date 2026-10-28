/** @jest-environment jsdom */
import { plainReason } from '../renderer/utils/userFeedback';

jest.mock('react-toastify', () => ({ toast: { error: jest.fn() } }));

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
    expect(toast.error.mock.calls[0][0]).toBe(
      'Could not create heats.\nNo boats are registered for this event yet.',
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it('never leaves a fault in the app unexplained: a code, also in the log', () => {
    reportError(
      'Could not save race scores.',
      new TypeError("Cannot read properties of undefined (reading 'x')"),
    );
    const shown: string = toast.error.mock.calls[0][0];
    expect(shown).toMatch(
      /^Could not save race scores\.\nThe app ran into an unexpected problem/,
    );
    const ref = shown.match(/note the code (\w+)/)?.[1];
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
