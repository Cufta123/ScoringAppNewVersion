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

  it('keeps a DPI cell at the protest-committee-typed points, not fleet size + 1 (RRS A10 / M9)', async () => {
    const { result } = renderHook(() => useLeaderboard(1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    // PC imposes a discretionary penalty of 2 points for this race. The old bug
    // auto-scored DPI like DSQ (fleet size 3 + 1 = 4); the typed value must win.
    act(() => {
      result.current.handleRaceChange('b2', 0, 2, 'DPI');
    });

    const edited = result.current.editableLeaderboard.find(
      (e) => e.boat_id === 'b2',
    );
    expect(edited.races[0]).toBe('2');
    expect(edited.race_statuses[0]).toBe('DPI');
    expect(edited.computed_total).toBe(2);
    expect(edited.race_points[0]).toBe('2');
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

  describe('final-series discards are fleet-wide, not series-wide (SHRS 5.1/5.4)', () => {
    // Gold sailed 8 final races -> 2 discards under SHRS 5.4. Silver sailed only
    // 5 -> 1 discard. A series-wide max across all fleets (8) would wrongly
    // discard 2 of Silver's 5 scores.
    const makeFinalRow = (boatId, sailNo, group, positions, raceIdBase) => ({
      boat_id: boatId,
      name: `Sailor ${boatId}`,
      surname: boatId,
      country: 'CRO',
      boat_number: sailNo,
      boat_type: 'IOM',
      placement_group: group,
      total_points_final: positions.reduce((s, v) => s + v, 0),
      race_positions: positions.join(','),
      race_points: positions.join(','),
      race_ids: positions.map((_v, i) => String(raceIdBase + i)).join(','),
      race_statuses: positions.map(() => 'FINISHED').join(','),
    });

    const finalRows = [
      makeFinalRow('g1', '101', 'Gold', [8, 7, 6, 5, 4, 3, 2, 1], 800),
      makeFinalRow('s1', '201', 'Silver', [5, 4, 3, 2, 1], 900),
    ];

    beforeEach(() => {
      window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
        { heat_type: 'Final' },
      ]);
      window.electron.sqlite.heatRaceDB.readFinalLeaderboard.mockResolvedValue(
        JSON.parse(JSON.stringify(finalRows)),
      );
    });

    it('scores each final fleet with its own race count on load (F-Tot)', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

      const gold = result.current.leaderboard.find((e) => e.boat_id === 'g1');
      const silver = result.current.leaderboard.find((e) => e.boat_id === 's1');

      // Gold: 8 races -> 2 discards (drop 8 and 7) -> total 21.
      expect(gold.computed_total).toBe(21);
      expect(gold.races).toEqual(['(8)', '(7)', '6', '5', '4', '3', '2', '1']);

      // Silver: 5 races -> 1 discard (drop 5) -> total 10, NOT the 6 a
      // series-wide max of 8 would produce.
      expect(silver.computed_total).toBe(10);
      expect(silver.races).toEqual(['(5)', '4', '3', '2', '1']);
    });

    it('keeps the fleet-wide discard count in the edit preview', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

      await act(async () => {
        await result.current.toggleEditMode();
      });
      // Shift OFF: change only the Silver boat's first race (5 -> 1).
      act(() => {
        result.current.handleRaceChange('s1', 0, 1, 'FINISHED');
      });

      const silver = result.current.editableLeaderboard.find(
        (e) => e.boat_id === 's1',
      );
      // [1,4,3,2,1] with 1 fleet-wide discard (drop 4) -> 7. A series-wide
      // count (2 discards) would give 4.
      expect(silver.computed_total).toBe(7);
      expect(silver.races).toEqual(['1', '(4)', '3', '2', '1']);
    });
  });

  // RULE-M16 / RRS A6.1: "If a boat is disqualified from a race or retires
  // after finishing, each boat with a worse finishing place shall be moved up
  // one place." Mandatory — so the edit preview must promote even with the
  // "Shift other boats" toggle OFF, or the saved result (which the backend
  // promotes regardless) would differ from what the scorer saw.
  describe('RULE-M16: A6.1 promotion applies with shifting OFF', () => {
    it('moves boats behind a DSQ up one place without the shift toggle', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      // Shift stays OFF (its default after toggleEditMode).
      act(() => {
        result.current.handleRaceChange('b1', 0, null, 'DSQ');
      });

      const after = result.current.editableLeaderboard;
      const get = (id) => after.find((e) => e.boat_id === id);

      // b1 finished 1st and is disqualified; b2 (2nd) and b3 (3rd) move up.
      expect(get('b1').race_statuses[0]).toBe('DSQ');
      expect(get('b2').races[0]).toBe('1');
      expect(get('b3').races[0]).toBe('2');
    });

    it('still leaves other boats alone for a plain place edit with shifting OFF', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b1', 0, 3, 'FINISHED');
      });

      const after = result.current.editableLeaderboard;
      const get = (id) => after.find((e) => e.boat_id === id);

      expect(get('b1').races[0]).toBe('3');
      // Manual override: the others keep their places even though that ties b3.
      expect(get('b2').races[0]).toBe('2');
      expect(get('b3').races[0]).toBe('3');
    });
  });

  // SHRS 5.6: "If the protest committee decides to give redress based on
  // average points, averages shall be calculated separately for each of the
  // Qualifying and Final Series." A final-series RDG2 must therefore average
  // ONLY final races — the qualifying scores of the same boat are irrelevant,
  // however different they are.
  describe('RULE-M10: RDG2 averages are per-series (SHRS 5.6)', () => {
    const makeFinalRow = (boatId, sailNo, finalPoints) => ({
      boat_id: boatId,
      name: `Sailor ${boatId}`,
      surname: boatId,
      country: 'CRO',
      boat_number: sailNo,
      boat_type: 'IOM',
      placement_group: 'Gold',
      total_points_final: finalPoints.reduce((s, v) => s + v, 0),
      race_positions: finalPoints.join(','),
      race_points: finalPoints.join(','),
      race_ids: finalPoints.map((_v, i) => String(300 + i)).join(','),
      race_statuses: finalPoints.map(() => 'FINISHED').join(','),
    });

    beforeEach(() => {
      window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
        { heat_type: 'Final' },
      ]);
      // Qualifying scores are deliberately huge so that pooling them into the
      // average would be unmistakable in the result.
      window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValue([
        {
          boat_id: 'b1',
          name: 'Ana',
          surname: 'A',
          country: 'CRO',
          boat_number: '101',
          boat_type: 'IOM',
          place: 1,
          total_points_event: 180,
          race_positions: '90,90',
          race_points: '90,90',
          race_ids: '101,102',
          race_statuses: 'FINISHED,FINISHED',
        },
      ]);
      window.electron.sqlite.heatRaceDB.readFinalLeaderboard.mockResolvedValue([
        makeFinalRow('b1', '101', [2, 4, 7]),
      ]);
    });

    it('averages only the final-series races, ignoring qualifying points', async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

      await act(async () => {
        await result.current.toggleEditMode();
      });

      // Redress in final race 1 (index 0), averaged over final races 2 and 3.
      // `selectedQualIndices` is the removed cross-series field: passing it
      // here proves a stale caller can no longer drag qualifying races into a
      // final-series average (the old code pooled exactly this set).
      act(() => {
        result.current.setRdg2Picker({
          boatId: 'b1',
          raceIndex: 0,
          selectedIndices: new Set([1, 2]),
          selectedQualIndices: new Set([0, 1]),
        });
      });
      act(() => {
        result.current.confirmRdg2();
      });

      const entry = result.current.editableLeaderboard.find(
        (e) => e.boat_id === 'b1',
      );
      expect(entry.race_statuses[0]).toBe('RDG2');
      // (4 + 7) / 2 = 5.5. Pooling the two qualifying 90s would give 47.75.
      expect(
        parseFloat(String(entry.race_points[0]).replace(/[()]/g, '')),
      ).toBe(5.5);
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
      // Only the edited boat is sent; b1 and b2 stay tied on place 2. The op
      // carries the shift-toggle state from when the edit was made (OFF).
      expect(ops).toEqual([
        {
          raceId: '201',
          boatId: 'b1',
          newPosition: 2,
          entryStatus: 'FINISHED',
          shiftPositions: false,
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
      // b1 takes place 2; b2 is displaced to b1's vacated place 1. Both are
      // direct assignments (shift OFF) so the backend must not ripple them.
      expect(ops).toContainEqual({
        raceId: '201',
        boatId: 'b1',
        newPosition: 2,
        entryStatus: 'FINISHED',
        shiftPositions: false,
      });
      expect(ops).toContainEqual({
        raceId: '201',
        boatId: 'b2',
        newPosition: 1,
        entryStatus: 'FINISHED',
        shiftPositions: false,
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
    // Each op carries the shift-toggle state from when that edit was made.
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
          shiftPositions: false,
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

  it('keeps the draft and edit mode when atomic save fails so the user can retry', async () => {
    window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mockRejectedValueOnce(
      new Error('Simulated failure'),
    );

    const { result } = renderHook(() => useLeaderboard(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
    });

    act(() => {
      result.current.handleRaceChange('b2', 0, null, 'DSQ');
    });

    const draftBeforeSave = JSON.parse(
      JSON.stringify(result.current.editableLeaderboard),
    );

    await act(async () => {
      await result.current.handleSave();
    });

    // The draft (including the DSQ edit) survives the failure — wiping only
    // the visible state would leave the queued edit invisible but still
    // pending, and a retry must resend exactly what the user sees.
    expect(result.current.editableLeaderboard).toEqual(draftBeforeSave);
    expect(result.current.editMode).toBe(true);
    expect(reportError).toHaveBeenCalledWith(
      'Could not save leaderboard changes.',
      expect.any(Error),
    );

    // Retrying the save resends the same single edit.
    await act(async () => {
      await result.current.handleSave();
    });
    expect(
      window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
    ).toHaveBeenCalledTimes(2);
    const [, retryOps] =
      window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
        .calls[1];
    expect(retryOps).toEqual([
      {
        raceId: '101',
        boatId: 'b2',
        newPosition: 4,
        entryStatus: 'DSQ',
        shiftPositions: false,
      },
    ]);
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

  // ─── LB-1 / LB-2 / LB-3 / LB-5 / LB-7 / LB-8 regressions ───────────────────

  describe('LB-2: ref-based double-submit guard in handleSave', () => {
    const { confirmChoice } = require('../renderer/utils/userFeedback');

    it('starts only one save chain when handleSave is called twice rapidly', async () => {
      // Hold the confirm dialog open so both clicks land while `saving` state is
      // still false — only the synchronous ref guard can block the second click.
      let resolveChoice;
      confirmChoice.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveChoice = resolve;
          }),
      );

      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      // Create a duplicate place (b1 -> 2 collides with b2) so a dialog opens.
      act(() => {
        result.current.handleRaceChange('b1', 0, 2, 'FINISHED');
      });

      const first = result.current.handleSave();
      const second = result.current.handleSave();
      await act(async () => {
        resolveChoice('extra');
        await Promise.all([first, second]);
      });

      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('LB-3: RDG2 picker does not override a later status change', () => {
    it('closes the picker on a non-RDG2 status change so confirmRdg2 is a no-op', async () => {
      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });

      act(() => {
        result.current.setRdg2Picker({
          boatId: 'b1',
          raceIndex: 0,
          selectedIndices: new Set([0]),
        });
      });

      // User changes the status to DNS while the picker is open.
      act(() => {
        result.current.handleRaceChange('b1', 0, null, 'DNS');
      });

      // handleRaceChange cleared the picker, so confirmRdg2 must not re-apply
      // RDG2 over the user's DNS choice.
      act(() => {
        result.current.confirmRdg2();
      });

      const entry = result.current.editableLeaderboard.find(
        (e) => e.boat_id === 'b1',
      );
      expect(result.current.rdg2Picker).toBeNull();
      expect(entry.race_statuses[0]).toBe('DNS');
    });
  });

  describe('LB-5: edits cleared before refetch after a successful save', () => {
    it('leaves edit mode and clears edits even when the post-save refetch fails', async () => {
      // First readLeaderboard call is the mount fetch; the second is the
      // post-save refetch, which we make fail to prove the clears happen first.
      window.electron.sqlite.heatRaceDB.readLeaderboard
        .mockResolvedValueOnce(JSON.parse(JSON.stringify(baseLeaderboardRows)))
        .mockRejectedValueOnce(new Error('Simulated refetch failure'));

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

      // The atomic save succeeded; the refetch failed, but edit mode was already
      // exited and the edits cleared before the refetch began.
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).toHaveBeenCalledTimes(1);
      expect(result.current.editMode).toBe(false);

      // A retry must not resend the stale pre-save DSQ edit.
      await act(async () => {
        await result.current.handleSave();
      });
      const [, retryOps] =
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
          .calls[1];
      expect(retryOps).toEqual([]);
    });
  });

  describe('LB-1: fetch cancellation and stale-edit clearing', () => {
    it('exits edit mode and clears queued edits when the series flips to final and re-fetches', async () => {
      let resolveHeats;
      window.electron.sqlite.heatRaceDB.readAllHeats.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveHeats = resolve;
          }),
      );
      window.electron.sqlite.heatRaceDB.readFinalLeaderboard.mockResolvedValue([
        {
          boat_id: 'f1',
          name: 'Final',
          surname: 'One',
          country: 'CRO',
          boat_number: '901',
          boat_type: 'IOM',
          place: 1,
          total_points_final: 1,
          race_positions: '1',
          race_points: '1',
          race_ids: '201',
          race_statuses: 'FINISHED',
        },
      ]);

      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b2', 0, null, 'DSQ');
      });
      expect(result.current.editMode).toBe(true);

      // Final heats arrive -> fetchLeaderboard re-runs in final mode, which must
      // clear the queued edit and leave edit mode.
      await act(async () => {
        resolveHeats([{ heat_type: 'Final' }]);
      });

      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
      await waitFor(() => expect(result.current.editMode).toBe(false));

      // The queued DSQ edit was cleared by the re-fetch: a save sends nothing.
      await act(async () => {
        await result.current.handleSave();
      });
      const [, ops] =
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
          .calls[0];
      expect(ops).toEqual([]);
    });

    it('ignores a late qualifying fetch once the final series has started', async () => {
      let releaseQualifyingRead;
      window.electron.sqlite.heatRaceDB.readLeaderboard.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseQualifyingRead = resolve;
          }),
      );

      window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
        { heat_type: 'Final' },
      ]);
      const finalRows = [
        {
          boat_id: 'f1',
          name: 'Final',
          surname: 'One',
          country: 'CRO',
          boat_number: '901',
          boat_type: 'IOM',
          placement_group: 'Gold',
          place: 1,
          total_points_final: 1,
          race_positions: '1',
          race_points: '1',
          race_ids: '201',
          race_statuses: 'FINISHED',
        },
      ];
      window.electron.sqlite.heatRaceDB.readFinalLeaderboard.mockResolvedValue(
        JSON.parse(JSON.stringify(finalRows)),
      );
      window.electron.sqlite.heatRaceDB.readOverallLeaderboard.mockResolvedValue(
        [],
      );

      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
      await waitFor(() =>
        expect(result.current.leaderboard.some((e) => e.boat_id === 'f1')).toBe(
          true,
        ),
      );

      // Release the stale qualifying fetch after the final data is in place.
      await act(async () => {
        releaseQualifyingRead(JSON.parse(JSON.stringify(baseLeaderboardRows)));
      });

      // The stale qualifying fetch must not have overwritten the final standings.
      expect(result.current.leaderboard.some((e) => e.boat_id === 'f1')).toBe(
        true,
      );
      expect(result.current.leaderboard.some((e) => e.boat_id === 'b1')).toBe(
        false,
      );
    });
  });

  describe('LB-7: shift-mode cascade moves position-keeping penalties', () => {
    it('shifts a ZFP boat with the finishers and keeps every place unique', async () => {
      window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce([
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
          total_points_event: 3,
          race_positions: '2',
          race_points: '3',
          race_ids: '101',
          race_statuses: 'ZFP',
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
        {
          boat_id: 'b4',
          name: 'Dora',
          surname: 'D',
          country: 'CRO',
          boat_number: '104',
          boat_type: 'IOM',
          place: 4,
          total_points_event: 4,
          race_positions: '4',
          race_points: '4',
          race_ids: '101',
          race_statuses: 'FINISHED',
        },
      ]);

      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.setShiftPositions(true);
      });
      // Move b4 (place 4) up to place 1; everyone between must shift down.
      act(() => {
        result.current.handleRaceChange('b4', 0, 1, 'FINISHED');
      });

      const get = (id) =>
        result.current.editableLeaderboard.find((e) => e.boat_id === id);
      const places = ['b1', 'b2', 'b3', 'b4'].map((id) => get(id).races[0]);

      // Every place must stay unique — the ZFP boat shifts from 2 to 3.
      expect(new Set(places).size).toBe(4);
      expect(get('b4').races[0]).toBe('1');
      expect(get('b1').races[0]).toBe('2');
      expect(get('b2').races[0]).toBe('3');
      expect(get('b3').races[0]).toBe('4');
      expect(get('b2').race_statuses[0]).toBe('ZFP');
    });
  });

  describe('LB-8: N-boat swap chain in computeSwapEdits', () => {
    const { confirmChoice } = require('../renderer/utils/userFeedback');

    it('does not collapse multiple displaced boats onto one place', async () => {
      confirmChoice.mockResolvedValueOnce('confirm');
      window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce([
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
      ]);

      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      // Shift OFF: move b1 and b3 both onto place 2 (b2's place) — a 3-way tie.
      act(() => {
        result.current.handleRaceChange('b1', 0, 2, 'FINISHED');
      });
      act(() => {
        result.current.handleRaceChange('b3', 0, 2, 'FINISHED');
      });

      await act(async () => {
        await result.current.handleSave();
      });

      const [, ops] =
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
          .calls[0];
      // b1 keeps place 2; b2 is rotated into the vacated place 1. b3 reverts to
      // its saved place 3, so it is a no-op and must not be sent. Crucially, the
      // old bug sent b3 to place 1 too — collapsing it onto b2's target.
      expect(ops).toHaveLength(2);
      expect(ops).toContainEqual({
        raceId: '101',
        boatId: 'b1',
        newPosition: 2,
        entryStatus: 'FINISHED',
        shiftPositions: false,
      });
      expect(ops).toContainEqual({
        raceId: '101',
        boatId: 'b2',
        newPosition: 1,
        entryStatus: 'FINISHED',
        shiftPositions: false,
      });
      expect(ops).not.toContainEqual({
        raceId: '101',
        boatId: 'b3',
        newPosition: 1,
        entryStatus: 'FINISHED',
        shiftPositions: false,
      });
    });
  });
});
