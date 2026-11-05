/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from './helpers/renderWithQuery';
import HeatComponent from '../renderer/components/HeatComponent';
import { confirmAction } from '../renderer/utils/userFeedback';
import { eventStatusView } from './helpers/eventStatus';

jest.mock(
  'react-world-flags',
  () =>
    function ReactWorldFlagsMock() {
      return <span data-testid="flag" />;
    },
);
jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn(async () => true),
  reportInfo: jest.fn(),
  reportError: jest.fn(),
  reportWarning: jest.fn(),
}));

// SHRS 2.1: "The number of heats shall be as few as possible." The control used
// to default to 5 whatever the entry list said, so a dozen boats became five
// heats of two or three for anyone who clicked straight through — not the
// fewest possible, and a much worse regatta.
describe('HeatComponent heat-count default', () => {
  const setup = (entryCount, existingHeats = []) => {
    window.electron = {
      sqlite: {
        eventDB: {
          readBoatsByEvent: jest.fn().mockResolvedValue(
            Array.from({ length: entryCount }, (_, i) => ({
              boat_id: i + 1,
            })),
          ),
        },
        heatRaceDB: {
          readAllHeats: jest.fn().mockResolvedValue(existingHeats),
          readAllRaces: jest.fn().mockResolvedValue([]),
          readBoatsByHeat: jest.fn().mockResolvedValue([]),
          readLeaderboard: jest.fn().mockResolvedValue([]),
          readEventStatus: jest.fn().mockResolvedValue(eventStatusView()),
          createInitialHeatsAtomic: jest
            .fn()
            .mockResolvedValue({ success: true }),
        },
      },
    };
    render(<HeatComponent event={{ event_id: 5 }} onScoreHeat={jest.fn()} />);
  };

  afterEach(() => {
    delete window.electron;
  });

  const heatSelect = () => screen.getByLabelText(/number of heats/i);

  it.each([
    [12, '1'],
    [20, '1'],
    [21, '2'],
    [45, '3'],
  ])('defaults to the fewest heats %i entries allow', async (entries, want) => {
    setup(entries);

    await waitFor(() => expect(heatSelect()).toHaveValue(want));
  });

  it('creates heats with the defaulted count', async () => {
    setup(12);
    await waitFor(() => expect(heatSelect()).toHaveValue('1'));

    fireEvent.click(screen.getByRole('button', { name: /create heats/i }));

    await waitFor(() =>
      expect(
        window.electron.sqlite.heatRaceDB.createInitialHeatsAtomic,
      ).toHaveBeenCalledWith(5, 1),
    );
  });

  it('never overwrites a count the user picked', async () => {
    setup(12);
    await waitFor(() => expect(heatSelect()).toHaveValue('1'));

    fireEvent.change(heatSelect(), { target: { value: '4' } });
    expect(heatSelect()).toHaveValue('4');

    // A later entry-list read must not pull it back to the minimum.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(heatSelect()).toHaveValue('4');
  });

  it('defaults to the current split once heats exist', async () => {
    // For "Recreate Heats" the useful default is the split the event is on
    // now, not a change nobody asked for. Three heats for twelve boats is not
    // what a fresh event would pick, which is what makes this distinguishable
    // from the entry-count default.
    setup(12, [
      { heat_id: 1, heat_name: 'Heat A1', heat_type: 'Qualifying' },
      { heat_id: 2, heat_name: 'Heat B1', heat_type: 'Qualifying' },
      { heat_id: 3, heat_name: 'Heat C1', heat_type: 'Qualifying' },
    ]);

    await waitFor(() => expect(heatSelect()).toHaveValue('3'));
  });

  it('falls back to one heat when the entry list cannot be read', async () => {
    setup(0);
    window.electron.sqlite.eventDB.readBoatsByEvent.mockRejectedValue(
      new Error('offline'),
    );

    await waitFor(() => expect(heatSelect()).toHaveValue('1'));
  });
  it('says so when more heats are chosen than the boats need (SHRS 2.1)', async () => {
    setup(12);
    await waitFor(() => expect(heatSelect()).toHaveValue('1'));
    expect(screen.queryByText(/as few as possible/)).not.toBeInTheDocument();

    fireEvent.change(heatSelect(), { target: { value: '3' } });
    expect(
      screen.getByText(
        /12 boats fit in 1 heat of at most 20\. SHRS 2\.1: the number of heats shall be as few as possible\./,
      ),
    ).toBeVisible();
  });

  it('asks before creating more heats than needed, and stops on "Go back"', async () => {
    setup(12);
    await waitFor(() => expect(heatSelect()).toHaveValue('1'));
    fireEvent.change(heatSelect(), { target: { value: '3' } });
    confirmAction.mockResolvedValueOnce(false);

    fireEvent.click(screen.getByRole('button', { name: /create heats/i }));

    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringContaining('Create 3 heats anyway?'),
      'More heats than needed',
      expect.objectContaining({
        confirmLabel: 'Create 3 heats',
        cancelLabel: 'Go back',
      }),
    );
    expect(
      window.electron.sqlite.heatRaceDB.createInitialHeatsAtomic,
    ).not.toHaveBeenCalled();
  });

  it('creates them when confirmed', async () => {
    setup(12);
    await waitFor(() => expect(heatSelect()).toHaveValue('1'));
    fireEvent.change(heatSelect(), { target: { value: '3' } });
    confirmAction.mockResolvedValueOnce(true);

    fireEvent.click(screen.getByRole('button', { name: /create heats/i }));

    await waitFor(() =>
      expect(
        window.electron.sqlite.heatRaceDB.createInitialHeatsAtomic,
      ).toHaveBeenCalledWith(5, 3),
    );
  });

  it('does not ask for the fewest heats', async () => {
    setup(12);
    await waitFor(() => expect(heatSelect()).toHaveValue('1'));
    confirmAction.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /create heats/i }));
    await waitFor(() =>
      expect(
        window.electron.sqlite.heatRaceDB.createInitialHeatsAtomic,
      ).toHaveBeenCalledWith(5, 1),
    );
    expect(confirmAction).not.toHaveBeenCalled();
  });
});
