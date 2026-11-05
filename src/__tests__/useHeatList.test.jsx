/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from './helpers/renderWithQuery';
import useHeatList from '../renderer/hooks/useHeatList';
import { queryKeys } from '../renderer/api/queryKeys';

// A write to the event (here, or in the history) invalidates it: the list is
// read again (api/writes.ts).
const eventChanged = (queryClient) =>
  act(async () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.event(5) });
  });

const reportErrorMock = jest.fn();
jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  reportError: (...args) => reportErrorMock(...args),
}));

const deferred = () => {
  let settle;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
};

describe('useHeatList', () => {
  let api;

  beforeEach(() => {
    api = {
      readAllHeats: jest.fn(),
      readBoatsByHeat: jest.fn().mockResolvedValue([]),
      readAllRaces: jest.fn().mockResolvedValue([]),
    };
    window.electron = { sqlite: { heatRaceDB: api } };
    reportErrorMock.mockReset();
  });

  afterEach(() => {
    delete window.electron;
  });

  it('derives the flags from the loaded heats', async () => {
    api.readAllHeats.mockResolvedValue([
      { heat_id: 1, heat_name: 'Heat A1', heat_type: 'Qualifying' },
      { heat_id: 2, heat_name: 'Heat B1', heat_type: 'Qualifying' },
    ]);
    api.readAllRaces.mockImplementation(async (heatId) =>
      heatId === 1 ? [{ race_id: 1 }] : [],
    );

    const { result } = renderHook(() => useHeatList(5));

    await waitFor(() => expect(result.current.heatsCreated).toBe(true));
    expect(result.current.heats.map((h) => h.raceNumber)).toEqual([1, 0]);
    expect(result.current.raceHappened).toBe(true);
    expect(result.current.numQualifyingGroups).toBe(2);
    expect(result.current.finalSeriesStarted).toBe(false);
  });

  it('applies only the newest of two overlapping loads', async () => {
    const slow = deferred();
    api.readAllHeats
      .mockResolvedValueOnce([
        { heat_id: 3, heat_name: 'Heat A3', heat_type: 'Qualifying' },
      ])
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([
        { heat_id: 2, heat_name: 'Heat A2', heat_type: 'Qualifying' },
      ]);

    const { result, queryClient } = renderHook(() => useHeatList(5));
    await waitFor(() =>
      expect(result.current.heats.map((h) => h.heat_id)).toEqual([3]),
    );
    // Two changes in a row: the first read again is still on its way when
    // the second starts.
    await eventChanged(queryClient);
    await eventChanged(queryClient);

    await waitFor(() =>
      expect(result.current.heats.map((h) => h.heat_id)).toEqual([2]),
    );

    // The older, slower read finishes last and must not overwrite the fresh one.
    await act(async () => {
      slow.resolve([
        { heat_id: 1, heat_name: 'Heat A1', heat_type: 'Qualifying' },
      ]);
    });
    expect(result.current.heats.map((h) => h.heat_id)).toEqual([2]);
  });

  it('follows the history undoing the Final Series start', async () => {
    api.readAllHeats.mockResolvedValue([
      { heat_id: 9, heat_name: 'Final Gold', heat_type: 'Final' },
    ]);
    const { result, queryClient } = renderHook(() => useHeatList(5));
    await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

    api.readAllHeats.mockResolvedValue([
      { heat_id: 1, heat_name: 'Heat A1', heat_type: 'Qualifying' },
    ]);
    await eventChanged(queryClient);

    await waitFor(() => expect(result.current.finalSeriesStarted).toBe(false));
  });

  it('keeps the final-series flag when a load fails', async () => {
    api.readAllHeats.mockResolvedValue([
      { heat_id: 9, heat_name: 'Final Gold', heat_type: 'Final' },
    ]);
    const { result, queryClient } = renderHook(() => useHeatList(5));
    await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

    api.readAllHeats.mockRejectedValue(new Error('offline'));
    await eventChanged(queryClient);

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.heats).toEqual([]);
    expect(result.current.finalSeriesStarted).toBe(true);
    expect(reportErrorMock).toHaveBeenCalledWith(
      'Could not load heats for this event.',
      expect.any(Error),
    );
  });
});
