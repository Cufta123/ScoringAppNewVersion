/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import EventHistoryDialog from '../renderer/components/EventHistoryDialog';
import Navbar from '../renderer/components/Navbar';

const mockReadHistory = jest.fn();
jest.mock('../renderer/api/db', () => ({
  eventDB: { readEventHistory: (...args) => mockReadHistory(...args) },
}));

const where = (sail) => ({ sail, heat_name: 'Heat A1', race_number: 1 });
const score = (position, points, status = 'FINISHED') => ({
  position,
  points,
  status,
});

const actions = [
  {
    action_id: 2,
    channel: 'updateRaceResult',
    at: '2026-05-02T12:30:00.000Z',
    changes: [
      {
        change_id: 10,
        table_name: 'Scores',
        op: 'update',
        row_key: '1',
        old_row: score(1, 1),
        new_row: score(1, 3, 'DSQ'),
        context: where('CRO 12'),
      },
      {
        change_id: 11,
        table_name: 'Scores',
        op: 'update',
        row_key: '2',
        old_row: score(2, 2),
        new_row: score(1, 1),
        context: where('ITA 5'),
      },
    ],
  },
  {
    action_id: 1,
    channel: 'submitHeatRaceScoresAtomic',
    at: '2026-05-02T12:00:00.000Z',
    changes: Array.from({ length: 8 }, (_, i) => ({
      change_id: i + 1,
      table_name: 'Scores',
      op: 'insert',
      row_key: String(i + 1),
      old_row: null,
      new_row: score(i + 1, i + 1),
      context: where(`CRO ${i + 20}`),
    })),
  },
];

describe('event history dialog', () => {
  beforeEach(() => mockReadHistory.mockReset());

  it('lists actions newest first with their changes', async () => {
    mockReadHistory.mockResolvedValue(actions);
    render(<EventHistoryDialog eventId={4} open onClose={jest.fn()} />);

    expect(await screen.findByText('Result changed')).toBeInTheDocument();
    expect(mockReadHistory).toHaveBeenCalledWith(4);
    expect(
      screen.getByText('CRO 12, Heat A1 race 1: 1 (1 point) → DSQ (3 points)'),
    ).toBeInTheDocument();
    // The long action is cut to 6 lines until asked.
    expect(screen.queryByText(/CRO 27/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8 changes' }));
    expect(screen.getByText(/CRO 27/)).toBeInTheDocument();
  });

  it('filters to the changes of one boat', async () => {
    mockReadHistory.mockResolvedValue(actions);
    render(<EventHistoryDialog eventId={4} open onClose={jest.fn()} />);
    await screen.findByText('Result changed');

    fireEvent.change(screen.getByLabelText('Filter by sail, heat or result'), {
      target: { value: 'ita 5' },
    });
    expect(screen.getByText(/ITA 5, Heat A1 race 1/)).toBeInTheDocument();
    expect(screen.queryByText(/CRO 12/)).not.toBeInTheDocument();
    expect(screen.queryByText('Race scored')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by sail, heat or result'), {
      target: { value: 'GBR 1' },
    });
    expect(screen.getByText('No change matches “GBR 1”.')).toBeInTheDocument();
  });

  it('says when nothing has been recorded, and reports failures', async () => {
    mockReadHistory.mockResolvedValueOnce([]);
    const { unmount } = render(
      <EventHistoryDialog eventId={4} open onClose={jest.fn()} />,
    );
    expect(
      await screen.findByText(/No changes recorded yet/),
    ).toBeInTheDocument();
    unmount();

    mockReadHistory.mockRejectedValueOnce(new Error('database is locked'));
    render(<EventHistoryDialog eventId={4} open onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the history: database is locked',
    );
  });

  it('closes on Escape', async () => {
    mockReadHistory.mockResolvedValue([]);
    const onClose = jest.fn();
    render(<EventHistoryDialog eventId={4} open onClose={onClose} />);
    await screen.findByText(/No changes recorded yet/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('History button in the navbar', () => {
  it('only shows inside an event, and opens the history', async () => {
    mockReadHistory.mockResolvedValue([]);
    const { rerender } = render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole('button', { name: 'Open event history' }),
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Navbar historyEventId={7} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open event history' }));
    const dialog = await screen.findByRole('dialog', { name: 'Event history' });
    expect(
      await within(dialog).findByText(/No changes recorded yet/),
    ).toBeInTheDocument();
    expect(mockReadHistory).toHaveBeenCalledWith(7);
  });
});
