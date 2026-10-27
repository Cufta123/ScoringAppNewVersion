/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SailorList from '../renderer/components/SailorList';
import { confirmAction, reportInfo } from '../renderer/utils/userFeedback';

jest.mock(
  'react-world-flags',
  () =>
    function FlagMock() {
      return <span data-testid="flag" />;
    },
);
jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn(),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
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

const renderList = (props) =>
  render(
    <SailorList
      sailors={sailors}
      onRefreshSailors={jest.fn()}
      onRemoveBoat={jest.fn()}
      {...props}
    />,
  );

describe('SailorList removing a boat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.electron = {
      sqlite: {
        sailorDB: { readAllCategories: jest.fn().mockResolvedValue([]) },
      },
    };
    confirmAction.mockResolvedValue(true);
  });

  it('says "removed" only when the boat was removed', async () => {
    const onRemoveBoat = jest.fn().mockResolvedValue(true);
    renderList({ onRemoveBoat });
    fireEvent.click(screen.getByLabelText('Remove boat 100 from event'));
    await waitFor(() => expect(onRemoveBoat).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(reportInfo).toHaveBeenCalledWith(
        'Boat removed from event.',
        'Removed',
      ),
    );
  });

  it('a refused removal is not reported as done', async () => {
    const onRemoveBoat = jest.fn().mockResolvedValue(false);
    renderList({ onRemoveBoat });
    fireEvent.click(screen.getByLabelText('Remove boat 100 from event'));
    await waitFor(() => expect(onRemoveBoat).toHaveBeenCalled());
    expect(reportInfo).not.toHaveBeenCalled();
  });

  it('offers no remove button once the entry list is fixed', () => {
    renderList({ canRemove: false });
    expect(
      screen.queryByLabelText('Remove boat 100 from event'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Edit Ana A')).toBeInTheDocument();
  });
});
