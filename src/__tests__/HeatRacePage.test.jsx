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
          readAllRaces: jest.fn().mockResolvedValue([]),
          submitHeatRaceScoresAtomic: jest
            .fn()
            .mockResolvedValue({ ok: true, raceNumber: 1, raceId: 999 }),
        },
      },
    };
  });

  it('delegates score submission to the atomic main-process handler', async () => {
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
      expect(
        window.electron.sqlite.heatRaceDB.submitHeatRaceScoresAtomic,
      ).toHaveBeenCalledTimes(1);
    });

    expect(
      window.electron.sqlite.heatRaceDB.submitHeatRaceScoresAtomic,
    ).toHaveBeenCalledWith({
      event_id: 1,
      heat_id: 10,
      placeNumbers: [
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 102, place: 2, status: 'DNF' },
      ],
      isFinalSeries: false,
    });
  });
});
