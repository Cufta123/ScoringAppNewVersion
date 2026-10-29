export {};

type PrepareStatement = {
  get?: (...args: any[]) => any;
  all?: (...args: any[]) => any[];
  run?: (...args: any[]) => any;
};

type Scenario = {
  assignmentMode: 'progressive' | 'pre-assigned';
  latestHeats: { heat_name: string; heat_id: number }[];
  raceCountByHeatId: Record<number, number>;
  latestRaceByHeatId: Record<number, { race_id: number; race_number: number }>;
  boatsByHeatId?: Record<
    number,
    { boat_id: string; country: string; sail_number: number }[]
  >;
  rankedRowsByHeatId: Record<
    number,
    {
      boat_id: string;
      position: number | null;
      status: string | null;
      country: string | null;
      sail_number: string | number | null;
    }[]
  >;
};

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
  },
}));

let currentScenario: Scenario;
const insertedHeats: {
  event_id: number;
  heat_name: string;
  heat_type: string;
  new_heat_id: number;
}[] = [];
const insertedHeatBoats: { heat_id: number; boat_id: string }[] = [];
let raceIdOffset = 0;

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (
      sqlContains(
        sql,
        'SELECT shrs_qualifying_assignment_mode FROM Events WHERE event_id = ?',
      )
    ) {
      return {
        get: jest.fn(() => ({
          shrs_qualifying_assignment_mode: currentScenario.assignmentMode,
        })),
      };
    }

    if (
      sqlContains(
        sql,
        "SELECT heat_name, heat_id FROM Heats WHERE event_id = ? AND heat_type = 'Qualifying'",
      )
    ) {
      return {
        all: jest.fn(() => currentScenario.latestHeats),
      };
    }

    if (
      sqlContains(
        sql,
        'SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?',
      )
    ) {
      return {
        get: jest.fn((heat_id: number) => ({
          race_count: currentScenario.raceCountByHeatId[heat_id] ?? 0,
        })),
      };
    }

    if (
      sqlContains(sql, 'SELECT race_id, race_number') &&
      sqlContains(sql, 'FROM Races') &&
      sqlContains(sql, 'LIMIT 1')
    ) {
      return {
        get: jest.fn(
          (heat_id: number) => currentScenario.latestRaceByHeatId[heat_id],
        ),
      };
    }

    if (
      sqlContains(sql, 'SELECT hb.boat_id, b.country, b.sail_number') &&
      sqlContains(sql, 'FROM Heat_Boat hb') &&
      sqlContains(sql, 'JOIN Boats b ON b.boat_id = hb.boat_id')
    ) {
      return {
        all: jest.fn((heat_id: number) => {
          const rows = currentScenario.boatsByHeatId?.[heat_id] ?? [];
          return rows.map((row) => ({ ...row }));
        }),
      };
    }

    if (
      sqlContains(sql, 'FROM Heat_Boat hb') &&
      sqlContains(
        sql,
        'LEFT JOIN Scores sc ON sc.race_id = ? AND sc.boat_id = hb.boat_id',
      )
    ) {
      return {
        all: jest.fn((race_id: number, heat_id: number) => {
          const rows = currentScenario.rankedRowsByHeatId[heat_id] ?? [];
          return rows.map((row) => ({ ...row }));
        }),
      };
    }

    if (
      sqlContains(
        sql,
        'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
      )
    ) {
      return {
        run: jest.fn(
          (event_id: number, heat_name: string, heat_type: string) => {
            const new_heat_id = 200 + insertedHeats.length;
            insertedHeats.push({ event_id, heat_name, heat_type, new_heat_id });
            return { lastInsertRowid: new_heat_id, changes: 1 };
          },
        ),
      };
    }

    if (
      sqlContains(sql, 'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')
    ) {
      return {
        run: jest.fn((heat_id: number, boat_id: string) => {
          insertedHeatBoats.push({ heat_id, boat_id });
          return { changes: 1 };
        }),
      };
    }

    // hasFinalSeriesStarted: no Final heats in these scenarios.
    if (
      sqlContains(sql, 'SELECT COUNT(*) AS count FROM Heats') &&
      sqlContains(sql, "heat_type = 'Final'")
    ) {
      return { get: jest.fn(() => ({ count: 0 })) };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
  transaction: jest.fn(
    (cb: (...args: any[]) => any) =>
      (...args: any[]) =>
        cb(...args),
  ),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

function baseScenario(): Scenario {
  return {
    assignmentMode: 'progressive',
    latestHeats: [
      { heat_name: 'Heat A1', heat_id: 10 },
      { heat_name: 'Heat B1', heat_id: 20 },
      { heat_name: 'Heat C1', heat_id: 30 },
    ],
    raceCountByHeatId: {
      10: 2,
      20: 2,
      30: 2,
    },
    latestRaceByHeatId: {
      10: { race_id: 1010, race_number: 2 },
      20: { race_id: 1020, race_number: 2 },
      30: { race_id: 1030, race_number: 2 },
    },
    boatsByHeatId: {
      10: [
        { boat_id: 'A1', country: 'CRO', sail_number: 1 },
        { boat_id: 'A2', country: 'CRO', sail_number: 2 },
        { boat_id: 'A3', country: 'CRO', sail_number: 3 },
      ],
      20: [
        { boat_id: 'B1', country: 'AUS', sail_number: 1 },
        { boat_id: 'B2', country: 'AUS', sail_number: 2 },
        { boat_id: 'B3', country: 'AUS', sail_number: 3 },
      ],
      30: [
        { boat_id: 'C1', country: 'ESP', sail_number: 1 },
        { boat_id: 'C2', country: 'ESP', sail_number: 2 },
        { boat_id: 'C3', country: 'ESP', sail_number: 3 },
      ],
    },
    rankedRowsByHeatId: {
      10: [
        {
          boat_id: 'A1',
          position: 1,
          status: null,
          country: 'CRO',
          sail_number: 1,
        },
        {
          boat_id: 'A2',
          position: 2,
          status: null,
          country: 'CRO',
          sail_number: 2,
        },
        {
          boat_id: 'A3',
          position: 3,
          status: null,
          country: 'CRO',
          sail_number: 3,
        },
      ],
      20: [
        {
          boat_id: 'B1',
          position: null,
          status: 'DNF',
          country: 'CRO',
          sail_number: 8,
        },
        {
          boat_id: 'B2',
          position: null,
          status: 'DNF',
          country: 'AUS',
          sail_number: 7,
        },
        {
          boat_id: 'B3',
          position: null,
          status: 'DSQ',
          country: 'ARG',
          sail_number: 9,
        },
      ],
      30: [
        {
          boat_id: 'C1',
          position: 1,
          status: null,
          country: 'ESP',
          sail_number: 1,
        },
        {
          boat_id: 'C2',
          position: 2,
          status: null,
          country: 'ESP',
          sail_number: 2,
        },
        {
          boat_id: 'C3',
          position: 3,
          status: null,
          country: 'ESP',
          sail_number: 3,
        },
      ],
    },
  };
}

describe('HeatRaceHandler createNewHeatsBasedOnLeaderboard', () => {
  beforeAll(() => {
    // Register IPC handlers via module side effects.
    try {
      require('../main/ipcHandlers/HeatRaceHandler');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load HeatRaceHandler in test setup:', error);
      throw error;
    }
  });

  beforeEach(() => {
    currentScenario = baseScenario();
    raceIdOffset += 1000;
    currentScenario.latestRaceByHeatId = {
      10: { race_id: raceIdOffset + 10, race_number: 2 },
      20: { race_id: raceIdOffset + 20, race_number: 2 },
      30: { race_id: raceIdOffset + 30, race_number: 2 },
    };
    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;
    dbMock.prepare.mockClear();
  });

  it('creates next qualifying heats using movement-table reassignment from latest race ranks', async () => {
    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    expect(handler).toBeDefined();

    const result = await handler({}, 555);

    expect(result).toEqual({ success: true });
    expect(insertedHeats).toEqual([
      {
        event_id: 555,
        heat_name: 'Heat A2',
        heat_type: 'Qualifying',
        new_heat_id: 200,
      },
      {
        event_id: 555,
        heat_name: 'Heat B2',
        heat_type: 'Qualifying',
        new_heat_id: 201,
      },
      {
        event_id: 555,
        heat_name: 'Heat C2',
        heat_type: 'Qualifying',
        new_heat_id: 202,
      },
    ]);

    // SHRS Table 1, 3 heats (A=200, B=201, C=202): place 1 stays, place 2 moves
    // down one heat (wrapping), place 3 down two.
    expect(insertedHeatBoats).toEqual([
      { heat_id: 200, boat_id: 'A1' },
      { heat_id: 202, boat_id: 'A2' },
      { heat_id: 201, boat_id: 'A3' },
      { heat_id: 201, boat_id: 'B2' },
      { heat_id: 200, boat_id: 'B1' },
      { heat_id: 202, boat_id: 'B3' },
      { heat_id: 202, boat_id: 'C1' },
      { heat_id: 201, boat_id: 'C2' },
      { heat_id: 200, boat_id: 'C3' },
    ]);
  });

  it('keeps boats in the same heat when assignment mode is pre-assigned', async () => {
    currentScenario.assignmentMode = 'pre-assigned';

    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    const result = await handler({}, 555);

    expect(result).toEqual({ success: true });
    expect(insertedHeatBoats).toEqual([
      { heat_id: 200, boat_id: 'A1' },
      { heat_id: 200, boat_id: 'A2' },
      { heat_id: 200, boat_id: 'A3' },
      { heat_id: 201, boat_id: 'B1' },
      { heat_id: 201, boat_id: 'B2' },
      { heat_id: 201, boat_id: 'B3' },
      { heat_id: 202, boat_id: 'C1' },
      { heat_id: 202, boat_id: 'C2' },
      { heat_id: 202, boat_id: 'C3' },
    ]);
  });

  it('throws when latest qualifying heats are not aligned to the same race number', async () => {
    currentScenario.latestRaceByHeatId[30] = { race_id: 1030, race_number: 3 };

    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;

    await expect(handler({}, 555)).rejects.toThrow(
      'have not all sailed the same number of races',
    );
    expect(insertedHeats).toHaveLength(0);
    expect(insertedHeatBoats).toHaveLength(0);
  });

  // There used to be a zig-zag fallback here that re-seeded the whole fleet
  // from scratch whenever the movement table produced no assignments. That
  // threw away the finishing positions SHRS 3.1(2) requires the next round to
  // be based on, and quietly published a draw nobody had sailed for. An empty
  // assignment set is a data fault, so it has to surface as one.
  it('throws instead of re-seeding when no results exist to move boats from', async () => {
    currentScenario.rankedRowsByHeatId = { 10: [], 20: [], 30: [] };

    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;

    await expect(handler({}, 555)).rejects.toThrow(
      /Cannot build round 2: no boats could be assigned from Heat A1, Heat B1, Heat C1\..*no recorded results/s,
    );
    expect(insertedHeats).toHaveLength(0);
    expect(insertedHeatBoats).toHaveLength(0);
  });

  it('throws instead of re-seeding when pre-assigned heats hold no boats', async () => {
    currentScenario.assignmentMode = 'pre-assigned';
    currentScenario.boatsByHeatId = { 10: [], 20: [], 30: [] };

    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;

    await expect(handler({}, 555)).rejects.toThrow(
      /Cannot build round 2: no boats could be assigned from Heat A1, Heat B1, Heat C1\..*no boats assigned/s,
    );
    expect(insertedHeats).toHaveLength(0);
    expect(insertedHeatBoats).toHaveLength(0);
  });

  it('orders non-finish penalties with DGM before DPI during seeding', async () => {
    currentScenario.rankedRowsByHeatId[20] = [
      {
        boat_id: 'B_DGM',
        position: null,
        status: 'DGM',
        country: 'CRO',
        sail_number: 1,
      },
      {
        boat_id: 'B_DPI',
        position: null,
        status: 'DPI',
        country: 'CRO',
        sail_number: 2,
      },
      {
        boat_id: 'B_DNS',
        position: null,
        status: 'DNS',
        country: 'CRO',
        sail_number: 3,
      },
    ];

    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    await handler({}, 555);

    const bHeatAssignments = insertedHeatBoats.filter((entry) =>
      ['B_DNS', 'B_DGM', 'B_DPI'].includes(entry.boat_id),
    );

    // For source B heat movement table in 3 fleets (SHRS Table 1):
    // rank1->B, rank2->A, rank3->C.
    expect(bHeatAssignments).toEqual([
      { heat_id: 201, boat_id: 'B_DNS' },
      { heat_id: 200, boat_id: 'B_DGM' },
      { heat_id: 202, boat_id: 'B_DPI' },
    ]);
  });

  it('returns odd/even advisory for 2-heat fleets with N mod 4 = 2', async () => {
    currentScenario.latestHeats = [
      { heat_name: 'Heat A1', heat_id: 10 },
      { heat_name: 'Heat B1', heat_id: 20 },
    ];
    currentScenario.raceCountByHeatId = { 10: 2, 20: 2 };
    currentScenario.latestRaceByHeatId = {
      10: { race_id: raceIdOffset + 10, race_number: 2 },
      20: { race_id: raceIdOffset + 20, race_number: 2 },
    };

    currentScenario.rankedRowsByHeatId[10] = Array.from(
      { length: 7 },
      (_v, i) => ({
        boat_id: `A${i + 1}`,
        position: i + 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: i + 1,
      }),
    );
    currentScenario.rankedRowsByHeatId[20] = Array.from(
      { length: 7 },
      (_v, i) => ({
        boat_id: `B${i + 1}`,
        position: i + 1,
        status: 'FINISHED',
        country: 'AUS',
        sail_number: i + 1,
      }),
    );

    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    const result = await handler({}, 555);

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        advisory: expect.stringContaining('temporary 2-boat imbalance'),
      }),
    );
  });

  // RULE-m1 / SHRS Heat Movement Tables end-note: the advisory applies to
  // "entries of 10, 14, 18, 22, 26, 30, 34 and 38". The 10-boat case was
  // silently skipped because the check started at 14.
  it('returns the odd/even advisory for the 10-boat case too', async () => {
    currentScenario.latestHeats = [
      { heat_name: 'Heat A1', heat_id: 10 },
      { heat_name: 'Heat B1', heat_id: 20 },
    ];
    currentScenario.raceCountByHeatId = { 10: 2, 20: 2 };
    currentScenario.latestRaceByHeatId = {
      10: { race_id: raceIdOffset + 10, race_number: 2 },
      20: { race_id: raceIdOffset + 20, race_number: 2 },
    };

    currentScenario.rankedRowsByHeatId[10] = Array.from(
      { length: 5 },
      (_v, i) => ({
        boat_id: `A${i + 1}`,
        position: i + 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: i + 1,
      }),
    );
    currentScenario.rankedRowsByHeatId[20] = Array.from(
      { length: 5 },
      (_v, i) => ({
        boat_id: `B${i + 1}`,
        position: i + 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 100 + i + 1,
      }),
    );

    const handler = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    const result = await handler({}, 555);

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        advisory: expect.stringContaining('10 boats in 2 heats'),
      }),
    );
  });
});
