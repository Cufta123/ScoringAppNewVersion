/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import QualifyingTable from '../renderer/components/leaderboard/QualifyingTable';

jest.mock('react-world-flags', () => () => null);

const row = (boat_id, sail, place, pending_races) => ({
  boat_id,
  boat_number: sail,
  country: 'CRO',
  name: 'Ana',
  surname: `Boat${sail}`,
  boat_type: 'IOM',
  place,
  races: ['1'],
  race_points: ['1'],
  race_statuses: ['FINISHED'],
  race_ids: ['101'],
  computed_total: 1,
  pending_races,
});

const props = {
  editMode: false,
  compareMode: false,
  selectedBoatIds: [],
  setRdg2Picker: jest.fn(),
  onCompareRowClick: jest.fn(),
  onRaceChange: jest.fn(),
  confirmRdg2: jest.fn(),
  getFlagCode: (code) => code,
};

describe('a qualifying round still being sailed', () => {
  it('shows its results greyed after the counted races, outside the totals', () => {
    render(
      <QualifyingTable
        {...props}
        leaderboard={[
          row(1, 11, 1, [
            {
              boat_id: 1,
              race_id: 201,
              position: 3,
              points: 3,
              status: 'FINISHED',
              heat_name: 'Heat A2',
              race_number: 1,
            },
          ]),
          row(2, 22, 2, []),
        ]}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'Round in progress: not every heat has sailed it yet.',
    );
    const header = screen.getByRole('columnheader', {
      name: 'Q2 in progress, not counted',
    });
    expect(header).toHaveClass('race-in-progress');

    const [first, second] = screen.getAllByRole('row').slice(1);
    const pendingCell = within(first).getByTitle(
      'Heat A2: in progress, not counted yet',
    );
    expect(pendingCell).toHaveTextContent('3');
    expect(
      within(second).getByTitle('Not sailed yet in this round'),
    ).toHaveTextContent('–');
  });

  it('adds nothing when every round is complete', () => {
    render(<QualifyingTable {...props} leaderboard={[row(1, 11, 1, [])]} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: /in progress/ }),
    ).not.toBeInTheDocument();
  });
});
