/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import useLeaderboard from '../renderer/hooks/useLeaderboard';

jest.mock('exceljs', () => {
  return function ExcelJS() {
    return {
      addWorksheet: jest.fn(() => ({ addRow: jest.fn() })),
      xlsx: {
        writeBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
      },
    };
  };
});

jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));
jest.mock('jspdf-autotable', () => jest.fn());
jest.mock('../renderer/utils/registerPdfUnicodeFont', () => jest.fn());

jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn().mockResolvedValue(true),
  reportError: jest.fn(),
}));

const baseLeaderboardRows = [
  {
    boat_id: 'b1',
    name: 'Ana',
    surname: 'A',
    country: 'CRO',
    boat_number: '101',
    boat_type: 'IOM',
    place: 1,
    total_points_event: 1,
    race_positions: '1',
    race_points: '1',
    race_ids: '101',
    race_statuses: 'FINISHED',
  },
  {
    boat_id: 'b2',
    name: 'Bruno',
    surname: 'B',
    country: 'CRO',
    boat_number: '102',
    boat_type: 'IOM',
    place: 2,
    total_points_event: 2,
    race_positions: '2',
    race_points: '2',
    race_ids: '101',
    race_statuses: 'FINISHED',
  },
  {
    boat_id: 'b3',
    name: 'Cedo',
    surname: 'C',
    country: 'CRO',
    boat_number: '103',
    boat_type: 'IOM',
    place: 3,
    total_points_event: 3,
    race_positions: '3',
    race_points: '3',
    race_ids: '101',
    race_statuses: 'FINISHED',
  },
];

describe('useLeaderboard scoring/edit flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    window.electron = {
      sqlite: {
        eventDB: {
          readAllEvents: jest.fn().mockResolvedValue([]),
        },
        heatRaceDB: {
          readAllHeats: jest.fn().mockResolvedValue([]),
          updateEventLeaderboard: jest.fn().mockResolvedValue(true),
          updateFinalLeaderboard: jest.fn().mockResolvedValue(true),
          readFinalLeaderboard: jest.fn().mockResolvedValue([]),
          readLeaderboard: jest
            .fn()
            .mockResolvedValue(JSON.parse(JSON.stringify(baseLeaderboardRows))),
          readOverallLeaderboard: jest.fn().mockResolvedValue([]),
          updateRaceResult: jest.fn().mockResolvedValue(true),
        },
      },
    };
  });

  it('applies DSQ penalty as fleet size + 1 points', async () => {
    const { result } = renderHook(() => useLeaderboard(1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    act(() => {
      result.current.handleRaceChange('b2', 0, null, 'DSQ');
    });

    const edited = result.current.editableLeaderboard.find((e) => e.boat_id === 'b2');
    expect(edited.races[0]).toBe('4');
    expect(edited.race_statuses[0]).toBe('DSQ');
    expect(edited.computed_total).toBe(4);
  });

  it('shifts other boats when changing place with shiftPositions enabled', async () => {
    const { result } = renderHook(() => useLeaderboard(1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    act(() => {
      result.current.setShiftPositions(true);
    });

    act(() => {
      result.current.handleRaceChange('b3', 0, 1, 'FINISHED');
    });

    const after = result.current.editableLeaderboard;
    const b1 = after.find((e) => e.boat_id === 'b1');
    const b2 = after.find((e) => e.boat_id === 'b2');
    const b3 = after.find((e) => e.boat_id === 'b3');

    expect(b3.races[0]).toBe('1');
    expect(b1.races[0]).toBe('2');
    expect(b2.races[0]).toBe('3');
  });

  it('persists changed race result and recalculates leaderboard on save', async () => {
    const { result } = renderHook(() => useLeaderboard(1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    act(() => {
      result.current.handleRaceChange('b2', 0, null, 'DSQ');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(window.electron.sqlite.heatRaceDB.updateRaceResult).toHaveBeenCalledWith(
      1,
      '101',
      'b2',
      4,
      false,
      'DSQ',
    );
    expect(window.electron.sqlite.heatRaceDB.updateEventLeaderboard).toHaveBeenCalled();
  });

  it('keeps full leaderboard payload contract stable across multiple sequential edits', async () => {
    window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce([
      {
        boat_id: 'b1',
        name: 'Ana',
        surname: 'A',
        country: 'CRO',
        boat_number: '101',
        boat_type: 'IOM',
        place: 1,
        total_points_event: 10,
        race_positions: '1,2,3,4',
        race_points: '1,2,3,4',
        race_ids: '101,102,103,104',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 'b2',
        name: 'Bruno',
        surname: 'B',
        country: 'CRO',
        boat_number: '102',
        boat_type: 'IOM',
        place: 2,
        total_points_event: 10,
        race_positions: '2,1,4,3',
        race_points: '2,1,4,3',
        race_ids: '101,102,103,104',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 'b3',
        name: 'Cedo',
        surname: 'C',
        country: 'CRO',
        boat_number: '103',
        boat_type: 'IOM',
        place: 3,
        total_points_event: 10,
        race_positions: '3,4,1,2',
        race_points: '3,4,1,2',
        race_ids: '101,102,103,104',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 'b4',
        name: 'Dora',
        surname: 'D',
        country: 'CRO',
        boat_number: '104',
        boat_type: 'IOM',
        place: 4,
        total_points_event: 10,
        race_positions: '4,3,2,1',
        race_points: '4,3,2,1',
        race_ids: '101,102,103,104',
        race_statuses: 'FINISHED,FINISHED,FINISHED,FINISHED',
      },
    ]);

    const { result } = renderHook(() => useLeaderboard(77));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    act(() => {
      result.current.handleRaceChange('b1', 0, null, 'DSQ');
    });

    act(() => {
      result.current.handleRaceChange('b2', 1, 1, 'ZFP');
    });

    act(() => {
      result.current.handleRaceChange('b3', 2, 1.5, 'RDG3');
    });

    act(() => {
      result.current.setShiftPositions(true);
    });

    act(() => {
      result.current.handleRaceChange('b4', 0, 1, 'FINISHED');
    });

    const payloadContract = result.current.editableLeaderboard.map((entry) => ({
      boat_id: entry.boat_id,
      races: entry.races,
      race_points: entry.race_points,
      race_statuses: entry.race_statuses,
      computed_total: entry.computed_total,
      total_points_event: entry.total_points_event,
      total_points_final: entry.total_points_final,
    }));

    expect(payloadContract).toMatchSnapshot();
  });
});
