/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import SailorList from '../renderer/components/SailorList';

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
  {
    boat_id: 2,
    country: 'CRO',
    sail_number: '9',
    model: 'IOM',
    name: 'Bob',
    surname: 'B',
    club: 'YC',
    category: 'SENIOR',
  },
  {
    boat_id: 3,
    country: 'CRO',
    sail_number: '10',
    model: 'IOM',
    name: 'Cal',
    surname: 'C',
    club: 'YC',
    category: 'SENIOR',
  },
];

const sailNumbersInOrder = () =>
  screen
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map((row) => within(row).getAllByRole('cell')[1].textContent);

describe('SailorList sorting', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.electron = {
      sqlite: {
        sailorDB: {
          readAllCategories: jest.fn().mockResolvedValue([]),
        },
      },
    };
  });

  it('sorts the Sail № column numerically, not lexicographically', async () => {
    render(
      <SailorList
        sailors={sailors}
        onRemoveBoat={jest.fn()}
        onRefreshSailors={jest.fn()}
      />,
    );

    // Wait for the table to render (categories fetch resolves on mount).
    await waitFor(() => {
      expect(screen.getAllByRole('row').length).toBe(sailors.length + 1);
    });

    fireEvent.click(screen.getByText('Sail №'));

    // Lexicographic order would be 10, 100, 9 — numeric must be 9, 10, 100.
    expect(sailNumbersInOrder()).toEqual(['9', '10', '100']);

    // Toggling to descending reverses it.
    fireEvent.click(screen.getByText('Sail №'));
    expect(sailNumbersInOrder()).toEqual(['100', '10', '9']);
  });
});
