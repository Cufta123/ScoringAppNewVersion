/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import LandingPage from '../renderer/pages/LandingPage/LandingPage';

jest.mock('../renderer/components/EventForm', () => () => <div>Event Form Mock</div>);
jest.mock('../renderer/components/GlobalLeaderboard', () => () => (
  <div>Global Leaderboard Mock</div>
));
jest.mock('../renderer/components/shared/Breadcrumbs', () => ({ items }) => (
  <nav>
    {items.map((item) => (
      <span key={item.label}>{item.label}</span>
    ))}
  </nav>
));
jest.mock('../renderer/components/Navbar', () => ({ onBack, backLabel }) => (
  <header>
    <span>Navbar Mock</span>
    {onBack ? (
      <button type="button" onClick={onBack}>
        {backLabel}
      </button>
    ) : null}
  </header>
));

describe('LandingPage', () => {
  it('shows default landing content', () => {
    render(<LandingPage />);

    expect(
      screen.getByText('Sailing event management & race scoring'),
    ).toBeInTheDocument();
    expect(screen.getByText('Create a New Event')).toBeInTheDocument();
    expect(screen.getByText('Event Form Mock')).toBeInTheDocument();
  });

  it('opens and closes global leaderboard view', () => {
    render(<LandingPage />);

    fireEvent.click(screen.getByRole('button', { name: /view global leaderboard/i }));

    expect(screen.getByText('Global Leaderboard Mock')).toBeInTheDocument();
    expect(screen.getByText('Global Leaderboard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to home/i }));

    expect(screen.getByText('Event Form Mock')).toBeInTheDocument();
  });
});
