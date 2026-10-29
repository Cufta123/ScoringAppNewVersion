/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SailorList from '../renderer/components/SailorList';
import { confirmAction } from '../renderer/utils/userFeedback';

jest.mock(
  'react-world-flags',
  () =>
    function FlagMock() {
      return <span data-testid="flag" />;
    },
);
jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn(),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

const sailors = [
  {
    boat_id: 1,
    country: 'CRO',
    sail_number: '100',
    model: 'IOM',
    name: 'Ana',
    surname: 'A',
    club: 'YC',
    category: 'SENIOR',
  },
  {
    boat_id: 2,
    country: 'ITA',
    sail_number: '200',
    model: 'IOM',
    name: 'Ben',
    surname: 'B',
    club: 'YC',
    category: 'SENIOR',
  },
];

// Switching to another row while the open row has typed changes used to throw
// them away without a word. It asks first, and only when something changed.
describe('SailorList: switching rows with an unsaved edit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.electron = {
      sqlite: {
        sailorDB: {
          readAllCategories: jest.fn().mockResolvedValue([]),
          updateSailor: jest.fn(),
        },
      },
    };
    render(
      <SailorList
        sailors={sailors}
        onRefreshSailors={jest.fn()}
        onRemoveBoat={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Edit Ana A'));
  });

  it('switches silently when nothing was changed', async () => {
    fireEvent.click(screen.getByLabelText('Edit Ben B'));
    await waitFor(() =>
      expect(screen.getByLabelText('Save changes for Ben B')).toBeVisible(),
    );
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('asks first when something was changed, and keeps editing on "keep"', async () => {
    confirmAction.mockResolvedValue(false);
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: 'Anka' },
    });
    fireEvent.click(screen.getByLabelText('Edit Ben B'));

    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringContaining('not saved'),
      'Discard unsaved changes',
      expect.objectContaining({
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      }),
    );
    // Still editing Ana, typed text intact.
    expect(screen.getByLabelText('Save changes for Ana A')).toBeVisible();
    expect(screen.getByLabelText('First name')).toHaveValue('Anka');
  });

  it('moves to the other row when the changes are discarded', async () => {
    confirmAction.mockResolvedValue(true);
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: 'Anka' },
    });
    fireEvent.click(screen.getByLabelText('Edit Ben B'));

    await waitFor(() =>
      expect(screen.getByLabelText('Save changes for Ben B')).toBeVisible(),
    );
    expect(screen.getByLabelText('First name')).toHaveValue('Ben');
  });
});
