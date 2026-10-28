/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import EventHistoryDialog from '../renderer/components/EventHistoryDialog';
import Navbar from '../renderer/components/Navbar';

const mockReadHistory = jest.fn();
const mockRevert = jest.fn();
const mockRestore = jest.fn();
jest.mock('../renderer/api/db', () => ({
  eventDB: {
    readEventHistory: (...args) => mockReadHistory(...args),
    revertHistoryAction: (...args) => mockRevert(...args),
    restoreEventToHistoryPoint: (...args) => mockRestore(...args),
  },
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
  beforeEach(() => {
    mockReadHistory.mockReset();
    mockRevert.mockReset();
  });

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

describe('undo from the history', () => {
  beforeEach(() => {
    mockReadHistory.mockReset();
    mockRevert.mockReset();
  });

  it('offers Undo for a result change only, and undoes it', async () => {
    const undoneHistory = [
      {
        action_id: 3,
        channel: 'revertHistoryAction',
        reverts_action_id: 2,
        reverts_channel: 'updateRaceResult',
        at: '2026-05-02T12:40:00.000Z',
        changes: [
          {
            change_id: 20,
            table_name: 'Scores',
            op: 'update',
            row_key: '1',
            old_row: score(1, 3, 'DSQ'),
            new_row: score(1, 1),
            context: where('CRO 12'),
          },
        ],
      },
      ...actions,
    ];
    mockReadHistory
      .mockResolvedValueOnce(actions)
      .mockResolvedValueOnce(undoneHistory);
    mockRevert.mockResolvedValue({ success: true, actionId: 3 });
    const changed = jest.fn();
    window.addEventListener('scoring-app:event-data-changed', changed);

    render(<EventHistoryDialog eventId={4} open onClose={jest.fn()} />);
    await screen.findByText('Result changed');
    const undoButtons = screen.getAllByRole('button', { name: /^Undo: / });
    // "Race scored" (index 1) is undone on the scoring page instead.
    expect(undoButtons).toHaveLength(1);
    expect(undoButtons[0]).toHaveAccessibleName(/^Undo: Result changed/);

    fireEvent.click(undoButtons[0]);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Undone: Result changed. The standings were recalculated.',
    );
    expect(mockRevert).toHaveBeenCalledWith(4, 2);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].detail).toEqual({ eventId: 4 });
    window.removeEventListener('scoring-app:event-data-changed', changed);

    // The reloaded history shows the undo, and the decision as undone; the
    // undo itself can be undone.
    expect(
      await screen.findByText('Undid “Result changed”'),
    ).toBeInTheDocument();
    expect(screen.getByText('Undone')).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('button', { name: /^Undo: / })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([expect.stringMatching(/^Undo: Undid “Result changed”/)]);
  });

  it('shows why an undo was refused', async () => {
    mockReadHistory.mockResolvedValue(actions);
    mockRevert.mockRejectedValue(
      new Error(
        'Cannot undo: CRO 12, Heat A1 race 1: 1 (1 point) → DSQ (3 points) was changed again later by “Result changed”. Undo that change first.',
      ),
    );
    render(<EventHistoryDialog eventId={4} open onClose={jest.fn()} />);
    await screen.findByText('Result changed');
    fireEvent.click(
      screen.getByRole('button', { name: /^Undo: Result changed/ }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /changed again later by “Result changed”/,
    );
  });
});

describe('go back to a point in the history', () => {
  const heats = {
    action_id: 1,
    channel: 'createInitialHeatsAtomic',
    at: '2026-05-02T11:00:00.000Z',
    changes: [
      {
        change_id: 1,
        table_name: 'Heats',
        op: 'insert',
        row_key: '1',
        old_row: null,
        new_row: { heat_id: 1, heat_name: 'Heat A1' },
        context: {},
      },
    ],
  };
  const raced = { ...actions[1], action_id: 2 };
  const corrected = { ...actions[0], action_id: 3 };
  const history = [corrected, raced, heats];

  beforeEach(() => {
    mockReadHistory.mockReset();
    mockRestore.mockReset();
    mockRevert.mockReset();
  });

  const open = async (list = history) => {
    mockReadHistory.mockResolvedValue(list);
    const onClose = jest.fn();
    render(<EventHistoryDialog eventId={4} open onClose={onClose} />);
    await screen.findByText('Result changed');
    return onClose;
  };

  it('is offered on every entry but the newest', async () => {
    await open();
    const buttons = screen.getAllByRole('button', { name: /^Go back to here/ });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Go back to here: Race scored/),
      expect.stringMatching(/^Go back to here: Heats created/),
    ]);
  });

  it('asks first, saying exactly what will be taken back; Cancel changes nothing', async () => {
    await open();
    fireEvent.click(
      screen.getByRole('button', { name: /^Go back to here: Heats created/ }),
    );
    const question = screen.getByRole('alertdialog');
    expect(question).toHaveTextContent(
      'Go back to how the event was after “Heats created”',
    );
    expect(
      within(question).getByText('1 × Result changed'),
    ).toBeInTheDocument();
    expect(within(question).getByText('1 × Race scored')).toBeInTheDocument();
    expect(question).toHaveTextContent(
      'A backup of the database is saved first',
    );
    // Focus lands on Cancel, the safe choice.
    expect(
      within(question).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    // Other actions wait while the question is open.
    screen
      .getAllByRole('button', { name: /^Go back to here/ })
      .forEach((b) => expect(b).toBeDisabled());

    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('Escape closes the question first, then the history', async () => {
    const onClose = await open();
    fireEvent.click(
      screen.getByRole('button', { name: /^Go back to here: Race scored/ }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('goes back, tells the other screens, and shows the step in the history', async () => {
    const restore = {
      action_id: 4,
      channel: 'restoreEventToHistoryPoint',
      restores_to_action_id: 2,
      at: '2026-05-02T13:00:00.000Z',
      changes: [
        {
          change_id: 30,
          table_name: 'Scores',
          op: 'update',
          row_key: '1',
          old_row: score(1, 3, 'DSQ'),
          new_row: score(1, 1),
          context: where('CRO 12'),
        },
      ],
    };
    mockReadHistory
      .mockResolvedValueOnce(history)
      .mockResolvedValueOnce([restore, ...history]);
    mockRestore.mockResolvedValue({
      success: true,
      actionId: 4,
      undoneActions: 1,
    });
    const changed = jest.fn();
    window.addEventListener('scoring-app:event-data-changed', changed);
    render(<EventHistoryDialog eventId={4} open onClose={jest.fn()} />);
    await screen.findByText('Result changed');

    fireEvent.click(
      screen.getByRole('button', { name: /^Go back to here: Race scored/ }),
    );
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Go back',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      /back to how it was after “Race scored”.*1 later action was taken back.*backup was saved/,
    );
    expect(mockRestore).toHaveBeenCalledWith(4, 2);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener('scoring-app:event-data-changed', changed);

    // The step is the newest entry; what it took back is marked Undone; it
    // can itself be undone (back to just before it, i.e. after entry 3).
    expect(
      await screen.findByText(/^Went back to after “Race scored”/),
    ).toBeInTheDocument();
    expect(screen.getByText('Undone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Undo going back/ }));
    const question = screen.getByRole('alertdialog');
    expect(question).toHaveTextContent('after “Result changed”');
    expect(
      within(question).getByText('1 × Result changed'),
    ).toBeInTheDocument();
    expect(question).toHaveTextContent('brings back');
  });

  it('shows why going back was refused, without the technical wrapping', async () => {
    await open();
    mockRestore.mockRejectedValue(
      new Error(
        "Error invoking remote method 'restoreEventToHistoryPoint': Error: Cannot go back: the data no longer matches the history (it was changed another way). Nothing was changed; a backup was saved.",
      ),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^Go back to here: Heats created/ }),
    );
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Go back',
      }),
    );
    const alert = await screen.findByText(
      /^Cannot go back: the data no longer matches/,
    );
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).not.toMatch(/Error invoking/);
    // The question stays, so the user can cancel or try again.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('a double click goes back once', async () => {
    await open();
    let finish;
    mockRestore.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^Go back to here: Heats created/ }),
    );
    const go = within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Go back',
    });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(mockRestore).toHaveBeenCalledTimes(1);
    finish({ success: true, actionId: 9, undoneActions: 2 });
    await screen.findByRole('status');
  });
});
