/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  applyExclusions,
  getExcludeCount,
} from '../renderer/utils/leaderboardUtils';
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

function expectedTieBreakWinner(a, b) {
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);

  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] < sortedB[i]) return 'A';
    if (sortedB[i] < sortedA[i]) return 'B';
  }

  for (let i = a.length - 1; i >= 0; i -= 1) {
    if (a[i] < b[i]) return 'A';
    if (b[i] < a[i]) return 'B';
  }

  return null;
}

describe('Property-based: leaderboard exclusions invariants', () => {
  it('keeps exclusion and total invariants across random race/status combinations', () => {
    const prng = makePrng(20260410);
    const nonExcludable = new Set(['DNE', 'DGM']);
    const statusesPool = [
      'FINISHED',
      'DNF',
      'DNS',
      'DSQ',
      'ZFP',
      'SCP',
      'DNE',
      'DGM',
    ];

    for (let trial = 0; trial < 250; trial += 1) {
      const races = randInt(prng, 1, 20);
      const raw = [];
      const scoreValues = [];
      const statuses = [];

      for (let i = 0; i < races; i += 1) {
        const score = randInt(prng, 1, 60);
        raw.push(String(score));
        scoreValues.push(String(score));
        statuses.push(statusesPool[randInt(prng, 0, statusesPool.length - 1)]);
      }

      const { markedRaces, total } = applyExclusions(raw, statuses, scoreValues);
      const excludeCount = getExcludeCount(races);
      const excludedIdx = markedRaces
        .map((v, idx) => (String(v).startsWith('(') ? idx : -1))
        .filter((idx) => idx !== -1);

      const excludableCount = statuses.filter(
        (s) => !nonExcludable.has(String(s).toUpperCase()),
      ).length;
      const expectedExcludedCount = Math.min(excludeCount, excludableCount);

      expect(markedRaces).toHaveLength(races);
      expect(excludedIdx).toHaveLength(expectedExcludedCount);

      excludedIdx.forEach((idx) => {
        expect(nonExcludable.has(String(statuses[idx]).toUpperCase())).toBe(
          false,
        );
      });

      const expectedTotal = scoreValues.reduce((sum, value, idx) => {
        if (excludedIdx.includes(idx)) return sum;
        return sum + parseFloat(value);
      }, 0);

      expect(total).toBe(expectedTotal);
    }
  });
});

describe('Property-based: tie-break winner invariants', () => {
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
        },
      },
    };
  });

  it('matches A8.1/A8.2 expected winner across random tied scenarios', async () => {
    const prng = makePrng(1701);
    let checked = 0;

    while (checked < 40) {
      const a = [randInt(prng, 1, 12), randInt(prng, 1, 12), randInt(prng, 1, 12)];
      const b = [randInt(prng, 1, 12), randInt(prng, 1, 12), randInt(prng, 1, 12)];
      const expected = expectedTieBreakWinner(a, b);

      if (!expected) {
        continue;
      }

      window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce([
        {
          boat_id: 'A',
          name: 'Boat',
          surname: 'A',
          country: 'CRO',
          boat_number: '101',
          boat_type: 'IOM',
          place: 1,
          total_points_event: 99,
          race_positions: a.join(','),
          race_points: a.join(','),
          race_ids: '1,2,3',
          race_statuses: 'FINISHED,FINISHED,FINISHED',
        },
        {
          boat_id: 'B',
          name: 'Boat',
          surname: 'B',
          country: 'CRO',
          boat_number: '102',
          boat_type: 'IOM',
          place: 2,
          total_points_event: 99,
          race_positions: b.join(','),
          race_points: b.join(','),
          race_ids: '1,2,3',
          race_statuses: 'FINISHED,FINISHED,FINISHED',
        },
      ]);

      const { result, unmount } = renderHook(() => useLeaderboard(1000 + checked));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setCompareMode(true);
      });

      act(() => {
        result.current.handleCompareRowClick('A');
        result.current.handleCompareRowClick('B');
      });

      const winnerId = result.current.compareInfo?.tieBreak?.winner?.boat_id;
      expect(winnerId).toBe(expected === 'A' ? 'A' : 'B');

      unmount();
      checked += 1;
    }
  });
});
