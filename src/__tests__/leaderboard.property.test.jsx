/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  applyExclusions,
  getExcludeCount,
} from '../renderer/utils/leaderboardUtils';
import useLeaderboard from '../renderer/hooks/useLeaderboard';
import realExplainTieBreak from '../main/functions/explainTieBreak';
import { db } from '../../public/Database/DBManager';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

const mockPrepare = db.prepare;

// Serve every query explainTieBreak issues (qualifying, all in one heat) from
// the two boats' score arrays so the UI exercises the real backend tie-break.
function setupDb(a, b) {
  const toRaces = (points) =>
    points.map((p, i) => ({
      race_id: i + 1,
      race_number: i + 1,
      points: p,
      status: 'FINISHED',
      heat_type: 'Qualifying',
      heat_name: 'Heat A',
    }));
  const data = { A: toRaces(a), B: toRaces(b) };

  mockPrepare.mockImplementation((sql) => {
    const flat = sql.replace(/\s+/g, ' ');
    return {
      get: () =>
        flat.includes('discard_profile')
          ? { discard_profile: 'standard' }
          : undefined,
      all: (_eventId, boatId, heatType) => {
        if (flat.includes('SELECT DISTINCT s.boat_id')) {
          return [{ boat_id: 'A' }, { boat_id: 'B' }];
        }
        const races = data[boatId] || [];
        if (flat.includes("IN ('Qualifying', 'Final')")) {
          return races.map((r) => ({ ...r }));
        }
        if (
          flat.includes('h.heat_type = ?') &&
          flat.includes('ORDER BY r.race_number ASC')
        ) {
          return heatType === 'Qualifying'
            ? [...races].sort(
                (x, y) =>
                  x.race_number - y.race_number || x.race_id - y.race_id,
              )
            : [];
        }
        if (flat.includes('ORDER BY r.race_number DESC, s.race_id DESC')) {
          return [...races]
            .sort(
              (x, y) => y.race_number - x.race_number || y.race_id - x.race_id,
            )
            .map((r) => ({
              race_id: r.race_id,
              race_number: r.race_number,
              points: r.points,
            }));
        }
        if (flat.includes('ORDER BY points DESC')) {
          return [...races].sort(
            (x, y) =>
              y.points - x.points ||
              x.race_number - y.race_number ||
              x.race_id - y.race_id,
          );
        }
        if (flat.includes('ORDER BY r.race_number DESC')) {
          return [...races]
            .sort((x, y) => y.race_number - x.race_number)
            .map((r) => ({ points: r.points }));
        }
        return [];
      },
    };
  });
}

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

      const { markedRaces, total } = applyExclusions(
        raw,
        statuses,
        scoreValues,
      );
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
          getMaxHeatSize: jest.fn().mockResolvedValue(0),
          explainTieBreak: jest.fn((eventId, x, y, isFinal) =>
            Promise.resolve(realExplainTieBreak(eventId, x, y, isFinal)),
          ),
        },
      },
    };
  });

  it('matches A8.1/A8.2 expected winner across random tied scenarios', async () => {
    const prng = makePrng(1701);
    let checked = 0;

    const sum = (arr) => arr.reduce((acc, v) => acc + v, 0);

    while (checked < 40) {
      const a = [
        randInt(prng, 1, 12),
        randInt(prng, 1, 12),
        randInt(prng, 1, 12),
      ];
      const b = [
        randInt(prng, 1, 12),
        randInt(prng, 1, 12),
        randInt(prng, 1, 12),
      ];

      // The backend only applies a tie-break when series totals are equal
      // (3 races => no discards, so the total is the raw sum).
      if (sum(a) !== sum(b)) {
        continue;
      }

      const expected = expectedTieBreakWinner(a, b);
      if (!expected) {
        continue;
      }

      setupDb(a, b);
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

      const { result, unmount } = renderHook(() =>
        useLeaderboard(1000 + checked),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setCompareMode(true);
      });

      act(() => {
        result.current.handleCompareRowClick('A');
        result.current.handleCompareRowClick('B');
      });

      await waitFor(() =>
        expect(result.current.compareInfo?.tieBreak?.winner?.boat_id).toBe(
          expected === 'A' ? 'A' : 'B',
        ),
      );

      unmount();
      checked += 1;
    }
  });
});
