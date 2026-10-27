/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import QualifyingTable from '../renderer/components/leaderboard/QualifyingTable';
import ScoreExplanationDialog from '../renderer/components/leaderboard/ScoreExplanationDialog';

const mockExplain = jest.fn();
jest.mock('../renderer/api/db', () => ({
  heatRaceDB: { explainBoatScore: (...args) => mockExplain(...args) },
}));
jest.mock('react-world-flags', () => () => null);

const entry = {
  boat_id: 7,
  boat_number: 12,
  country: 'CRO',
  name: 'Ana',
  surname: 'Horvat',
  boat_type: 'IOM',
  place: 2,
  races: ['1', '(DNF)', '2', '3'],
  race_points: ['1', '16', '2', '3'],
  race_statuses: ['FINISHED', 'DNF', 'FINISHED', 'FINISHED'],
  race_ids: ['101', '102', '103', '104'],
  computed_total: 6,
};

const tableProps = {
  leaderboard: [entry],
  editMode: false,
  compareMode: false,
  selectedBoatIds: [],
  setRdg2Picker: jest.fn(),
  onCompareRowClick: jest.fn(),
  onRaceChange: jest.fn(),
  confirmRdg2: jest.fn(),
  getFlagCode: (code) => code,
};

const block = {
  races: [
    {
      race_id: 101,
      race_number: 1,
      label: 'Q1',
      status: 'FINISHED',
      position: 1,
      points: 1,
      excluded: false,
      reason: { rule: 'RRS A4', text: 'Finished 1: 1 point.' },
    },
    {
      race_id: 102,
      race_number: 1,
      label: 'Q2',
      status: 'DNF',
      position: 16,
      points: 16,
      excluded: true,
      reason: {
        rule: 'SHRS 5.2',
        text: 'DNF (did not finish): one more than the 15 boats in the largest heat = 16.',
      },
    },
  ],
  discards: {
    rule: 'SHRS 5.4',
    text: '4 races completed in this series, so 1 worst score is excluded.',
    count: 1,
  },
  gross: 22,
  total: 6,
  largestHeat: 15,
  seriesRaceCount: 4,
  ties: [
    {
      boat_id: 9,
      sail: 'ITA 5',
      winnerBoatId: '7',
      rule: 'SHRS 5.7(ii)',
      note: 'Better score in their shared heat.',
    },
  ],
};

describe('explaining a score from the leaderboard', () => {
  beforeEach(() => mockExplain.mockReset());

  it('the Overall cell is a button that asks for the explanation', () => {
    const onExplain = jest.fn();
    render(<QualifyingTable {...tableProps} onExplain={onExplain} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'How 6 points was calculated for sail 12',
      }),
    );
    expect(onExplain).toHaveBeenCalledWith(entry);
    // The row click (compare selection) must not fire as well.
    expect(tableProps.onCompareRowClick).not.toHaveBeenCalled();
  });

  it('is plain text while editing or comparing (no onExplain)', () => {
    render(<QualifyingTable {...tableProps} />);
    expect(
      screen.queryByRole('button', { name: /points was calculated/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('shows every race with its rule, the discards, the sum and the tie', async () => {
    mockExplain.mockResolvedValue({
      qualifying: block,
      final: null,
      overall: null,
    });
    const onClose = jest.fn();
    render(
      <ScoreExplanationDialog
        eventId={3}
        target={{ boatId: 7, sail: 'CRO 12', name: 'Ana Horvat', place: 2 }}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: "How CRO 12's score was calculated" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Qualifying series: 6 points'),
    ).toBeInTheDocument();
    expect(mockExplain).toHaveBeenCalledWith(3, 7);
    expect(screen.getByText(/one more than the 15 boats/)).toBeInTheDocument();
    expect(screen.getByText('SHRS 5.2')).toBeInTheDocument();
    expect(screen.getByText('excluded')).toBeInTheDocument();
    expect(
      screen.getByText('All races 22 − excluded 16 = 6 points.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/CRO 12 is ranked ahead of ITA 5\./),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a failure instead of showing nothing', async () => {
    mockExplain.mockRejectedValue(new Error('database is locked'));
    render(
      <ScoreExplanationDialog
        eventId={3}
        target={{ boatId: 7, sail: 'CRO 12', name: 'Ana Horvat' }}
        onClose={jest.fn()}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not explain this score: database is locked',
    );
  });
});
