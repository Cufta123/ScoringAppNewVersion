/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventForm from '../renderer/components/EventForm';
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
});
