/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HeatRacePage from '../renderer/pages/HeatRacePage/HeatRacePage';

jest.mock('../renderer/components/Navbar', () => ({ onBack, backLabel }) => (
  <header>
    <button type="button" onClick={onBack}>
      {backLabel}
    </button>
  </header>
));

jest.mock('../renderer/components/shared/Breadcrumbs', () => () => (
  <nav>Breadcrumbs Mock</nav>
));

jest.mock('../renderer/components/HeatComponent', () => ({
  onHeatSelect,
  onStartScoring,
  onQualifyingGroupCountChange,
}) => {
  React.useEffect(() => {
    onQualifyingGroupCountChange(1);
  }, [onQualifyingGroupCountChange]);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onHeatSelect({
            heat_id: 10,
            heat_name: 'Heat A1',
            heat_type: 'Qualifying',
          });
          onStartScoring();
        }}
      >
        Start scoring mock
      </button>
    </div>
  );
});

jest.mock('../renderer/components/ScoringInputComponent', () =>
  function MockScoringInputComponent({ onSubmit }) {
    return (
      <button
        type="button"
        onClick={() =>
          onSubmit([
            { boatNumber: 101, place: 1, status: 'FINISHED' },
            { boatNumber: 102, place: 2, status: 'DNF' },
          ])
        }
      >
        Submit scoring mock
      </button>
    );
  },
);

jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn().mockResolvedValue(true),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
}));

const event = {
  event_id: 1,
  event_name: 'Test Event',
};

const heat = {
  heat_id: 10,
  heat_name: 'Heat A1',
  heat_type: 'Qualifying',
};

describe('HeatRacePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    window.electron = {
      sqlite: {
        eventDB: {
          readEventById: jest.fn().mockResolvedValue({
            event_id: 1,
            event_name: 'Test Event',
          }),
        },
        heatRaceDB: {
          readAllHeats: jest.fn().mockResolvedValue([heat]),
          readAllRaces: jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]),
          getMaxHeatSize: jest.fn().mockResolvedValue(10),
          readBoatsByHeat: jest.fn().mockResolvedValue([
            { boat_id: 1, sail_number: 101 },
            { boat_id: 2, sail_number: 102 },
          ]),
          insertRace: jest.fn().mockResolvedValue({ lastInsertRowid: 999 }),
          insertScore: jest.fn().mockResolvedValue(true),
          updateEventLeaderboard: jest.fn().mockResolvedValue(true),
          updateFinalLeaderboard: jest.fn().mockResolvedValue(true),
        },
      },
    };
  });

  it('keeps submitted position for displacing penalties and applies SHRS 5.2 points', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/event/Test Event/heat-race',
            state: { event },
          },
        ]}
      >
        <Routes>
          <Route path="/event/:eventName/heat-race" element={<HeatRacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start scoring mock' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit scoring mock' }));

    await waitFor(() => {
      expect(window.electron.sqlite.heatRaceDB.insertScore).toHaveBeenCalledTimes(2);
    });

    expect(window.electron.sqlite.heatRaceDB.insertScore).toHaveBeenNthCalledWith(
      1,
      999,
      1,
      1,
      1,
      'FINISHED',
    );

    expect(window.electron.sqlite.heatRaceDB.insertScore).toHaveBeenNthCalledWith(
      2,
      999,
      2,
      2,
      11,
      'DNF',
    );
  });
});
