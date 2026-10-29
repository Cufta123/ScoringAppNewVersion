/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import QualifyingTable from '../renderer/components/leaderboard/QualifyingTable';
import { hasMixedBoatTypes } from '../renderer/utils/leaderboardUtils';
import {
  DEFAULT_RESULTS_OPTIONS,
  buildResultsModel,
} from '../renderer/exports/resultsModel';

jest.mock('exceljs', () => jest.fn());
jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
jest.mock(
  'react-world-flags',
  () =>
    function FlagMock() {
      return <span data-testid="flag" />;
    },
);

const entry = (boat_id, boat_type, place) => ({
  boat_id,
  name: `Sailor${boat_id}`,
  surname: 'S',
  country: 'CRO',
  boat_number: 100 + boat_id,
  boat_type,
  place,
  races: [String(place)],
  race_points: [String(place)],
  race_ids: ['1'],
  race_statuses: ['FINISHED'],
  computed_total: place,
});

const renderTable = (rows) =>
  render(
    <QualifyingTable
      leaderboard={rows}
      editMode={false}
      compareMode={false}
      selectedBoatIds={[]}
      compareInfo={null}
      rdg2Picker={null}
      setRdg2Picker={jest.fn()}
      onCompareRowClick={jest.fn()}
      onRaceChange={jest.fn()}
      confirmRdg2={jest.fn()}
      getFlagCode={() => 'HR'}
    />,
  );

describe('hasMixedBoatTypes', () => {
  it('is false for a one-design fleet, ignoring case, spaces and blanks', () => {
    expect(
      hasMixedBoatTypes([
        { boat_type: 'IOM' },
        { boat_type: 'iom ' },
        { boat_type: null },
        { boat_type: '' },
      ]),
    ).toBe(false);
  });
  it('is true once a second model sails', () => {
    expect(
      hasMixedBoatTypes([{ boat_type: 'IOM' }, { boat_type: 'Marblehead' }]),
    ).toBe(true);
  });
});

describe('leaderboard columns', () => {
  it('headers read Total and Net; no Type column when every boat is an IOM', () => {
    renderTable([entry(1, 'IOM', 1), entry(2, 'IOM', 2)]);
    const headers = screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent.trim());
    expect(headers).toEqual(
      expect.arrayContaining(['Sail #', 'Total', 'Net', 'Q1']),
    );
    expect(headers).not.toContain('Type');
    expect(headers).not.toContain('Gross');
    expect(headers).not.toContain('Overall');
  });

  it('shows Type when the fleet mixes models', () => {
    renderTable([entry(1, 'IOM', 1), entry(2, 'Marblehead', 2)]);
    expect(
      screen.getByRole('columnheader', { name: 'Type' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Marblehead')).toBeInTheDocument();
  });

  it('the export follows the screen', () => {
    const build = (eventLeaderboard) =>
      buildResultsModel(
        {
          finalSeriesStarted: false,
          leaderboard: [],
          eventLeaderboard,
          discardProfiles: { qualifying: 'standard', final: 'standard' },
          clubs: {},
        },
        DEFAULT_RESULTS_OPTIONS,
      );

    // One design: no Type column, as on screen.
    const oneDesign = build([entry(1, 'IOM', 1)]);
    expect(oneDesign.showType).toBe(false);
    expect(oneDesign.raceHeaders).toEqual(['Q1']);

    // Mixed models: the Type column is there and carries each boat's model.
    const mixed = build([entry(1, 'IOM', 1), entry(2, 'Marblehead', 2)]);
    expect(mixed.showType).toBe(true);
    expect(mixed.sections[0].rows[1].boatType).toBe('Marblehead');
  });
});
