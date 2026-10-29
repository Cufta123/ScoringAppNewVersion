/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SailorList from '../renderer/components/SailorList';
import { reportWarning } from '../renderer/utils/userFeedback';

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
];

describe('SailorList editing a boat', () => {
  let updateSailor;

  beforeEach(() => {
    jest.clearAllMocks();
    updateSailor = jest.fn().mockResolvedValue({ success: true });
    window.electron = {
      sqlite: {
        sailorDB: {
          readAllCategories: jest.fn().mockResolvedValue([]),
          updateSailor,
        },
      },
    };
  });

  const startEdit = () => {
    render(
      <SailorList
        sailors={sailors}
        onRefreshSailors={jest.fn()}
        onRemoveBoat={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Edit Ana A'));
  };

  it('refuses to save an emptied sail number and says why', async () => {
    startEdit();
    fireEvent.change(screen.getByLabelText('Sail number'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByLabelText('Save changes for Ana A'));

    await waitFor(() => expect(reportWarning).toHaveBeenCalled());
    expect(reportWarning).toHaveBeenCalledWith(
      expect.stringContaining('cannot be empty'),
      'Missing information',
    );
    expect(updateSailor).not.toHaveBeenCalled();
    // The row stays in edit mode, so nothing typed is lost.
    expect(screen.getByLabelText('Save changes for Ana A')).toBeVisible();
  });

  it('saves the trimmed values', async () => {
    startEdit();
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: ' Anka ' },
    });
    fireEvent.click(screen.getByLabelText('Save changes for Ana A'));

    await waitFor(() => expect(updateSailor).toHaveBeenCalledTimes(1));
    expect(updateSailor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Anka',
        surname: 'A',
        sail_number: '100',
        club_name: 'YC',
      }),
    );
  });
});
