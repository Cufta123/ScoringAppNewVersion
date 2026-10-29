/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventList from '../renderer/components/EventList';
import { confirmAction } from '../renderer/utils/userFeedback';

jest.mock('../renderer/api/db', () => ({
  eventDB: {},
  heatRaceDB: {},
}));
jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn(),
  confirmChoice: jest.fn(),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
}));

const event = {
  event_id: 1,
  event_name: 'Spring Cup',
  event_location: 'Rijeka',
  start_date: '2026-06-01',
  end_date: '2026-06-03',
  shrs_version: '2026-1',
  shrs_qualifying_assignment_mode: 'progressive',
  shrs_discard_profile_qualifying: 'standard',
  shrs_discard_profile_final: 'standard',
  shrs_discard_locked_qualifying: 0,
  shrs_discard_locked_final: 0,
  shrs_heat_overflow_policy: 'auto-increase',
};

// Cancel on the inline event edit threw away typed changes without a word.
// It now asks, but only when something was actually changed.
describe('EventList: Cancel on the inline event edit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    render(
      <MemoryRouter>
        <EventList events={[event]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText('Edit event'));
  });

  it('closes the form without asking when nothing was changed', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByLabelText(/Event Name/)).not.toBeInTheDocument(),
    );
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('asks when something was changed, and keeps the form on "keep editing"', async () => {
    confirmAction.mockResolvedValue(false);
    fireEvent.change(screen.getByLabelText(/Event Name/), {
      target: { value: 'Spring Cup 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringContaining('not saved'),
      'Discard unsaved changes',
      expect.objectContaining({
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      }),
    );
    expect(screen.getByLabelText(/Event Name/)).toHaveValue('Spring Cup 2');
  });

  it('closes the form when the changes are discarded', async () => {
    confirmAction.mockResolvedValue(true);
    fireEvent.change(screen.getByLabelText(/Event Name/), {
      target: { value: 'Spring Cup 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByLabelText(/Event Name/)).not.toBeInTheDocument(),
    );
  });
});
