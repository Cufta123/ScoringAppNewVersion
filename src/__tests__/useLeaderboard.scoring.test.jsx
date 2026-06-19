/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import useLeaderboard from '../renderer/hooks/useLeaderboard';
import { reportError } from '../renderer/utils/userFeedback';

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
  confirmChoice: jest.fn().mockResolvedValue('cancel'),
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
          saveLeaderboardRaceResultsAtomic: jest
            .fn()
            .mockResolvedValue({ success: true, updatedCount: 1 }),
          getMaxHeatSize: jest.fn().mockResolvedValue(0),
          explainTieBreak: jest.fn().mockResolvedValue({
            tied: false,
            totalA: 0,
            totalB: 0,
            winnerBoatId: null,
            route: null,
            steps: [],
            raceGrid: [],
            sharedRacePairs: [],
            sharedQualRacePairs: [],
          }),
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

    const edited = result.current.editableLeaderboard.find(
      (e) => e.boat_id === 'b2',
    );
    expect(edited.races[0]).toBe('4');
    expect(edited.race_statuses[0]).toBe('DSQ');
    expect(edited.computed_total).toBe(4);
  });

  it('keeps position for T1 scoring penalty in edit mode', async () => {
    const { result } = renderHook(() => useLeaderboard(1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    act(() => {
      result.current.handleRaceChange('b2', 0, 2, 'T1');
    });

    const edited = result.current.editableLeaderboard.find(
      (e) => e.boat_id === 'b2',
    );
    expect(edited.races[0]).toBe('2');
    expect(edited.race_statuses[0]).toBe('T1');
    // T1 keeps finishing place 2 but scores penalty points: with a largest
    // heat of 3 boats, 30% rounds to 1 place => 2 + 1 = 3 points (RRS T1).
    expect(edited.computed_total).toBe(3);
    // race_points carries the scored points (drives the Gross column), not the
    // raw finishing place.
    expect(edited.race_points[0]).toBe('3');
  });

  it('previews ZFP penalty points (not the finishing place) in the edit total', async () => {
    const { result } = renderHook(() => useLeaderboard(1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    act(() => {
      result.current.handleRaceChange('b2', 0, 1, 'ZFP');
    });

    const edited = result.current.editableLeaderboard.find(
      (e) => e.boat_id === 'b2',
    );
    // ZFP keeps place 1 but scores 20% of the largest heat (3 boats) = 1 place,
    // so the preview total is 1 + 1 = 2, not the raw place of 1 (the old bug).
    expect(edited.races[0]).toBe('1');
    expect(edited.race_statuses[0]).toBe('ZFP');
    expect(edited.computed_total).toBe(2);
    // Gross column reads race_points: it must show the 2 penalty points, not 1.
    expect(edited.race_points[0]).toBe('2');
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

  describe('final-series fleet scoping', () => {
    // Two final fleets of three boats each. Gold and Silver sail their own
    // races, so an edit in one fleet must never touch the other, and places
    // must cap at the fleet's heat size (3), not the combined count (6).
    const makeFinalRow = (boatId, sailNo, group, position) => ({
      boat_id: boatId,
      name: `Sailor ${boatId}`,
      surname: boatId,
      country: 'CRO',
      boat_number: sailNo,
      boat_type: 'IOM',
      placement_group: group,
      total_points_event: position,
      total_points_final: position,
      race_positions: String(position),
      race_points: String(position),
      race_ids: group === 'Gold' ? '201' : '202',
      race_statuses: 'FINISHED',
    });

    const finalRows = [
      makeFinalRow('b1', '101', 'Gold', 1),
      makeFinalRow('b2', '102', 'Gold', 2),
      makeFinalRow('b3', '103', 'Gold', 3),
      makeFinalRow('b4', '104', 'Silver', 1),
      makeFinalRow('b5', '105', 'Silver', 2),
      makeFinalRow('b6', '106', 'Silver', 3),
    ];

    beforeEach(() => {
      window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
        { heat_type: 'Final' },
      ]);
      window.electron.sqlite.heatRaceDB.readFinalLeaderboard.mockResolvedValue(
        JSON.parse(JSON.stringify(finalRows)),
      );
    });

    it("shifts only the edited boat's own fleet, leaving other fleets untouched", async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

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
      const get = (id) => after.find((e) => e.boat_id === id);

      // Gold fleet reshuffles around the edited boat...
      expect(get('b3').races[0]).toBe('1');
      expect(get('b1').races[0]).toBe('2');
      expect(get('b2').races[0]).toBe('3');
      // ...Silver fleet is completely untouched.
      expect(get('b4').races[0]).toBe('1');
      expect(get('b5').races[0]).toBe('2');
      expect(get('b6').races[0]).toBe('3');
    });

    it('updates the Overall combined total live while editing a final place', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

      // b3 (Gold) qualifies with 3 points and finishes the final race 3rd, so
      // its Overall combined total starts at qualifying(3) + final(3) = 6.
      const before = result.current.editableLeaderboard.find(
        (e) => e.boat_id === 'b3',
      );
      expect(before.total_points_combined).toBe(6);

      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b3', 0, 1, 'FINISHED');
      });

      const after = result.current.editableLeaderboard.find(
        (e) => e.boat_id === 'b3',
      );
      // Final total drops to 1, so Overall must follow live: 3 + 1 = 4 (not the
      // stale 6 that only refreshed on save before this fix).
      expect(after.computed_total).toBe(1);
      expect(after.total_points_combined).toBe(4);
    });

    it('caps an out-of-range place at the fleet size, not the combined count', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        // Type an absurd place into a 3-boat fleet.
        result.current.handleRaceChange('b1', 0, 99, 'FINISHED');
      });

      const after = result.current.editableLeaderboard;
      const get = (id) => after.find((e) => e.boat_id === id);

      // Snaps to last in the fleet (3), never 6, and the other fleet is intact.
      expect(get('b1').races[0]).toBe('3');
      expect(get('b4').races[0]).toBe('1');
      expect(get('b6').races[0]).toBe('3');
    });
  });

  describe('duplicate finishing-place guard on save', () => {
    const { confirmChoice } = require('../renderer/utils/userFeedback');

    const makeFinalRow = (boatId, sailNo, group, position) => ({
      boat_id: boatId,
      name: `Sailor ${boatId}`,
      surname: boatId,
      country: 'CRO',
      boat_number: sailNo,
      boat_type: 'IOM',
      placement_group: group,
      total_points_event: position,
      total_points_final: position,
      race_positions: String(position),
      race_points: String(position),
      race_ids: '201',
      race_statuses: 'FINISHED',
    });

    beforeEach(() => {
      window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
        { heat_type: 'Final' },
      ]);
      window.electron.sqlite.heatRaceDB.readFinalLeaderboard.mockResolvedValue([
        makeFinalRow('b1', '101', 'Gold', 1),
        makeFinalRow('b2', '102', 'Gold', 2),
        makeFinalRow('b3', '103', 'Gold', 3),
      ]);
    });

    const editIntoDuplicate = async (result) => {
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      // Shift OFF: manually put b1 on place 2, which b2 already holds.
      act(() => {
        result.current.handleRaceChange('b1', 0, 2, 'FINISHED');
      });
    };

    it('warns with both boats and offers three resolutions', async () => {
      confirmChoice.mockResolvedValueOnce('extra');
      const { result } = renderHook(() => useLeaderboard(5));
      await editIntoDuplicate(result);

      await act(async () => {
        await result.current.handleSave();
      });

      expect(confirmChoice).toHaveBeenCalledTimes(1);
      const [message, title, options] = confirmChoice.mock.calls[0];
      expect(title).toBe('Duplicate finishing place');
      expect(message).toContain('Sailor b1');
      expect(message).toContain('Sailor b2');
      expect(message).toContain('place 2');
      // All three buttons are offered.
      expect(options.confirmLabel).toBe('Switch places');
      expect(options.extraLabel).toBe('Save anyway');
      expect(options.cancelLabel).toBe('Cancel');
    });

    it('keeps the tie (one edit) when the user chooses Save anyway', async () => {
      confirmChoice.mockResolvedValueOnce('extra');
      const { result } = renderHook(() => useLeaderboard(5));
      await editIntoDuplicate(result);

      await act(async () => {
        await result.current.handleSave();
      });

      const [, ops] =
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
          .calls[0];
      // Only the edited boat is sent; b1 and b2 stay tied on place 2.
      expect(ops).toEqual([
        {
          raceId: '201',
          boatId: 'b1',
          newPosition: 2,
          entryStatus: 'FINISHED',
        },
      ]);
    });

    it('swaps places (two edits) when the user chooses Switch places', async () => {
      confirmChoice.mockResolvedValueOnce('confirm');
      const { result } = renderHook(() => useLeaderboard(5));
      await editIntoDuplicate(result);

      await act(async () => {
        await result.current.handleSave();
      });

      const [, ops] =
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
          .calls[0];
      // b1 takes place 2; b2 is displaced to b1's vacated place 1.
      expect(ops).toContainEqual({
        raceId: '201',
        boatId: 'b1',
        newPosition: 2,
        entryStatus: 'FINISHED',
      });
      expect(ops).toContainEqual({
        raceId: '201',
        boatId: 'b2',
        newPosition: 1,
        entryStatus: 'FINISHED',
      });
      expect(ops).toHaveLength(2);
    });

    it('aborts the save and stays in edit mode when the user cancels', async () => {
      confirmChoice.mockResolvedValueOnce('cancel');
      const { result } = renderHook(() => useLeaderboard(5));
      await editIntoDuplicate(result);

      await act(async () => {
        await result.current.handleSave();
      });

      expect(confirmChoice).toHaveBeenCalledTimes(1);
      // Nothing is written and the user is left editing to fix the clash.
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).not.toHaveBeenCalled();
      expect(result.current.editMode).toBe(true);
    });

    it('does not warn when edited places stay unique', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.setShiftPositions(true);
      });
      // Shift ON ripples the others, so no two boats end on the same place.
      act(() => {
        result.current.handleRaceChange('b3', 0, 1, 'FINISHED');
      });

      await act(async () => {
        await result.current.handleSave();
      });

      expect(confirmChoice).not.toHaveBeenCalled();
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).toHaveBeenCalledTimes(1);
    });
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

    // Only the cell the user actually edited is sent; the backend re-ranks the
    // rest of the column on recompute. (The preview re-ranks for display, but
    // saving the cascade would not converge under the backend's per-op re-rank.)
    expect(
      window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
    ).toHaveBeenCalledWith(
      1,
      [
        {
          raceId: '101',
          boatId: 'b2',
          newPosition: 4,
          entryStatus: 'DSQ',
        },
      ],
      false,
      false,
    );
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

  it('reverts editable leaderboard when atomic save fails', async () => {
    window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mockRejectedValueOnce(
      new Error('Simulated failure'),
    );

    const { result } = renderHook(() => useLeaderboard(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    const beforeSave = JSON.parse(
      JSON.stringify(result.current.eventLeaderboard),
    );

    act(() => {
      result.current.handleRaceChange('b2', 0, null, 'DSQ');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.editableLeaderboard).toEqual(beforeSave);
    expect(reportError).toHaveBeenCalledWith(
      'Could not save leaderboard changes.',
      expect.any(Error),
    );
  });

  it('exposes ordered tied-group entries in compare info for multi-boat ties', async () => {
    window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce([
      {
        boat_id: 'b1',
        name: 'Ana',
        surname: 'A',
        country: 'CRO',
        boat_number: '101',
        boat_type: 'IOM',
        place: 1,
        total_points_event: 7,
        race_positions: '1,2,4',
        race_points: '1,2,4',
        race_ids: '101,102,103',
        race_statuses: 'FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 'b2',
        name: 'Bruno',
        surname: 'B',
        country: 'CRO',
        boat_number: '102',
        boat_type: 'IOM',
        place: 2,
        total_points_event: 7,
        race_positions: '2,1,4',
        race_points: '2,1,4',
        race_ids: '101,102,103',
        race_statuses: 'FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 'b3',
        name: 'Cedo',
        surname: 'C',
        country: 'CRO',
        boat_number: '103',
        boat_type: 'IOM',
        place: 3,
        total_points_event: 7,
        race_positions: '3,3,1',
        race_points: '3,3,1',
        race_ids: '101,102,103',
        race_statuses: 'FINISHED,FINISHED,FINISHED',
      },
      {
        boat_id: 'b4',
        name: 'Dora',
        surname: 'D',
        country: 'CRO',
        boat_number: '104',
        boat_type: 'IOM',
        place: 4,
        total_points_event: 9,
        race_positions: '4,4,1',
        race_points: '4,4,1',
        race_ids: '101,102,103',
        race_statuses: 'FINISHED,FINISHED,FINISHED',
      },
    ]);

    // b1 and b2 are tied at 7; the backend reports the tie and the renderer
    // assembles the tied-group display from the loaded entries.
    window.electron.sqlite.heatRaceDB.explainTieBreak.mockResolvedValueOnce({
      tied: true,
      totalA: 7,
      totalB: 7,
      winnerBoatId: 'b1',
      route: { rule: 'SHRS 5.7(i)', note: '' },
      steps: [],
      raceGrid: [],
      sharedRacePairs: [],
      sharedQualRacePairs: [],
    });

    const { result } = renderHook(() => useLeaderboard(88));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setCompareMode(true);
    });

    act(() => {
      result.current.handleCompareRowClick('b1');
      result.current.handleCompareRowClick('b2');
    });

    await waitFor(() => expect(result.current.compareInfo?.tied).toBe(true));
    expect(result.current.compareInfo.otherTiedCount).toBe(1);
    expect(
      result.current.compareInfo.tiedGroupEntries.map((row) => row.boat_id),
    ).toEqual(['b1', 'b2', 'b3']);
  });

  it('exposes shared-race ids as strings so leaderboard cells highlight', async () => {
    window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce([
      {
        boat_id: 'b1',
        name: 'Ana',
        surname: 'A',
        country: 'CRO',
        boat_number: '101',
        boat_type: 'IOM',
        place: 1,
        total_points_event: 5,
        race_positions: '1,4',
        race_points: '1,4',
        race_ids: '101,102',
        race_statuses: 'FINISHED,FINISHED',
      },
      {
        boat_id: 'b2',
        name: 'Bruno',
        surname: 'B',
        country: 'CRO',
        boat_number: '102',
        boat_type: 'IOM',
        place: 2,
        total_points_event: 5,
        race_positions: '2,3',
        race_points: '2,3',
        race_ids: '101,102',
        race_statuses: 'FINISHED,FINISHED',
      },
    ]);

    // Backend returns numeric race ids; the hook must coerce them to strings so
    // they match the CSV-split (string) race_ids the leaderboard cells use.
    window.electron.sqlite.heatRaceDB.explainTieBreak.mockResolvedValueOnce({
      tied: true,
      totalA: 5,
      totalB: 5,
      winnerBoatId: 'b1',
      route: { rule: 'SHRS 5.7(i)', note: '' },
      steps: [],
      raceGrid: [],
      sharedRacePairs: [
        { raceId: 101, displayA: 1, displayB: 2 },
        { raceId: 102, displayA: 4, displayB: 3 },
      ],
      sharedQualRacePairs: [{ raceId: 101, displayA: 1, displayB: 2 }],
    });

    const { result } = renderHook(() => useLeaderboard(91));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setCompareMode(true);
    });
    act(() => {
      result.current.handleCompareRowClick('b1');
      result.current.handleCompareRowClick('b2');
    });

    await waitFor(() => expect(result.current.compareInfo).not.toBeNull());
    const { sharedIds, sharedQualIds } = result.current.compareInfo;
    expect(sharedIds.has('101')).toBe(true);
    expect(sharedIds.has('102')).toBe(true);
    expect(sharedIds.has(101)).toBe(false); // not numbers
    expect(sharedQualIds.has('101')).toBe(true);
  });
});
