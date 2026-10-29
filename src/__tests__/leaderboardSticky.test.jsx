/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import QualifyingTable from '../renderer/components/leaderboard/QualifyingTable';
import FinalFleetTable from '../renderer/components/leaderboard/FinalFleetTable';

jest.mock('react-world-flags', () => () => null);

const row = (boat_id, sail, place) => ({
  boat_id,
  boat_number: sail,
  country: 'CRO',
  name: 'Ana',
  surname: `Boat${sail}`,
  boat_type: 'IOM',
  place,
  overall_rank: place,
  placement_group: 'Gold',
  races: ['1', '2'],
  race_points: ['1', '2'],
  race_statuses: ['FINISHED', 'FINISHED'],
  race_ids: ['101', '102'],
  computed_total: 3,
  total_points_combined: 3,
});

const props = {
  editMode: true,
  compareMode: false,
  selectedBoatIds: [],
  setRdg2Picker: jest.fn(),
  onCompareRowClick: jest.fn(),
  onRaceChange: jest.fn(),
  confirmRdg2: jest.fn(),
  getFlagCode: (code) => code,
};

const stickyClasses = ['lb-col-rank', 'lb-col-name', 'lb-col-sail'];
const stickyOf = (cell) =>
  stickyClasses.find((c) => cell.classList.contains(c)) ?? '';

function expectStickyIdentity() {
  const [head, first, second] = screen.getAllByRole('row');
  // Header: Rank, Name and Sail # are sticky; Country is not.
  expect(
    within(head).getAllByRole('columnheader').slice(0, 4).map(stickyOf),
  ).toEqual(['lb-col-rank', 'lb-col-name', '', 'lb-col-sail']);
  // Body: same cells, and the row carries the opaque colours the sticky
  // cells paint with (stripe, and a tint that is transparent when not picked).
  [first, second].forEach((tr, index) => {
    expect(within(tr).getAllByRole('cell').slice(0, 4).map(stickyOf)).toEqual([
      'lb-col-rank',
      'lb-col-name',
      '',
      'lb-col-sail',
    ]);
    expect(tr.style.getPropertyValue('--row-bg')).toBe(
      index === 0 ? '#fff' : 'var(--surface-2, #f8fbff)',
    );
    expect(tr.style.getPropertyValue('--row-tint')).toBe('transparent');
  });
}

describe('sticky identity columns', () => {
  it('Qualifying table, edit mode: Rank, Name, Sail # stay put', () => {
    const { container } = render(
      <QualifyingTable
        {...props}
        leaderboard={[row(1, 11, 1), row(2, 22, 2)]}
      />,
    );
    expectStickyIdentity();
    expect(container.querySelector('.leaderboard-scroll')).toBeInTheDocument();
  });

  it('Final fleet table, view mode: the same columns', () => {
    render(
      <FinalFleetTable
        {...props}
        editMode={false}
        group="Gold"
        entries={[row(1, 11, 1), row(2, 22, 2)]}
        eventLeaderboard={[row(1, 11, 1), row(2, 22, 2)]}
      />,
    );
    expectStickyIdentity();
  });

  it('a row picked for comparing keeps its tint on the sticky cells', () => {
    render(
      <QualifyingTable
        {...props}
        editMode={false}
        compareMode
        selectedBoatIds={[2]}
        leaderboard={[row(1, 11, 1), row(2, 22, 2)]}
      />,
    );
    const [, , picked] = screen.getAllByRole('row');
    expect(picked).toHaveAttribute('aria-selected', 'true');
    expect(picked.style.getPropertyValue('--row-tint')).toBe(
      'rgba(42, 157, 143, 0.15)',
    );
  });
});
