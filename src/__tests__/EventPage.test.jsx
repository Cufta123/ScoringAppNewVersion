/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventPage from '../renderer/pages/EventPage/EventPage';

jest.mock(
  'react-select',
  () =>
    function () {
      return <div>React Select Mock</div>;
    },
);
jest.mock(
  '../renderer/components/SailorForm',
  () =>
    function () {
      return <div>Sailor Form Mock</div>;
    },
);
jest.mock(
  '../renderer/components/SailorList',
  () =>
    function ({ onRemoveBoat }) {
      return (
        <div>
          Sailor List Mock
          <button type="button" onClick={() => onRemoveBoat(55)}>
            Remove Boat 55
          </button>
        </div>
      );
    },
);
jest.mock(
  '../renderer/components/SailorImport',
  () =>
    function () {
      return <div>Sailor Import Mock</div>;
    },
);
jest.mock(
  '../renderer/components/HeatComponent',
  () =>
    function () {
      return <div>Heat Component Mock</div>;
    },
);
jest.mock(
  '../renderer/components/Navbar',
  () =>
    function ({ onHeatRaceClick, onOpenLeaderboard }) {
      return (
        <header>
          {onHeatRaceClick ? (
            <button type="button" onClick={onHeatRaceClick}>
              Heat Race
            </button>
          ) : null}
          {onOpenLeaderboard ? (
            <button type="button" onClick={onOpenLeaderboard}>
              Leaderboard
            </button>
          ) : null}
        </header>
      );
    },
);
jest.mock(
  '../renderer/components/shared/Breadcrumbs',
  () =>
    function () {
      return <nav>Breadcrumbs Mock</nav>;
    },
);
jest.mock('../renderer/utils/printStartingList', () => jest.fn());
jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn(),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
}));

const event = {
  event_id: 1,
  event_name: 'Test Event',
  start_date: '2026-04-10',
  end_date: '2026-04-12',
};

const renderEventPage = (initialEntry) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<div>Home Screen</div>} />
        <Route path="/event/:name" element={<EventPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('EventPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.electron = {
      sqlite: {
        eventDB: {
          readBoatsByEvent: jest.fn().mockResolvedValue([]),
          readAllEvents: jest.fn().mockResolvedValue([event]),
          associateBoatWithEvent: jest.fn().mockResolvedValue(true),
          removeBoatFromEvent: jest.fn().mockResolvedValue(true),
        },
        sailorDB: {
          readAllBoats: jest.fn().mockResolvedValue([]),
        },
        heatRaceDB: {
          readAllHeats: jest.fn().mockResolvedValue([]),
          readAllRaces: jest.fn().mockResolvedValue([]),
        },
      },
    };
  });

  it('redirects to home when the event cannot be resolved from the URL', async () => {
    window.electron.sqlite.eventDB.readAllEvents.mockResolvedValue([]);

    renderEventPage('/event/missing');

    await waitFor(() => {
      expect(screen.getByText('Home Screen')).toBeInTheDocument();
    });
  });

  it('resolves the event from the URL when route state is missing', async () => {
    renderEventPage('/event/Test Event');

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /test event/i }),
      ).toBeInTheDocument();
    });
  });

  it('removes a boat from the event while no race has happened', async () => {
    renderEventPage({
      pathname: '/event/Test Event',
      state: { event },
    });

    await waitFor(() => {
      expect(screen.getByText('Sailor List Mock')).toBeInTheDocument();
    });

    screen.getByRole('button', { name: 'Remove Boat 55' }).click();

    await waitFor(() => {
      expect(
        window.electron.sqlite.eventDB.removeBoatFromEvent,
      ).toHaveBeenCalledWith(55, 1);
    });
  });

  it('blocks removing a boat after a race has happened', async () => {
    // eslint-disable-next-line global-require
    const { reportInfo } = require('../renderer/utils/userFeedback');
    window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
      { heat_id: 20 },
    ]);
    window.electron.sqlite.heatRaceDB.readAllRaces.mockResolvedValue([
      { race_id: 7 },
    ]);

    renderEventPage({
      pathname: '/event/Test Event',
      state: { event },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/no more sailors or boats can be added/i),
      ).toBeInTheDocument();
    });

    screen.getByRole('button', { name: 'Remove Boat 55' }).click();

    await waitFor(() => {
      expect(reportInfo).toHaveBeenCalledWith(
        expect.stringMatching(/cannot be removed after a race/i),
        'Action blocked',
      );
    });
    expect(
      window.electron.sqlite.eventDB.removeBoatFromEvent,
    ).not.toHaveBeenCalled();
  });

  it('shows warning banner after races have started', async () => {
    window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
      { heat_id: 20 },
    ]);
    window.electron.sqlite.heatRaceDB.readAllRaces.mockResolvedValue([
      { race_id: 7 },
    ]);

    renderEventPage({
      pathname: '/event/Test Event',
      state: { event },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/no more sailors or boats can be added/i),
      ).toBeInTheDocument();
    });
  });
});
