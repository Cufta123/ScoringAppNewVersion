/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import App from '../renderer/App';

jest.mock('../renderer/pages/LandingPage/LandingPage', () => () => (
  <div>Landing Page Mock</div>
));
jest.mock('../renderer/pages/EventPage/EventPage', () => () => (
  <div>Event Page Mock</div>
));
jest.mock('../renderer/pages/HeatRacePage/HeatRacePage', () => () => (
  <div>Heat Race Page Mock</div>
));
jest.mock('../renderer/pages/LeaderboardPage/LeaderboardPage', () => () => (
  <div>Leaderboard Page Mock</div>
));

describe('App routing', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('renders landing page on root route', () => {
    render(<App />);

    expect(screen.getByText('Landing Page Mock')).toBeInTheDocument();
    expect(screen.getByText('Skip to main content')).toBeInTheDocument();
  });

  it('renders event page route', () => {
    window.location.hash = '#/event/Spring-Regatta';
    render(<App />);

    expect(screen.getByText('Event Page Mock')).toBeInTheDocument();
  });

  it('renders heat race page route', () => {
    window.location.hash = '#/event/Spring-Regatta/heat-race';
    render(<App />);

    expect(screen.getByText('Heat Race Page Mock')).toBeInTheDocument();
  });

  it('renders leaderboard page route', () => {
    window.location.hash = '#/event/Spring-Regatta/leaderboard';
    render(<App />);

    expect(screen.getByText('Leaderboard Page Mock')).toBeInTheDocument();
  });
});
