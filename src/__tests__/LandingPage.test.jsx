/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent, render, screen } from './helpers/renderWithQuery';
import LandingPage from '../renderer/pages/LandingPage/LandingPage';

jest.mock('../renderer/components/EventForm', () => {
  function EventFormMock() {
    return <div>Event Form Mock</div>;
  }
  return { __esModule: true, default: EventFormMock };
});
jest.mock('../renderer/components/EventList', () => {
  function EventListMock() {
    return <div>Event List Mock</div>;
  }
  return { __esModule: true, default: EventListMock };
});
jest.mock(
  '../renderer/components/Navbar',
  () =>
    function () {
      return (
        <header>
          <span>Navbar Mock</span>
        </header>
      );
    },
);
jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  reportError: jest.fn(),
}));

const renderLandingPage = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('LandingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.electron = {
      sqlite: {
        eventDB: {
          readAllEvents: jest.fn().mockResolvedValue([]),
        },
      },
    };
  });

  it('shows onboarding and create form when there are no events', async () => {
    renderLandingPage();

    expect(
      screen.getByText('Sailing event management & race scoring'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Create a New Event')).toBeInTheDocument();
    expect(screen.getByText('Event Form Mock')).toBeInTheDocument();

    expect(await screen.findByText('How it works')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Your events' }),
    ).not.toBeInTheDocument();
  });

  it('shows the event list first and hides onboarding when events exist', async () => {
    window.electron.sqlite.eventDB.readAllEvents.mockResolvedValue([
      { event_id: 1, event_name: 'Spring Cup' },
    ]);

    renderLandingPage();

    expect(
      await screen.findByRole('region', { name: 'Your events' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Event List Mock')).toBeInTheDocument();
    expect(screen.queryByText('How it works')).not.toBeInTheDocument();
    // The create form opens from "New event", and closes again.
    expect(screen.queryByText('Event Form Mock')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New event/ }));
    expect(screen.getByText('Event Form Mock')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Event Form Mock')).not.toBeInTheDocument();
  });
});
