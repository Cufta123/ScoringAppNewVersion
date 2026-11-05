/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from './helpers/renderWithQuery';
import UnassignedEntriesNotice from '../renderer/components/UnassignedEntriesNotice';
import { queryKeys } from '../renderer/api/queryKeys';

jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  reportError: jest.fn(),
}));

const entry = (boat_id, sail_number) => ({
  boat_id,
  sail_number,
  boat_country: 'CRO',
  name: 'Sailor',
  surname: String(sail_number),
});

describe('UnassignedEntriesNotice', () => {
  let api;

  beforeEach(() => {
    api = {
      eventDB: {
        readBoatsByEvent: jest
          .fn()
          .mockResolvedValue([entry(1, 11), entry(2, 22), entry(5, 55)]),
      },
      heatRaceDB: { insertHeatBoat: jest.fn().mockResolvedValue({}) },
    };
    window.electron = { sqlite: api };
  });

  afterEach(() => {
    delete window.electron;
  });

  const heats = [
    {
      heat_id: 10,
      heat_name: 'Heat A1',
      heat_type: 'Qualifying',
      raceNumber: 1,
      boats: [{ boat_id: 1 }],
    },
    {
      heat_id: 20,
      heat_name: 'Heat B1',
      heat_type: 'Qualifying',
      raceNumber: 0,
      boats: [{ boat_id: 2 }],
    },
  ];

  const renderNotice = (props = {}) => {
    return render(
      <UnassignedEntriesNotice
        eventId={1}
        heats={heats}
        raceHappened
        finalSeriesStarted={false}
        busy={false}
        runExclusive={(fn) => fn()}
        {...props}
      />,
    );
  };

  it('names the late entry and adds her to a heat that has not raced', async () => {
    const { queryClient } = renderNotice();
    // The heats as the cache holds them (what the heats view shows).
    queryClient.setQueryData(queryKeys.heatList(1), heats);

    expect(
      await screen.findByText(/1 entered boat is not in any heat/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/CRO 55/)).toBeInTheDocument();
    // Heat A1 has raced, so only Heat B1 is offered.
    const select = screen.getByLabelText('Heat for sail 55');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Heat B1 (1 boats)',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Add to heat' }));
    await waitFor(() =>
      expect(api.heatRaceDB.insertHeatBoat).toHaveBeenCalledWith(20, 5),
    );
    // The heats view reads the heats again, with her in Heat B1.
    await waitFor(() =>
      expect(
        queryClient.getQueryState(queryKeys.heatList(1)).isInvalidated,
      ).toBe(true),
    );
  });

  it('points to Recreate Heats before the first race', async () => {
    renderNotice({ raceHappened: false });
    expect(await screen.findByText(/Recreate Heats/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to heat' })).toBeNull();
  });

  it('shows nothing when every entry is in a heat', async () => {
    api.eventDB.readBoatsByEvent.mockResolvedValue([
      entry(1, 11),
      entry(2, 22),
    ]);
    renderNotice();
    await waitFor(() =>
      expect(api.eventDB.readBoatsByEvent).toHaveBeenCalled(),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
