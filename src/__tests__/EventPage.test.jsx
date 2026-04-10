/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventPage from '../renderer/pages/EventPage/EventPage';
import { confirmAction } from '../renderer/utils/userFeedback';

jest.mock('react-select', () => () => <div>React Select Mock</div>);
jest.mock('../renderer/components/SailorForm', () => () => <div>Sailor Form Mock</div>);
jest.mock('../renderer/components/SailorList', () => () => <div>Sailor List Mock</div>);
jest.mock('../renderer/components/SailorImport', () => () => <div>Sailor Import Mock</div>);
jest.mock('../renderer/components/HeatComponent', () => () => <div>Heat Component Mock</div>);
jest.mock('../renderer/components/Navbar', () => ({ onBack, onHeatRaceClick, onOpenLeaderboard }) => (
  <header>
    <button type="button" onClick={onBack}>Back</button>
    {onHeatRaceClick ? <button type="button" onClick={onHeatRaceClick}>Heat Race</button> : null}
    {onOpenLeaderboard ? <button type="button" onClick={onOpenLeaderboard}>Leaderboard</button> : null}
  </header>
));
jest.mock('../renderer/components/shared/Breadcrumbs', () => () => <nav>Breadcrumbs Mock</nav>);
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
  is_locked: 0,
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
          readAllEvents: jest.fn().mockResolvedValue([{ event_id: 1, is_locked: 0 }]),
          lockEvent: jest.fn().mockResolvedValue(true),
          unlockEvent: jest.fn().mockResolvedValue(true),
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
    confirmAction.mockResolvedValue(true);
  });

  it('redirects to home if event is missing from route state', async () => {
    renderEventPage('/event/missing');

    await waitFor(() => {
      expect(screen.getByText('Home Screen')).toBeInTheDocument();
    });
  });

  it('shows warning banner after races have started', async () => {
    window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([{ heat_id: 20 }]);
    window.electron.sqlite.heatRaceDB.readAllRaces.mockResolvedValue([{ race_id: 7 }]);

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

  it('locks event after confirmation', async () => {
    renderEventPage({
      pathname: '/event/Test Event',
      state: { event },
    });

    fireEvent.click(await screen.findByRole('button', { name: /lock event/i }));

    await waitFor(() => {
      expect(confirmAction).toHaveBeenCalled();
      expect(window.electron.sqlite.eventDB.lockEvent).toHaveBeenCalledWith(1);
    });
  });
});
