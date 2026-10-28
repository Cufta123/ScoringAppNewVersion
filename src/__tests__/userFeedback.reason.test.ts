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
