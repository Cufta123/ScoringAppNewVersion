/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import calculateBoatScores from '../main/functions/calculateBoatScores';
import useLeaderboard from '../renderer/hooks/useLeaderboard';
import { db } from '../../public/Database/DBManager';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

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

const mockPrepare = db.prepare;

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

function makeTiedPair(prng, length) {
  const a = Array.from({ length }, () => randInt(prng, 1, 12));
  const b = [...a];

  let changed = false;
  for (let tries = 0; tries < 30 && !changed; tries += 1) {
    const i = randInt(prng, 0, length - 1);
    let j = randInt(prng, 0, length - 1);
    if (i === j) j = (j + 1) % length;
    const delta = randInt(prng, 1, 3);

    if (b[i] + delta <= 12 && b[j] - delta >= 1) {
      b[i] += delta;
      b[j] -= delta;
      changed = true;
    }
  }

  if (!changed) {
    const i = 0;
    const j = length - 1;
    if (b[i] < 12 && b[j] > 1) {
      b[i] += 1;
      b[j] -= 1;
      changed = true;
    }
  }

  return changed ? { a, b } : null;
}

function setupMockDb(scoresA81Map, scoresA82Map, raceScoresMap) {
  mockPrepare.mockImplementation((sql) => ({
    all: (_eventId, boatId) => {
      if (sql.includes('SELECT s.race_id, r.race_number, s.points')) {
        return raceScoresMap[boatId] || [];
      }
      if (sql.includes('ORDER BY points DESC')) {
        return (scoresA81Map[boatId] || []).map((row) => ({
          points: row.points,
          status: row.status || 'FINISHED',
          race_id: row.race_id,
          race_number: row.race_number,
        }));
      }
      if (sql.includes('ORDER BY r.race_number DESC')) {
        return (scoresA82Map[boatId] || []).map((points) => ({ points }));
      }
      return [];
    },
  }));
}

function buildScenario(mode, aPoints, bPoints) {
  const length = aPoints.length;
  const sharedCount = mode === 'shared' ? Math.max(1, Math.floor(length / 2)) : 0;

  const racesA = [];
  const racesB = [];

  for (let i = 0; i < length; i += 1) {
    const raceNumber = i + 1;
    const shared = i < sharedCount;

    const raceIdA = shared ? 3000 + i : 1000 + i;
    const raceIdB = shared ? 3000 + i : 2000 + i;

    racesA.push({ race_id: raceIdA, race_number: raceNumber, points: aPoints[i] });
    racesB.push({ race_id: raceIdB, race_number: raceNumber, points: bPoints[i] });
  }

  const scoresA81A = [...racesA].sort(
    (x, y) => y.points - x.points || x.race_number - y.race_number || x.race_id - y.race_id,
  );
  const scoresA81B = [...racesB].sort(
    (x, y) => y.points - x.points || x.race_number - y.race_number || x.race_id - y.race_id,
  );

  const scoresA82A = [...racesA]
    .sort((x, y) => y.race_number - x.race_number)
    .map((r) => r.points);
  const scoresA82B = [...racesB]
    .sort((x, y) => y.race_number - x.race_number)
    .map((r) => r.points);

  return {
    backend: {
      scoresA81Map: { A: scoresA81A, B: scoresA81B },
      scoresA82Map: { A: scoresA82A, B: scoresA82B },
      raceScoresMap: { A: racesA, B: racesB },
      results: [
        { boat_id: 'A', number_of_races: length, total_points_event: 0 },
        { boat_id: 'B', number_of_races: length, total_points_event: 0 },
      ],
    },
    uiRows: [
      {
        boat_id: 'A',
        name: 'Boat',
        surname: 'A',
        country: 'CRO',
        boat_number: '101',
        boat_type: 'IOM',
        place: 1,
        total_points_event: 999,
        race_positions: racesA.map((r) => r.points).join(','),
        race_points: racesA.map((r) => r.points).join(','),
        race_ids: racesA.map((r) => r.race_id).join(','),
        race_statuses: racesA.map(() => 'FINISHED').join(','),
      },
      {
        boat_id: 'B',
        name: 'Boat',
        surname: 'B',
        country: 'CRO',
        boat_number: '102',
        boat_type: 'IOM',
        place: 2,
        total_points_event: 999,
        race_positions: racesB.map((r) => r.points).join(','),
        race_points: racesB.map((r) => r.points).join(','),
        race_ids: racesB.map((r) => r.race_id).join(','),
        race_statuses: racesB.map(() => 'FINISHED').join(','),
      },
    ],
  };
}

describe('Property-based backend/UI tie-break parity', () => {
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

  it(
    'matches backend winner with UI tie-break winner for shared and non-shared random scenarios',
    async () => {
    const prng = makePrng(20260410);
    let checkedShared = 0;
    let checkedNonShared = 0;

    for (let trial = 0; trial < 40; trial += 1) {
      const mode = trial % 2 === 0 ? 'shared' : 'nonshared';
      const raceLen = 3;
      const pair = makeTiedPair(prng, raceLen);
      if (!pair) continue;

      const { backend, uiRows } = buildScenario(mode, pair.a, pair.b);

      setupMockDb(backend.scoresA81Map, backend.scoresA82Map, backend.raceScoresMap);
      const pointsMap = new Map();
      const backendTable = calculateBoatScores(backend.results, 1, pointsMap);
      const backendWinner = backendTable.find((row) => row.place === 1)?.boat_id;

      window.electron.sqlite.heatRaceDB.readLeaderboard.mockResolvedValueOnce(uiRows);
      const { result, unmount } = renderHook(() => useLeaderboard(9000 + trial));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setCompareMode(true);
      });

      act(() => {
        result.current.handleCompareRowClick('A');
        result.current.handleCompareRowClick('B');
      });

      const uiWinner = result.current.compareInfo?.tieBreak?.winner?.boat_id;

      // UI can keep tie unresolved (null) while backend falls back lexicographically.
      // Validate parity when UI tie-break resolves to a concrete winner.
      if (uiWinner) {
        expect(uiWinner).toBe(backendWinner);
        if (mode === 'shared') checkedShared += 1;
        if (mode === 'nonshared') checkedNonShared += 1;
      }

      unmount();
    }

    expect(checkedShared).toBeGreaterThanOrEqual(6);
    expect(checkedNonShared).toBeGreaterThanOrEqual(6);
    },
    20000,
  );
});
