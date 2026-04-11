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

function makePrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randInt(prng, min, max) {
  return Math.floor(prng() * (max - min + 1)) + min;
}

function parseScore(value) {
  const n = parseFloat(String(value ?? '').replace(/[()]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function roundToTenthHalfUp(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function buildRandomBoatRow(prng, boatId, raceCount = 6) {
  const penaltyStatuses = [
    'FINISHED',
    'FINISHED',
    'FINISHED',
    'DNF',
    'ZFP',
    'SCP',
  ];

  const races = [];
  const statuses = [];
  for (let i = 0; i < raceCount; i += 1) {
    races.push(randInt(prng, 1, 12));
    statuses.push(
      penaltyStatuses[randInt(prng, 0, penaltyStatuses.length - 1)],
    );
  }

  return {
    boat_id: boatId,
    name: `Boat${boatId}`,
    surname: 'Test',
    country: 'CRO',
    boat_number: String(100 + randInt(prng, 1, 99)),
    boat_type: 'IOM',
    place: 1,
    total_points_event: races.reduce((s, v) => s + v, 0),
    race_positions: races.join(','),
    race_points: races.join(','),
    race_ids: Array.from({ length: raceCount }, (_v, i) =>
      String(1000 + i),
    ).join(','),
    race_statuses: statuses.join(','),
  };
}

describe('Property-based: RDG1/RDG2/RDG3 random stress', () => {
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
          readLeaderboard: jest.fn(),
          readOverallLeaderboard: jest.fn().mockResolvedValue([]),
          updateRaceResult: jest.fn().mockResolvedValue(true),
          saveLeaderboardRaceResultsAtomic: jest
            .fn()
            .mockResolvedValue({ success: true, updatedCount: 0 }),
        },
      },
    };
  });

  it('preserves numeric and status invariants for RDG1, RDG2 and RDG3 over random scenarios', async () => {
    const prng = makePrng(4042026);

    for (let trial = 0; trial < 45; trial += 1) {
      const boats = [
        buildRandomBoatRow(prng, 'A'),
        buildRandomBoatRow(prng, 'B'),
        buildRandomBoatRow(prng, 'C'),
        buildRandomBoatRow(prng, 'D'),
      ];

      window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce(
        JSON.parse(JSON.stringify(boats)),
      );

      const { result, unmount } = renderHook(() =>
        useLeaderboard(5000 + trial),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.toggleEditMode();
      });

      const boatId = 'A';
      const raceCount = result.current.editableLeaderboard[0].races.length;
      const rdg1Index = randInt(prng, 0, raceCount - 1);
      const rdg3Index = (rdg1Index + 1) % raceCount;
      const rdg2Index = (rdg1Index + 2) % raceCount;

      const beforeRdg1 = result.current.editableLeaderboard.find(
        (e) => e.boat_id === boatId,
      );
      const penaltyPosition = result.current.editableLeaderboard.length + 1;

      const rdg1Candidates = beforeRdg1.races
        .map((r, i) => ({
          index: i,
          value: parseScore(r),
          status: beforeRdg1.race_statuses?.[i] || 'FINISHED',
        }))
        .filter(
          ({ index, status, value }) =>
            index !== rdg1Index &&
            ![
              'DNF',
              'DNS',
              'DSQ',
              'OCS',
              'ZFP',
              'RET',
              'SCP',
              'BFD',
              'UFD',
              'DNC',
              'NSC',
              'WTH',
              'DNE',
              'DGM',
              'DPI',
              'RDG1',
              'RDG2',
              'RDG3',
            ].includes(status) &&
            value !== null,
        )
        .map((x) => x.value);

      const expectedRdg1 =
        rdg1Candidates.length > 0
          ? roundToTenthHalfUp(
              rdg1Candidates.reduce((sum, v) => sum + v, 0) /
                rdg1Candidates.length,
            )
          : penaltyPosition;

      act(() => {
        result.current.handleRaceChange(boatId, rdg1Index, null, 'RDG1');
      });

      const afterRdg1 = result.current.editableLeaderboard.find(
        (e) => e.boat_id === boatId,
      );
      expect(afterRdg1.race_statuses[rdg1Index]).toBe('RDG1');
      expect(parseScore(afterRdg1.race_points[rdg1Index])).toBe(expectedRdg1);

      const rdg3Value = randInt(prng, 1, 8) + 0.5;
      act(() => {
        result.current.handleRaceChange(boatId, rdg3Index, rdg3Value, 'RDG3');
      });

      const afterRdg3 = result.current.editableLeaderboard.find(
        (e) => e.boat_id === boatId,
      );
      expect(afterRdg3.race_statuses[rdg3Index]).toBe('RDG3');
      expect(parseScore(afterRdg3.race_points[rdg3Index])).toBe(rdg3Value);

      const selectedFinalIndices = new Set([
        rdg2Index,
        (rdg2Index + 1) % raceCount,
      ]);
      const selectedQualIndices = new Set([0, raceCount - 1]);

      const qualEntry = result.current.eventLeaderboard.find(
        (e) => e.boat_id === boatId,
      );
      const currentEntry = result.current.editableLeaderboard.find(
        (e) => e.boat_id === boatId,
      );

      const rdg2FinalValues = [...selectedFinalIndices]
        .filter((i) => i !== rdg2Index)
        .map((i) => {
          const status = currentEntry.race_statuses?.[i] || 'FINISHED';
          if (
            [
              'DNF',
              'DNS',
              'DSQ',
              'OCS',
              'ZFP',
              'RET',
              'SCP',
              'BFD',
              'UFD',
              'DNC',
              'NSC',
              'WTH',
              'DNE',
              'DGM',
              'DPI',
              'RDG1',
              'RDG2',
              'RDG3',
            ].includes(status)
          ) {
            return null;
          }
          return parseScore(currentEntry.races[i]);
        })
        .filter((v) => v !== null);

      const rdg2QualValues = [...selectedQualIndices]
        .map((i) => {
          const status = qualEntry.race_statuses?.[i] || 'FINISHED';
          if (
            [
              'DNF',
              'DNS',
              'DSQ',
              'OCS',
              'ZFP',
              'RET',
              'SCP',
              'BFD',
              'UFD',
              'DNC',
              'NSC',
              'WTH',
              'DNE',
              'DGM',
              'DPI',
              'RDG1',
              'RDG2',
              'RDG3',
            ].includes(status)
          ) {
            return null;
          }
          return parseScore(qualEntry.races[i]);
        })
        .filter((v) => v !== null);

      const rdg2Pool = [...rdg2QualValues, ...rdg2FinalValues];
      const expectedRdg2 =
        rdg2Pool.length > 0
          ? roundToTenthHalfUp(
              rdg2Pool.reduce((sum, v) => sum + v, 0) / rdg2Pool.length,
            )
          : penaltyPosition;

      act(() => {
        result.current.setRdg2Picker({
          boatId,
          raceIndex: rdg2Index,
          selectedIndices: selectedFinalIndices,
          selectedQualIndices,
        });
      });

      act(() => {
        result.current.confirmRdg2();
      });

      const afterRdg2 = result.current.editableLeaderboard.find(
        (e) => e.boat_id === boatId,
      );
      expect(afterRdg2.race_statuses[rdg2Index]).toBe('RDG2');
      expect(parseScore(afterRdg2.race_points[rdg2Index])).toBe(expectedRdg2);
      expect(afterRdg2.computed_total).toBeGreaterThan(0);

      unmount();
    }
  });
});
