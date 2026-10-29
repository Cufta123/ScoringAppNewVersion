/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventForm from '../renderer/components/EventForm';

jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
}));

describe('EventForm: pressing Create twice creates one event', () => {
  it('ignores a second submit while the name check and the insert are running', async () => {
    let finishRead;
    const readAllEvents = jest.fn(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve([]);
        }),
    );
    const insertEvent = jest.fn().mockResolvedValue({ lastInsertRowid: 1 });
    window.electron = { sqlite: { eventDB: { readAllEvents, insertEvent } } };
    const onEventCreated = jest.fn();

    render(<EventForm onEventCreated={onEventCreated} />);
    fireEvent.change(screen.getByLabelText('Event Name'), {
      target: { value: 'Euro 2026' },
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

    const form = screen
      .getByRole('button', { name: /create event/i })
      .closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    finishRead([]);

    await waitFor(() => expect(onEventCreated).toHaveBeenCalledTimes(1));
    expect(readAllEvents).toHaveBeenCalledTimes(1);
    expect(insertEvent).toHaveBeenCalledTimes(1);
  });
});
