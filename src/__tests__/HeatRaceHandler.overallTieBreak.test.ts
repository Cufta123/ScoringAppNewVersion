export {};

type PrepareStatement = {
  get?: (...args: any[]) => any;
  all?: (...args: any[]) => any[];
  run?: (...args: any[]) => any;
};

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
  },
}));

type OverallRow = {
  boat_id: string;
  qualifying_points: number;
  final_points: number;
  overall_points: number;
  placement_group: string;
  final_place: number;
  boat_number?: number;
  boat_type?: string;
  name?: string;
  surname?: string;
  country?: string;
};

type ScoreRow = {
  race_id: number;
  race_number: number;
  points: number;
  heat_type: string;
  heat_name: string;
};

type Scenario = {
  completedFinalRaceCount: number;
  overallRows: OverallRow[];
  tieScoresByBoatId: Record<string, ScoreRow[]>;
  qualifyingFallbackRows: any[];
};

let currentScenario: Scenario;

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (sqlContains(sql, 'SELECT COUNT(*) as cnt') && sqlContains(sql, "h.heat_type = 'Final'")) {
      return {
        get: jest.fn(() => ({ cnt: currentScenario.completedFinalRaceCount })),
      };
    }

    if (
      sqlContains(sql, 'SELECT') &&
      sqlContains(sql, 'FROM FinalLeaderboard fl') &&
      sqlContains(sql, 'overall_points')
    ) {
      return {
        all: jest.fn(() => currentScenario.overallRows.map((row) => ({ ...row }))),
      };
    }

    if (
      sqlContains(sql, 'SELECT s.race_id, r.race_number, s.points, h.heat_type, h.heat_name') &&
      sqlContains(sql, 'h.heat_type IN (\'Qualifying\', \'Final\')')
    ) {
      return {
        all: jest.fn((_eventId: number, boatId: string) =>
          (currentScenario.tieScoresByBoatId[boatId] ?? []).map((row) => ({ ...row })),
        ),
      };
    }

    if (
      sqlContains(sql, 'SELECT') &&
      sqlContains(sql, 'FROM Leaderboard lb') &&
      sqlContains(sql, "'Qualifying' AS placement_group")
    ) {
      return {
        all: jest.fn(() => currentScenario.qualifyingFallbackRows.map((row) => ({ ...row }))),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

function baseScenario(): Scenario {
  return {
    completedFinalRaceCount: 1,
    overallRows: [],
    tieScoresByBoatId: {},
    qualifyingFallbackRows: [],
  };
}

describe('HeatRaceHandler readOverallLeaderboard tie-break stress tests', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    currentScenario = baseScenario();
    dbMock.prepare.mockClear();
  });

  it('ranks 3 tied Gold boats using SHRS 5.6 on mixed Q+F series scores', async () => {
    currentScenario.overallRows = [
      {
        boat_id: 'A',
        qualifying_points: 6,
        final_points: 6,
        overall_points: 12,
        placement_group: 'Gold',
        final_place: 3,
      },
      {
        boat_id: 'B',
        qualifying_points: 7,
        final_points: 5,
        overall_points: 12,
        placement_group: 'Gold',
        final_place: 1,
      },
      {
        boat_id: 'C',
        qualifying_points: 8,
        final_points: 4,
        overall_points: 12,
        placement_group: 'Gold',
        final_place: 2,
      },
    ];

    currentScenario.tieScoresByBoatId = {
      A: [
        { race_id: 1, race_number: 1, points: 6, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 2, race_number: 2, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 3, race_number: 3, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 4, race_number: 4, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 101, race_number: 1, points: 6, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 102, race_number: 2, points: 2, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 103, race_number: 3, points: 2, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 104, race_number: 4, points: 2, heat_type: 'Final', heat_name: 'Final Gold' },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 5, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 2, race_number: 2, points: 3, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 3, race_number: 3, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 4, race_number: 4, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 101, race_number: 1, points: 7, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 102, race_number: 2, points: 2, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 103, race_number: 3, points: 2, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 104, race_number: 4, points: 1, heat_type: 'Final', heat_name: 'Final Gold' },
      ],
      C: [
        { race_id: 1, race_number: 1, points: 4, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 2, race_number: 2, points: 4, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 3, race_number: 3, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 4, race_number: 4, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 101, race_number: 1, points: 8, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 102, race_number: 2, points: 1, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 103, race_number: 3, points: 1, heat_type: 'Final', heat_name: 'Final Gold' },
        { race_id: 104, race_number: 4, points: 2, heat_type: 'Final', heat_name: 'Final Gold' },
      ],
    };

    const handler = handlerRegistry.readOverallLeaderboard;
    const rows = await handler({}, 3);

    expect(rows.map((r: any) => r.boat_id)).toEqual(['C', 'B', 'A']);
    expect(rows.map((r: any) => r.overall_rank)).toEqual([1, 2, 3]);
  });

  it('uses deterministic fallback for unresolved 3-way tie', async () => {
    currentScenario.overallRows = [
      {
        boat_id: 'Z9',
        qualifying_points: 6,
        final_points: 6,
        overall_points: 12,
        placement_group: 'Gold',
        final_place: 1,
      },
      {
        boat_id: 'A1',
        qualifying_points: 6,
        final_points: 6,
        overall_points: 12,
        placement_group: 'Gold',
        final_place: 2,
      },
      {
        boat_id: 'M5',
        qualifying_points: 6,
        final_points: 6,
        overall_points: 12,
        placement_group: 'Gold',
        final_place: 3,
      },
    ];

    const identicalScores: ScoreRow[] = [
      { race_id: 1, race_number: 1, points: 4, heat_type: 'Qualifying', heat_name: 'Heat A1' },
      { race_id: 2, race_number: 2, points: 1, heat_type: 'Qualifying', heat_name: 'Heat A1' },
      { race_id: 3, race_number: 3, points: 1, heat_type: 'Qualifying', heat_name: 'Heat A1' },
      { race_id: 4, race_number: 4, points: 2, heat_type: 'Qualifying', heat_name: 'Heat A1' },
      { race_id: 101, race_number: 1, points: 4, heat_type: 'Final', heat_name: 'Final Gold' },
      { race_id: 102, race_number: 2, points: 1, heat_type: 'Final', heat_name: 'Final Gold' },
      { race_id: 103, race_number: 3, points: 1, heat_type: 'Final', heat_name: 'Final Gold' },
      { race_id: 104, race_number: 4, points: 2, heat_type: 'Final', heat_name: 'Final Gold' },
    ];

    currentScenario.tieScoresByBoatId = {
      Z9: identicalScores,
      A1: identicalScores,
      M5: identicalScores,
    };

    const handler = handlerRegistry.readOverallLeaderboard;
    const rows = await handler({}, 3);

    expect(rows.map((r: any) => r.boat_id)).toEqual(['A1', 'M5', 'Z9']);
  });

  it('uses latest shared race by race_number for A8.2, not by race_id', async () => {
    currentScenario.overallRows = [
      {
        boat_id: 'A',
        qualifying_points: 5,
        final_points: 5,
        overall_points: 10,
        placement_group: 'Gold',
        final_place: 1,
      },
      {
        boat_id: 'B',
        qualifying_points: 5,
        final_points: 5,
        overall_points: 10,
        placement_group: 'Gold',
        final_place: 2,
      },
    ];

    // Shared races have inverted race_id/race_number ordering intentionally.
    currentScenario.tieScoresByBoatId = {
      A: [
        { race_id: 200, race_number: 1, points: 1, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 100, race_number: 2, points: 3, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 300, race_number: 3, points: 6, heat_type: 'Final', heat_name: 'Final Gold' },
      ],
      B: [
        { race_id: 200, race_number: 1, points: 3, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 100, race_number: 2, points: 1, heat_type: 'Qualifying', heat_name: 'Heat A1' },
        { race_id: 301, race_number: 3, points: 6, heat_type: 'Final', heat_name: 'Final Gold' },
      ],
    };

    const handler = handlerRegistry.readOverallLeaderboard;
    const rows = await handler({}, 3);

    // In latest shared race (race_number=2), B has fewer points (1 vs 3), so B wins tie.
    expect(rows.map((r: any) => r.boat_id)).toEqual(['B', 'A']);
  });
});
