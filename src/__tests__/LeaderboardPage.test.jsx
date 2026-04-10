/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { confirmAction } from '../renderer/utils/userFeedback';

jest.mock('../renderer/hooks/useLeaderboard', () => jest.fn());
jest.mock('../renderer/components/Navbar', () => ({ onBack }) => (
  <header>
    <button type="button" onClick={onBack}>
      Back to Event
    </button>
  </header>
));
jest.mock('../renderer/components/shared/Breadcrumbs', () => ({ items }) => (
  <nav>
    {items.map((item) => (
      <button key={item.label} type="button" onClick={item.onClick}>
        {item.label}
      </button>
    ))}
  </nav>
));
jest.mock('../renderer/components/leaderboard/LeaderboardToolbar', () => () => (
  <div>Leaderboard Toolbar Mock</div>
));
jest.mock('../renderer/components/leaderboard/SectionDivider', () => () => (
  <div>Section Divider Mock</div>
));
jest.mock('../renderer/components/leaderboard/QualifyingTable', () => () => (
  <div>Qualifying Table Mock</div>
));
jest.mock('../renderer/components/leaderboard/FinalFleetTable', () => () => (
  <div>Final Fleet Table Mock</div>
));
jest.mock('../renderer/components/leaderboard/RdgLegend', () => () => (
  <div>RDG Legend Mock</div>
));
jest.mock('../renderer/components/shared/EmptyState', () => ({ title }) => (
  <div>{title}</div>
));
jest.mock('../renderer/components/shared/LoadingState', () => ({ label }) => (
  <div>{label}</div>
));
jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn(),
}));

const useLeaderboard = require('../renderer/hooks/useLeaderboard');
const LeaderboardPage = require('../renderer/pages/LeaderboardPage/LeaderboardPage').default;

const baseLeaderboardHook = {
  eventLeaderboard: [],
  loading: false,
  finalSeriesStarted: false,
  editMode: false,
  editableLeaderboard: [],
  shiftPositions: false,
  compareMode: false,
  selectedBoatIds: [],
  rdgMeta: {},
  rdg2Picker: null,
  hasUnsavedChanges: false,
  hasEventData: true,
  hasFinalData: false,
  groupedLeaderboard: {},
  sortedGroups: [],
  compareInfo: null,
  setShiftPositions: jest.fn(),
  setCompareMode: jest.fn(),
  setSelectedBoatIds: jest.fn(),
  setRdg2Picker: jest.fn(),
  toggleEditMode: jest.fn(),
  handleSave: jest.fn(),
  handleRaceChange: jest.fn(),
  confirmRdg2: jest.fn(),
  handleCompareRowClick: jest.fn(),
  exportAs: jest.fn(),
  getFlagCode: jest.fn(),
};

const event = {
  event_id: 3,
  event_name: 'Spring Cup',
};

const renderLeaderboardPage = (entry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<div>Home Screen</div>} />
        <Route path="/event/:name" element={<div>Event Screen</div>} />
        <Route path="/event/:eventName/leaderboard" element={<LeaderboardPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('LeaderboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLeaderboard.mockReturnValue(baseLeaderboardHook);
    confirmAction.mockResolvedValue(true);
  });

  it('renders nothing when event state is missing', () => {
    renderLeaderboardPage('/event/unknown/leaderboard');

    expect(screen.queryByText('Leaderboard Toolbar Mock')).not.toBeInTheDocument();
    expect(screen.queryByText('Qualifying Table Mock')).not.toBeInTheDocument();
  });

  it('renders leaderboard content for valid event', () => {
    renderLeaderboardPage({
      pathname: '/event/Spring Cup/leaderboard',
      state: { event },
    });

    expect(screen.getByText('Leaderboard Toolbar Mock')).toBeInTheDocument();
    expect(screen.getByText('Qualifying Table Mock')).toBeInTheDocument();
  });

  it('asks for confirmation before leaving with unsaved changes', async () => {
    useLeaderboard.mockReturnValue({
      ...baseLeaderboardHook,
      hasUnsavedChanges: true,
    });
    confirmAction.mockResolvedValue(false);

    renderLeaderboardPage({
      pathname: '/event/Spring Cup/leaderboard',
      state: { event },
    });

    fireEvent.click(screen.getByRole('button', { name: /back to event/i }));

    await waitFor(() => {
      expect(confirmAction).toHaveBeenCalledWith(
        'You have unsaved leaderboard changes. Leave this page and discard them?',
        'Unsaved changes',
      );
    });

    expect(screen.queryByText('Event Screen')).not.toBeInTheDocument();
  });
});
