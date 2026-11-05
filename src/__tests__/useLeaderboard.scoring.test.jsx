/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from './helpers/renderWithQuery';
import useLeaderboard from '../renderer/hooks/useLeaderboard';
import {
  reportError,
  reportInfo,
  reportWarning,
} from '../renderer/utils/userFeedback';

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

jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn().mockResolvedValue(true),
  confirmChoice: jest.fn().mockResolvedValue('cancel'),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
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
          readFinalLeaderboard: jest.fn().mockResolvedValue([]),
          readLeaderboard: jest
            .fn()
            .mockResolvedValue(JSON.parse(JSON.stringify(baseLeaderboardRows))),
          readOverallLeaderboard: jest.fn().mockResolvedValue([]),
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
    expect(edited.race_points[0]).toBe('4');
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
    // heat of 3 boats the DNF score is 4, and 30% of it is 1.2 => 3.2 points
    // (Appendix T1(b), RRS 44.3(c)), as regatta-core re-ranks the race.
    // race_points carries the scored points (drives the Gross column), not the
    // raw finishing place.
    expect(edited.race_points[0]).toBe('3.2');
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
    expect(edited.race_points[0]).toBe('2');
  });

  it('previews ZFP penalty points (not the finishing place) in the race', async () => {
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
    // ZFP keeps place 1 but adds 20% of the DNF score (4) = 0.8, so she
    // scores 1.8, not the raw place of 1 (the old bug).
    expect(edited.races[0]).toBe('1');
    expect(edited.race_statuses[0]).toBe('ZFP');
    // Gross column reads race_points: it must show the penalty points.
    expect(edited.race_points[0]).toBe('1.8');
  });

  it('a new place moves the boat and shifts the others', async () => {
    const { result } = renderHook(() => useLeaderboard(1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEditMode();
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

  describe('loading the standings', () => {
    // Every read rebuilds the standings from the scores in the main process
    // (AGENTS.md section 4), so loading is reads only: no separate recompute
    // call, and no final-standings read while the final series has not started.
    it('reads the qualifying standings only before the final series starts', async () => {
      const db = window.electron.sqlite.heatRaceDB;
      db.updateEventLeaderboard = jest.fn();
      db.updateFinalLeaderboard = jest.fn();
      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(db.readLeaderboard).toHaveBeenCalledWith(1);
      expect(db.readFinalLeaderboard).not.toHaveBeenCalled();
      expect(db.readOverallLeaderboard).not.toHaveBeenCalled();
      expect(db.updateEventLeaderboard).not.toHaveBeenCalled();
      expect(db.updateFinalLeaderboard).not.toHaveBeenCalled();
    });

    it('reads the final and overall standings once the final series has started', async () => {
      const db = window.electron.sqlite.heatRaceDB;
      db.readAllHeats.mockResolvedValue([{ heat_type: 'Final' }]);
      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
      await waitFor(() =>
        expect(db.readOverallLeaderboard).toHaveBeenCalledWith(1),
      );

      expect(db.readLeaderboard).toHaveBeenCalledWith(1);
      expect(db.readFinalLeaderboard).toHaveBeenCalledWith(1);
    });
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

    it("takes the totals and the Overall from the library's preview", async () => {
      // The draft only re-ranks the edited race; totals, discards and the
      // Overall are regatta-core's, from previewLeaderboardEdit.
      const preview = jest.fn().mockResolvedValue({
        ok: true,
        eventResults: [],
        finalResults: finalRows.map((row) =>
          row.boat_id === 'b3'
            ? {
                ...row,
                race_positions: '1',
                race_points: '1',
                total_points_final: 1,
              }
            : row,
        ),
        overallResults: [
          {
            boat_id: 'b3',
            overall_points: 4,
            qualifying_points: 3,
            overall_rank: 1,
          },
        ],
      });
      window.electron.sqlite.heatRaceDB.previewLeaderboardEdit = preview;
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));

      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b3', 0, 1, 'FINISHED');
      });

      // Sent as Save sends it: the whole race, the typed cell marked.
      await waitFor(() =>
        expect(preview).toHaveBeenCalledWith(5, [
          {
            raceId: '201',
            cells: [
              { boatId: 'b1', position: 2, status: 'FINISHED', edited: false },
              { boatId: 'b2', position: 3, status: 'FINISHED', edited: false },
              { boatId: 'b3', position: 1, status: 'FINISHED', edited: true },
            ],
          },
        ]),
      );
      await waitFor(() =>
        expect(
          result.current.editableLeaderboard.find((e) => e.boat_id === 'b3')
            .total_points_combined,
        ).toBe(4),
      );
      const after = result.current.editableLeaderboard.find(
        (e) => e.boat_id === 'b3',
      );
      expect(after.computed_total).toBe(1);
    });

    it('a refusal from the library is shown, and the draft stays', async () => {
      window.electron.sqlite.heatRaceDB.previewLeaderboardEdit = jest
        .fn()
        .mockResolvedValue({ ok: false, reason: 'Not allowed by the rules.' });
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b3', 0, 1, 'FINISHED');
      });
      await waitFor(() =>
        expect(reportWarning).toHaveBeenCalledWith(
          'Not allowed by the rules.',
          'This change cannot be saved',
        ),
      );
      expect(
        result.current.editableLeaderboard.find((e) => e.boat_id === 'b3')
          .races[0],
      ).toBe('1');
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

  describe('final-series discards as the library marks them (SHRS 5.1/5.4)', () => {
    // Gold sailed 8 final races -> 2 discards under SHRS 5.4. Silver sailed only
    // 5 -> 1 discard. The main process sends regatta-core's excluded scores
    // and totals; the screen shows them as they are.
    const makeFinalRow = (
      boatId,
      sailNo,
      group,
      positions,
      raceIdBase,
      excluded,
      total,
    ) => ({
      boat_id: boatId,
      name: `Sailor ${boatId}`,
      surname: boatId,
      country: 'CRO',
      boat_number: sailNo,
      boat_type: 'IOM',
      placement_group: group,
      total_points_final: total,
      race_positions: positions.join(','),
      race_points: positions.join(','),
      race_ids: positions.map((_v, i) => String(raceIdBase + i)).join(','),
      race_statuses: positions.map(() => 'FINISHED').join(','),
      race_excluded: excluded.join(','),
    });

    const finalRows = [
      makeFinalRow(
        'g1',
        '101',
        'Gold',
        [8, 7, 6, 5, 4, 3, 2, 1],
        800,
        [1, 1, 0, 0, 0, 0, 0, 0],
        21,
      ),
      makeFinalRow(
        's1',
        '201',
        'Silver',
        [5, 4, 3, 2, 1],
        900,
        [1, 0, 0, 0, 0],
        10,
      ),
    ];

    beforeEach(() => {
      window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
        { heat_type: 'Final' },
      ]);
      window.electron.sqlite.heatRaceDB.readFinalLeaderboard.mockResolvedValue(
        JSON.parse(JSON.stringify(finalRows)),
      );
    });

    it('shows each final fleet with its own discards on load (F-Tot)', async () => {
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
  });

  // RULE-M16 / RRS A6.1: "If a boat is disqualified from a race or retires
  // after finishing, each boat with a worse finishing place shall be moved up
  // one place." Mandatory — so the edit preview must promote even with the
  // "Shift other boats" toggle OFF, or the saved result (which the backend
  // promotes regardless) would differ from what the scorer saw.
  describe('RULE-M16: RRS A6.1 promotion in the edit preview', () => {
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

    it('a new place moves the boat; the others make room (no duplicate place)', async () => {
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
      expect(get('b2').races[0]).toBe('1');
      expect(get('b3').races[0]).toBe('2');
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

    it('sends only the final-series races chosen, never qualifying ones', async () => {
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
      // The average (RRS A9(b)) is regatta-core's, from the races sent; the
      // draft keeps her current points until its preview shows it.
      expect(entry.race_points[0]).toBe('2');
      await act(async () => {
        await result.current.handleSave();
      });
      const [, ops] =
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
          .calls[0];
      // Final races 2 and 3 (ids 301, 302): the qualifying races 101 and 102
      // are not in the selection (SHRS 5.6).
      expect(ops).toEqual([
        {
          raceId: '300',
          cells: [
            {
              boatId: 'b1',
              position: 2,
              status: 'RDG2',
              edited: true,
              rdgRaceIds: [301, 302],
              // RRS A6.2: she keeps her place, inside the race (one boat).
              heldPlace: 1,
            },
          ],
        },
      ]);
    });
  });

  describe('Save sends each touched race whole, as shown', () => {
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

    it("moving b1 onto b2's place swaps them, with no question asked", async () => {
      const { result } = renderHook(() => useLeaderboard(5));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b1', 0, 2, 'FINISHED');
      });
      await act(async () => {
        await result.current.handleSave();
      });

      expect(confirmChoice).not.toHaveBeenCalled();
      const [, ops] =
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mock
          .calls[0];
      expect(ops).toEqual([
        {
          raceId: '201',
          cells: [
            { boatId: 'b1', position: 2, status: 'FINISHED', edited: true },
            { boatId: 'b2', position: 1, status: 'FINISHED', edited: false },
            { boatId: 'b3', position: 3, status: 'FINISHED', edited: false },
          ],
        },
      ]);
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

    // The touched race is sent whole, exactly as the edit screen shows it.
    expect(
      window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
    ).toHaveBeenCalledWith(
      1,
      [
        {
          raceId: '101',
          // The whole race as shown: b2 disqualified (3 boats + 1 = 4 when no
          // heat size is known yet), b3 moved up (RRS A6.1).
          cells: [
            { boatId: 'b1', position: 1, status: 'FINISHED', edited: false },
            { boatId: 'b2', position: 4, status: 'DSQ', edited: true },
            { boatId: 'b3', position: 2, status: 'FINISHED', edited: false },
          ],
        },
      ],
      false,
    );
  });

  // The draft re-ranks each edited race (regatta-core); totals and discards
  // stay as loaded until the library's preview replaces the rows.
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

    // Retrying the save resends the same race.
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
        cells: [
          { boatId: 'b1', position: 1, status: 'FINISHED', edited: false },
          { boatId: 'b2', position: 4, status: 'DSQ', edited: true },
          { boatId: 'b3', position: 2, status: 'FINISHED', edited: false },
        ],
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
    it('starts only one save chain when handleSave is called twice rapidly', async () => {
      // Hold the write open so both clicks land while `saving` state is
      // still false — only the synchronous ref guard can block the second.
      let finishWrite;
      window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishWrite = resolve;
          }),
      );

      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b1', 0, 2, 'FINISHED');
      });

      let first;
      let second;
      await act(async () => {
        first = result.current.handleSave();
        second = result.current.handleSave();
      });
      await act(async () => {
        finishWrite({ success: true });
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

  it('refuses to save an edit started before the history changed the results', async () => {
    const { result, queryClient } = renderHook(() => useLeaderboard(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.toggleEditMode();
    });
    act(() => {
      result.current.handleRaceChange('b2', 0, null, 'DSQ');
    });
    const draft = JSON.parse(
      JSON.stringify(result.current.editableLeaderboard),
    );
    // Someone went back in the history (another screen): the results are
    // different now, and the event's queries are invalidated.
    window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValue(
      baseLeaderboardRows.map((row) =>
        row.boat_id === 'b3'
          ? { ...row, race_statuses: 'DNF', race_points: '4' }
          : row,
      ),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['event', 1] });
    });
    await waitFor(() =>
      expect(reportWarning).toHaveBeenCalledWith(
        expect.stringMatching(/changed in the history while you were editing/),
        'Results changed',
      ),
    );
    // The draft is not replaced underneath the user.
    expect(result.current.editableLeaderboard).toEqual(draft);
    await act(async () => {
      await result.current.handleSave();
    });
    // Saving would have put the old results back over the restored ones.
    expect(
      window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
    ).not.toHaveBeenCalled();
    expect(result.current.editMode).toBe(true);

    // Cancel Editing shows the results as they are now.
    await act(async () => {
      await result.current.toggleEditMode();
    });
    expect(result.current.editMode).toBe(false);
    expect(
      result.current.editableLeaderboard.find((e) => e.boat_id === 'b3')
        .race_statuses[0],
    ).toBe('DNF');
  });

  it('an unchanged reread while editing keeps the edit saveable', async () => {
    const { result, queryClient } = renderHook(() => useLeaderboard(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.toggleEditMode();
    });
    act(() => {
      result.current.handleRaceChange('b2', 0, null, 'DSQ');
    });
    // A write that changed nothing on this board (a logo, a report marked
    // read) reads the event again: the same rows come back.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['event', 1] });
    });
    expect(reportWarning).not.toHaveBeenCalledWith(
      expect.anything(),
      'Results changed',
    );
    await act(async () => {
      await result.current.handleSave();
    });
    expect(
      window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
    ).toHaveBeenCalledTimes(1);
  });

  describe('invalid typed results', () => {
    it('Save refuses while a cell holds an impossible place, and names it', async () => {
      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b2', 0, null, 'DSQ');
        result.current.reportInvalidCell(
          'b1-0',
          'Sail 101, Q1: Only 2 boats sailed this race, so the place must be 1–2.',
        );
      });

      await act(async () => {
        await result.current.handleSave();
      });
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).not.toHaveBeenCalled();
      expect(reportWarning).toHaveBeenCalledWith(
        expect.stringContaining('Sail 101, Q1'),
        'Some results are not valid',
        // The red cells and the banner count stay, so the toast closes itself.
        { inline: true },
      );
      expect(result.current.editMode).toBe(true);

      // Once the cell is fixed, the queued edit saves.
      act(() => result.current.reportInvalidCell('b1-0', null));
      await act(async () => {
        await result.current.handleSave();
      });
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).toHaveBeenCalledTimes(1);
    });

    it('Save with nothing changed writes nothing and says so', async () => {
      const { result } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      await act(async () => {
        await result.current.handleSave();
      });
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).not.toHaveBeenCalled();
      expect(reportInfo).toHaveBeenCalledWith(
        'No result was changed.',
        'Nothing to save',
      );
      expect(result.current.editMode).toBe(false);
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
      // Nothing is queued, so the retry writes nothing at all.
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('LB-1: fetch cancellation and stale-edit clearing', () => {
    it('shows nothing (loading) until the series is known, then the final standings', async () => {
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
      // The qualifying rows are in, but which series is shown (and edited)
      // is not known yet: no edit can start on the wrong one.
      await waitFor(() =>
        expect(
          window.electron.sqlite.heatRaceDB.readLeaderboard,
        ).toHaveBeenCalled(),
      );
      expect(result.current.loading).toBe(true);
      expect(result.current.leaderboard).toEqual([]);

      await act(async () => {
        resolveHeats([{ heat_type: 'Final' }]);
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.finalSeriesStarted).toBe(true);
      expect(result.current.leaderboard.map((e) => e.boat_id)).toEqual(['f1']);
    });

    it('the series flipping underneath an edit (history) refuses its Save', async () => {
      const { result, queryClient } = renderHook(() => useLeaderboard(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.toggleEditMode();
      });
      act(() => {
        result.current.handleRaceChange('b2', 0, null, 'DSQ');
      });

      // Going back in the history started the Final Series again.
      window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
        { heat_type: 'Final' },
      ]);
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['event', 1] });
      });
      await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
      await waitFor(() =>
        expect(reportWarning).toHaveBeenCalledWith(
          expect.stringMatching(/changed in the history/),
          'Results changed',
        ),
      );

      await act(async () => {
        await result.current.handleSave();
      });
      expect(
        window.electron.sqlite.heatRaceDB.saveLeaderboardRaceResultsAtomic,
      ).not.toHaveBeenCalled();
    });

    it('shows the final standings with the qualifying read, whenever it comes', async () => {
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
      await waitFor(() =>
        expect(
          window.electron.sqlite.heatRaceDB.readOverallLeaderboard,
        ).toHaveBeenCalled(),
      );
      expect(result.current.loading).toBe(true);

      // The qualifying read comes back last.
      await act(async () => {
        releaseQualifyingRead(JSON.parse(JSON.stringify(baseLeaderboardRows)));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));

      // The page shows the final fleets, never the qualifying rows as if
      // they were the final standings.
      expect(result.current.finalSeriesStarted).toBe(true);
      expect(result.current.leaderboard.some((e) => e.boat_id === 'f1')).toBe(
        true,
      );
      expect(result.current.leaderboard.some((e) => e.boat_id === 'b1')).toBe(
        false,
      );
      expect(result.current.eventLeaderboard.map((e) => e.boat_id)).toEqual([
        'b1',
        'b2',
        'b3',
      ]);
    });
  });

  describe('LB-7: a move carries position-keeping penalties along', () => {
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
});
