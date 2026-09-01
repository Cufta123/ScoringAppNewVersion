/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventForm, { EventList } from '../renderer/components/EventForm';
import { reportInfo } from '../renderer/utils/userFeedback';

const navigateMock = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => navigateMock,
}));

jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn(),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
}));

describe('EventForm advanced discard thresholds', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    window.electron = {
      sqlite: {
        eventDB: {
          readAllEvents: jest.fn().mockResolvedValue([]),
          insertEvent: jest.fn().mockResolvedValue({ lastInsertRowid: 101 }),
          updateEvent: jest.fn().mockResolvedValue({ success: true }),
          deleteEvent: jest.fn().mockResolvedValue({ success: true }),
        },
      },
    };
  });

  const fillRequiredCreateFields = () => {
    fireEvent.change(screen.getByLabelText('Event Name'), {
      target: { value: 'Spring Regatta 2026' },
    });
    fireEvent.change(screen.getByLabelText('Location'), {
      target: { value: 'Split' },
    });
    fireEvent.change(screen.getByLabelText('Start Date'), {
      target: { value: '2026-05-10' },
    });
    fireEvent.change(screen.getByLabelText('End Date'), {
      target: { value: '2026-05-12' },
    });
  };

  it('keeps advanced SHRS options hidden by default', async () => {
    render(<EventForm />);

    expect(screen.getByLabelText('Advanced SHRS options')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Qualifying Assignment Mode'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Heat Overflow Policy'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Qualifying Discards'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Finals Discards')).not.toBeInTheDocument();
  });

  it('blocks submit when custom qualifying threshold list is invalid', async () => {
    render(<EventForm />);

    fillRequiredCreateFields();

    fireEvent.click(screen.getByLabelText('Advanced SHRS options'));

    fireEvent.change(
      screen.getByRole('combobox', { name: /qualifying discards/i }),
      {
        target: { value: 'custom' },
      },
    );

    fireEvent.change(screen.getByPlaceholderText('e.g. 4,8,16,24'), {
      target: { value: '5,3,9' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(reportInfo).toHaveBeenCalledWith(
        'Thresholds must be in strictly increasing order.',
        'Invalid qualifying thresholds',
      );
    });

    expect(window.electron.sqlite.eventDB.insertEvent).not.toHaveBeenCalled();
  });

  it('submits standard discard profiles when advanced is off', async () => {
    render(<EventForm />);

    fillRequiredCreateFields();

    fireEvent.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(window.electron.sqlite.eventDB.insertEvent).toHaveBeenCalledWith(
        'Spring Regatta 2026',
        'Split',
        '2026-05-10',
        '2026-05-12',
        'progressive',
        'standard',
        'standard',
        'auto-increase',
      );
    });
  });

  it('submits a never-discard qualifying profile when never is selected', async () => {
    render(<EventForm />);

    fillRequiredCreateFields();

    fireEvent.click(screen.getByLabelText('Advanced SHRS options'));

    fireEvent.change(
      screen.getByRole('combobox', { name: /qualifying discards/i }),
      { target: { value: 'never' } },
    );

    fireEvent.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(window.electron.sqlite.eventDB.insertEvent).toHaveBeenCalled();
    });

    const args = window.electron.sqlite.eventDB.insertEvent.mock.calls[0];
    expect(JSON.parse(args[5])).toMatchObject({
      neverDiscard: true,
      thresholds: [],
    });
    // The finals profile is untouched and stays standard.
    expect(args[6]).toBe('standard');
  });

  it('opens and re-saves a never-discard profile without error', async () => {
    const neverProfile =
      '{"firstDiscardAt":4,"secondDiscardAt":8,"additionalEvery":8,"thresholds":[],"neverDiscard":true}';
    const event = {
      event_id: 7,
      event_name: 'Never Discard Regatta',
      event_location: 'Bay',
      start_date: '2026-05-10',
      end_date: '2026-05-12',
      shrs_version: '2026-1',
      shrs_qualifying_assignment_mode: 'progressive',
      shrs_discard_profile_qualifying: neverProfile,
      shrs_discard_profile_final: 'standard',
      shrs_discard_locked_qualifying: 0,
      shrs_discard_locked_final: 0,
      shrs_heat_overflow_policy: 'auto-increase',
    };

    render(<EventList events={[event]} />);

    fireEvent.click(screen.getByRole('button', { name: /edit event/i }));

    // The stored profile opens as "never" (not custom with an empty input).
    expect(
      screen.getByRole('combobox', { name: /qualifying discards/i }),
    ).toHaveValue('never');

    // No threshold input is rendered for the never mode.
    expect(
      screen.queryByPlaceholderText('e.g. 4,8,16,24'),
    ).not.toBeInTheDocument();

    // Re-saving must not throw "Enter at least one threshold".
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(window.electron.sqlite.eventDB.updateEvent).toHaveBeenCalled();
    });

    const args = window.electron.sqlite.eventDB.updateEvent.mock.calls[0];
    expect(args[0]).toBe(7);
    expect(JSON.parse(args[6])).toMatchObject({
      neverDiscard: true,
      thresholds: [],
    });
    expect(args[7]).toBe('standard');
    expect(reportInfo).not.toHaveBeenCalled();
  });
});
