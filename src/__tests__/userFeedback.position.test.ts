/** @jest-environment jsdom */
import { toast } from 'react-toastify';
import { reportWarning, toastPosition } from '../renderer/utils/userFeedback';

jest.mock('react-toastify', () => ({
  toast: {
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    isActive: jest.fn(() => false),
    update: jest.fn(),
  },
}));

describe('toast placement per screen', () => {
  afterEach(() => {
    window.location.hash = '';
    jest.clearAllMocks();
  });

  it.each([
    ['#/', 'bottom-left'],
    ['#/event/Euro%202026', 'bottom-left'],
    ['#/event/Euro%202026/leaderboard', 'bottom-left'],
    ['#/event/Euro%202026/heat-race', 'bottom-right'],
    ['#/event/Euro%202026/heat-race?heat=A1', 'bottom-right'],
  ])('%s -> %s', (hash, expected) => {
    window.location.hash = hash;
    expect(toastPosition()).toBe(expected);
  });

  it('every toast carries the position of the screen it is shown on', () => {
    window.location.hash = '#/event/E/heat-race';
    reportWarning('Not all boats are scored', 'Please check', { inline: true });
    expect(toast.warning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ position: 'bottom-right' }),
    );

    window.location.hash = '#/event/E/leaderboard';
    reportWarning('Another', 'Please check');
    expect(toast.warning).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ position: 'bottom-left' }),
    );
  });
});
