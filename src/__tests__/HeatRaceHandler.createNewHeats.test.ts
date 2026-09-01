export {};

type PrepareStatement = {
  get?: (...args: any[]) => any;
  all?: (...args: any[]) => any[];
  run?: (...args: any[]) => any;
};

type Scenario = {
  assignmentMode: 'progressive' | 'pre-assigned';
  eventId: number;
  heatType: string;
  maxBoats: number;
  currentPosition: number;
  currentStatus: string;
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
        'SELECT shrs_discard_profile_qualifying as discard_profile FROM Events WHERE event_id = ?',
      )
    ) {
      return {
        get: jest.fn(() => ({
          discard_profile: JSON.stringify({
            firstDiscardAt: 4,
            secondDiscardAt: 8,
            additionalEvery: 8,
          }),
        })),
      };
    }

    if (
      sqlContains(sql, 'SELECT h.heat_id, h.heat_type FROM Heats h') &&
      sqlContains(sql, 'JOIN Races r ON r.heat_id = h.heat_id')
    ) {
      return {
        get: jest.fn((race_id: number) => {
          const raceByHeat = Object.entries(
            currentScenario.latestRaceByHeatId,
          ).find(([, race]) => race.race_id === race_id);
          if (!raceByHeat) {
            return undefined;
          }
          return {
            heat_id: Number(raceByHeat[0]),
            heat_type: currentScenario.heatType,
          };
        }),
      };
    }

    if (
      sqlContains(sql, 'SELECT h.event_id, h.heat_type') &&
      sqlContains(sql, 'FROM Races r')
    ) {
      return {
        get: jest.fn(() => ({
          event_id: currentScenario.eventId,
          heat_type: currentScenario.heatType,
        })),
      };
    }

    if (sqlContains(sql, 'SELECT MAX(boat_count) AS max_boats')) {
      return {
        get: jest.fn(() => ({ max_boats: currentScenario.maxBoats })),
      };
    }

    if (sqlContains(sql, 'SELECT position, COALESCE(status')) {
      return {
        get: jest.fn((_race_id: number, boat_id: string) => ({
          position: currentScenario.currentPosition,
          status: currentScenario.currentStatus,
          boat_id,
        })),
      };
    }

    if (
      sqlContains(sql, 'SELECT score_id, position') &&
      sqlContains(sql, "race_id = ? AND (status = 'FINISHED'")
    ) {
      return {
        all: jest.fn(() => []),
      };
    }

    if (
      sqlContains(
        sql,
        'UPDATE Events SET shrs_discard_locked_qualifying = 1 WHERE event_id = ?',
      )
    ) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (
      sqlContains(
        sql,
        'UPDATE Events SET shrs_discard_locked_final = 1 WHERE event_id = ?',
      )
    ) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (sqlContains(sql, 'DELETE FROM Leaderboard WHERE event_id = ?')) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (sqlContains(sql, 'SELECT boat_id, SUM(points) as total_points_event')) {
      return {
        all: jest.fn(() => []),
      };
    }

    if (
      sqlContains(
        sql,
        'INSERT INTO Leaderboard (boat_id, total_points_event, event_id, place)',
      )
    ) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    if (sql.toUpperCase().includes('UPDATE SCORES SET')) {
      return {
        run: jest.fn((...args: any[]) => {
          if (
            sqlContains(
              sql,
              'UPDATE Scores SET position = ?, points = ?, status = ? WHERE race_id = ? AND boat_id = ?',
            )
          ) {
            const [position, _points, status, race_id, boat_id] = args;
            const sourceHeat = Object.entries(
              currentScenario.latestRaceByHeatId,
            ).find(([, race]) => race.race_id === race_id);
            if (sourceHeat) {
              const heatId = Number(sourceHeat[0]);
              const rows = currentScenario.rankedRowsByHeatId[heatId] || [];
              const rowIndex = rows.findIndex((row) => row.boat_id === boat_id);
              if (rowIndex !== -1) {
                rows[rowIndex] = {
                  ...rows[rowIndex],
                  position,
                  status,
                };
                // Simulate post-race protest impact that would normally reshuffle ordering.
                currentScenario.rankedRowsByHeatId[heatId] = [...rows].sort(
                  (a, b) => {
                    const aPos =
                      a.position == null ? Number.MAX_SAFE_INTEGER : a.position;
                    const bPos =
                      b.position == null ? Number.MAX_SAFE_INTEGER : b.position;
                    return aPos - bPos;
                  },
                );
              }
            }
          }
          return { changes: 1 };
        }),
      };
    }

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

    if (sqlContains(sql, "COALESCE(s.status, 'FINISHED') AS status")) {
      return { all: jest.fn(() => []) };
    }

    // RRS A6.1 promotion also moves position-keeping penalty boats up. This
    // runs on every DSQ edit now, not just shift-on ones (RULE-M16); no such
    // boats exist in these fixtures.
    if (
      sqlContains(sql, 'SELECT score_id, position, status FROM Scores') &&
      sqlContains(sql, "status IN ('ZFP', 'SCP', 'T1')")
    ) {
      return { all: jest.fn(() => []) };
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
    eventId: 555,
    heatType: 'Qualifying',
    maxBoats: 20,
    currentPosition: 1,
    currentStatus: 'FINISHED',
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
      'Latest qualifying heats are not aligned on the same race number.',
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

  it('keeps next-heat assignment stable after protest result update', async () => {
    currentScenario.rankedRowsByHeatId[20] = [
      {
        boat_id: 'B1',
        position: 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 1,
      },
      {
        boat_id: 'B2',
        position: 2,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 2,
      },
      {
        boat_id: 'B3',
        position: 3,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 3,
      },
    ];

    const { updateRaceResult } = handlerRegistry;
    await updateRaceResult(
      {},
      555,
      currentScenario.latestRaceByHeatId[20].race_id,
      'B1',
      20,
      false,
      'DSQ',
    );

    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;

    const createNewHeats = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    await createNewHeats({}, 555);

    const bHeatAssignments = insertedHeatBoats.filter((entry) =>
      ['B1', 'B2', 'B3'].includes(entry.boat_id),
    );

    // Source B heat (index 1) in 3-heat movement (SHRS Table 1):
    // rank1->B, rank2->A, rank3->C.
    // Even after DSQ protest update, assignments stay based on the provisional order snapshot.
    expect(bHeatAssignments).toEqual([
      { heat_id: 201, boat_id: 'B1' },
      { heat_id: 200, boat_id: 'B2' },
      { heat_id: 202, boat_id: 'B3' },
    ]);
  });

  // RULE-M14 / SHRS 3.1.5: only PROTEST-COMMITTEE decisions are shielded from
  // changing heat assignments. A race-office scoring correction (here: fixing a
  // mistyped finishing place) must be allowed to change them — the assignment
  // is supposed to follow the corrected result. Previously ANY score edit
  // snapshotted the pre-edit order and froze the assignment for good.
  it('lets an ordinary race-office correction change the next-heat assignment', async () => {
    currentScenario.currentPosition = 1;
    currentScenario.currentStatus = 'FINISHED';
    currentScenario.rankedRowsByHeatId[20] = [
      {
        boat_id: 'B1',
        position: 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 1,
      },
      {
        boat_id: 'B2',
        position: 2,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 2,
      },
      {
        boat_id: 'B3',
        position: 3,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 3,
      },
    ];

    // The RO had B1 and B2 the wrong way round; correct B1 to 2nd.
    const { updateRaceResult } = handlerRegistry;
    await updateRaceResult(
      {},
      555,
      currentScenario.latestRaceByHeatId[20].race_id,
      'B1',
      2,
      false,
      'FINISHED',
    );

    // The stored race order now reflects the correction.
    currentScenario.rankedRowsByHeatId[20] = [
      {
        boat_id: 'B2',
        position: 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 2,
      },
      {
        boat_id: 'B1',
        position: 2,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 1,
      },
      {
        boat_id: 'B3',
        position: 3,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 3,
      },
    ];

    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;

    const createNewHeats = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    await createNewHeats({}, 555);

    const bHeatAssignments = insertedHeatBoats.filter((entry) =>
      ['B1', 'B2', 'B3'].includes(entry.boat_id),
    );

    // Movement table for source B in 3 heats: rank1->B, rank2->A, rank3->C.
    // The CORRECTED order drives it, so B2 (now 1st) goes to heat 201 and B1
    // to heat 200 — the reverse of the frozen-snapshot behaviour.
    expect(bHeatAssignments).toEqual([
      { heat_id: 201, boat_id: 'B2' },
      { heat_id: 200, boat_id: 'B1' },
      { heat_id: 202, boat_id: 'B3' },
    ]);
  });

  // RULE-M21 / SHRS 3.1.5: an ordinary correction to one boat must not drop the
  // protest shield on another boat in the same heat. Previously the correction
  // cleared the whole race snapshot, so B1 (protest-DSQ'd) lost its frozen 1st
  // place and was reassigned as a non-finisher.
  it('keeps a protest-DSQ boat shielded when another boat is later corrected', async () => {
    currentScenario.currentPosition = 1;
    currentScenario.currentStatus = 'FINISHED';
    currentScenario.rankedRowsByHeatId[20] = [
      {
        boat_id: 'B1',
        position: 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 1,
      },
      {
        boat_id: 'B2',
        position: 2,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 2,
      },
      {
        boat_id: 'B3',
        position: 3,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 3,
      },
    ];

    const { updateRaceResult } = handlerRegistry;

    // 1. Protest committee disqualifies B1 -> the pre-decision order is frozen.
    await updateRaceResult(
      {},
      555,
      currentScenario.latestRaceByHeatId[20].race_id,
      'B1',
      20,
      false,
      'DSQ',
    );

    // 2. Race office later corrects B2 (ordinary) -> B2 is un-shielded only.
    currentScenario.currentPosition = 2;
    currentScenario.currentStatus = 'FINISHED';
    await updateRaceResult(
      {},
      555,
      currentScenario.latestRaceByHeatId[20].race_id,
      'B2',
      2,
      false,
      'FINISHED',
    );

    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;

    const createNewHeats = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    await createNewHeats({}, 555);

    const bHeatAssignments = insertedHeatBoats.filter((entry) =>
      ['B1', 'B2', 'B3'].includes(entry.boat_id),
    );

    // Movement table for source B in 3 heats: rank1->B(201), rank2->A(200),
    // rank3->C(202). B1 stays shielded at 1st (heat 201) despite B2's later
    // correction; without the fix B1 fell to the non-finisher tail (heat 202).
    expect(bHeatAssignments).toEqual([
      { heat_id: 201, boat_id: 'B1' },
      { heat_id: 200, boat_id: 'B2' },
      { heat_id: 202, boat_id: 'B3' },
    ]);
  });

  // RULE-M21 / SHRS 3.1.5: merging frozen and live places can put two boats on
  // the SAME position — a boat DSQ'd from 1st keeps frozen position 1 while the
  // RRS A6.1 promotion moves the boat behind her to live position 1, and
  // un-shielding that boat makes both claim the slot. The shielded boat must
  // hold it; resolving the collision on sail number would let a protest
  // decision move her, which is exactly what 3.1.5 forbids.
  it('gives the shielded boat the slot when a frozen and a live place collide', async () => {
    currentScenario.currentPosition = 1;
    currentScenario.currentStatus = 'FINISHED';
    // B2 carries the LOWER sail number, so the identity tie-break would hand it
    // the 1st-place slot if the collision were left to compareSeededRows.
    currentScenario.rankedRowsByHeatId[20] = [
      {
        boat_id: 'B1',
        position: 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 2,
      },
      {
        boat_id: 'B2',
        position: 2,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 1,
      },
      {
        boat_id: 'B3',
        position: 3,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 3,
      },
    ];

    const { updateRaceResult } = handlerRegistry;
    const raceId = currentScenario.latestRaceByHeatId[20].race_id;

    // 1. Protest committee disqualifies B1 from 1st -> the heat is frozen.
    await updateRaceResult({}, 555, raceId, 'B1', 20, false, 'DSQ');

    // 2. RRS A6.1 promotion has moved B2 up to 1st in the live results.
    currentScenario.rankedRowsByHeatId[20] = [
      {
        boat_id: 'B2',
        position: 1,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 1,
      },
      {
        boat_id: 'B3',
        position: 2,
        status: 'FINISHED',
        country: 'CRO',
        sail_number: 3,
      },
      {
        boat_id: 'B1',
        position: 20,
        status: 'DSQ',
        country: 'CRO',
        sail_number: 2,
      },
    ];

    // 3. Race office corrects B2 (ordinary) -> B2 un-shielded, now live at 1st.
    currentScenario.currentPosition = 1;
    currentScenario.currentStatus = 'FINISHED';
    await updateRaceResult({}, 555, raceId, 'B2', 1, false, 'FINISHED');

    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;

    const createNewHeats = handlerRegistry.createNewHeatsBasedOnLeaderboard;
    await createNewHeats({}, 555);

    const bHeatAssignments = insertedHeatBoats.filter((entry) =>
      ['B1', 'B2', 'B3'].includes(entry.boat_id),
    );

    // Movement table for source B in 3 heats: rank1->B(201), rank2->A(200),
    // rank3->C(202). B1 holds its frozen 1st place; without the tie rule B2's
    // lower sail number would take heat 201 and push B1 down to 200.
    expect(bHeatAssignments).toEqual([
      { heat_id: 201, boat_id: 'B1' },
      { heat_id: 200, boat_id: 'B2' },
      { heat_id: 202, boat_id: 'B3' },
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
