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
import GlobalLeaderboardComponent from '../renderer/components/GlobalLeaderboard';
import { reportError } from '../renderer/utils/userFeedback';

jest.mock(
  'react-world-flags',
  () =>
    function ({ code, alt }) {
      return (
        <span data-testid="flag" data-code={code}>
          {alt}
        </span>
      );
    },
);

const addRow = jest.fn();
const writeBuffer = jest.fn().mockResolvedValue(new ArrayBuffer(8));

jest.mock('exceljs', () => ({
  Workbook: jest.fn().mockImplementation(() => ({
    addWorksheet: jest.fn().mockReturnValue({ addRow }),
    xlsx: { writeBuffer },
  })),
}));

jest.mock('file-saver', () => ({ saveAs: jest.fn() }));

jest.mock('../renderer/utils/userFeedback', () => ({
  reportError: jest.fn(),
}));

describe('GlobalLeaderboardComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.electron = {
      sqlite: {
        heatRaceDB: {
          readGlobalLeaderboard: jest.fn(),
        },
      },
    };
  });

  it('sorts by lowest points first and renders normalized rows', async () => {
    window.electron.sqlite.heatRaceDB.readGlobalLeaderboard.mockResolvedValue([
      {
        boat_id: 2,
        name: 'Bruno',
        surname: 'B',
        boat_number: '102',
        boat_type: 'IOM',
        country: 'CRO',
        total_points_global: 12,
      },
      {
        boat_id: 1,
        name: 'Ana',
        surname: 'A',
        boat_number: '101',
        boat_type: 'IOM',
        country: 'CRO',
        total_points_global: 8,
      },
    ]);

    render(<GlobalLeaderboardComponent />);

    expect(await screen.findByText('Global Leaderboard')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    const secondDataRow = rows[2];

    expect(within(firstDataRow).getByText('Ana')).toBeInTheDocument();
    expect(within(secondDataRow).getByText('Bruno')).toBeInTheDocument();
  });

  it('shows empty state and reports error when fetch fails', async () => {
    window.electron.sqlite.heatRaceDB.readGlobalLeaderboard.mockRejectedValue(
      new Error('db down'),
    );

    render(<GlobalLeaderboardComponent />);

    expect(await screen.findByText('No global results')).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledWith(
      'Could not load global leaderboard.',
      expect.any(Error),
    );
  });

  it('exports currently rendered leaderboard to excel', async () => {
    const { saveAs } = require('file-saver');

    window.electron.sqlite.heatRaceDB.readGlobalLeaderboard.mockResolvedValue([
      {
        boat_id: 1,
        name: 'Ana',
        surname: 'A',
        boat_number: '101',
        boat_type: 'IOM',
        country: 'CRO',
        total_points_global: 8,
      },
    ]);

    render(<GlobalLeaderboardComponent />);

    await screen.findByText('Ana');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Export global leaderboard to Excel',
      }),
    );

    await waitFor(() => expect(writeBuffer).toHaveBeenCalled());
    expect(addRow).toHaveBeenCalled();
    expect(saveAs).toHaveBeenCalledWith(
      expect.any(Blob),
      'global_leaderboard.xlsx',
    );
  });
});
