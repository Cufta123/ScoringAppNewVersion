export {};

import fs from 'fs';
import path from 'path';

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

const insertedHeats: Array<{ eventId: number; name: string; type: string; newId: number }> = [];
const insertedHeatBoats: Array<{ heatId: number; boatId: number }> = [];
let qualifyingHeats: Array<{ heat_id: number; heat_name: string; heat_type: string }> = [];
let leaderboardRows: Array<{ boat_id: number; race_points: string; race_statuses: string }> = [];

const LEADERBOARD_COLUMNS = [
  'Rank',
  'Name',
  'Country',
  'Sail #',
  'Type',
  'Gross',
  'Overall',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q5',
  'Q6',
  'Q7',
] as const;

const REPORT_PATH = path.join(
  __dirname,
  'artifacts',
  'startFinalSeriesAtomic.77boats.result.txt',
);

function assertLeaderboardColumns(columns: string[]) {
  const missing = LEADERBOARD_COLUMNS.filter((required) => !columns.includes(required));
  if (missing.length > 0) {
    throw new Error(
      `Leaderboard table is missing required columns: ${missing.join(', ')}`,
    );
  }
}

function sqlContains(sql: string, fragment: string) {
  return sql.replace(/\s+/g, ' ').trim().includes(fragment);
}

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    if (sqlContains(sql, 'SELECT is_locked FROM Events WHERE event_id = ?')) {
      return { get: jest.fn(() => ({ is_locked: 0 })) };
    }

    if (
      sqlContains(sql, 'SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?')
    ) {
      return {
        all: jest.fn(() => qualifyingHeats),
      };
    }

    if (sqlContains(sql, 'SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?')) {
      return { get: jest.fn(() => ({ race_count: 1 })) };
    }

    if (
      sqlContains(sql, 'FROM Leaderboard lb') &&
      sqlContains(sql, 'GROUP_CONCAT(sc.points ORDER BY r.race_number) AS race_points')
    ) {
      return {
        all: jest.fn(() => leaderboardRows),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)')) {
      return {
        run: jest.fn((eventId: number, name: string, type: string) => {
          const newId = 901 + insertedHeats.length;
          insertedHeats.push({ eventId, name, type, newId });
          return { lastInsertRowid: newId, changes: 1 };
        }),
      };
    }

    if (sqlContains(sql, 'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)')) {
      return {
        run: jest.fn((heatId: number, boatId: number) => {
          insertedHeatBoats.push({ heatId, boatId });
          return { changes: 1 };
        }),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
  transaction: jest.fn((fn: () => any) => fn),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

describe('HeatRaceHandler startFinalSeriesAtomic', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  beforeEach(() => {
    insertedHeats.length = 0;
    insertedHeatBoats.length = 0;
    qualifyingHeats = [
      { heat_id: 11, heat_name: 'Heat A1', heat_type: 'Qualifying' },
      { heat_id: 12, heat_name: 'Heat B1', heat_type: 'Qualifying' },
    ];
    leaderboardRows = [
      { boat_id: 1, race_points: '2,3', race_statuses: 'FINISHED,FINISHED' },
      { boat_id: 2, race_points: '4,4', race_statuses: 'FINISHED,FINISHED' },
      { boat_id: 3, race_points: '1,4', race_statuses: 'FINISHED,FINISHED' },
      { boat_id: 4, race_points: '1,1', race_statuses: 'WTH,FINISHED' },
    ];
    dbMock.prepare.mockClear();
    dbMock.transaction.mockClear();
  });

  it('creates all final fleets and assignments inside one DB transaction', async () => {
    const handler = handlerRegistry.startFinalSeriesAtomic;
    const result = await handler({}, 77);

    expect(result).toEqual({ success: true, createdHeats: 2, assignedBoats: 4 });
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);

    expect(insertedHeats).toEqual([
      { eventId: 77, name: 'Final Gold', type: 'Final', newId: 901 },
      { eventId: 77, name: 'Final Silver', type: 'Final', newId: 902 },
    ]);

    // B4 is WTH and must be pushed to the last fleet.
    expect(insertedHeatBoats).toEqual([
      { heatId: 901, boatId: 1 },
      { heatId: 901, boatId: 3 },
      { heatId: 902, boatId: 2 },
      { heatId: 902, boatId: 4 },
    ]);
  });

  it('splits the provided 77-boat leaderboard exactly into Gold/Silver/Bronze/Copper by rank', async () => {
    qualifyingHeats = [
      { heat_id: 11, heat_name: 'Heat A1', heat_type: 'Qualifying' },
      { heat_id: 12, heat_name: 'Heat B1', heat_type: 'Qualifying' },
      { heat_id: 13, heat_name: 'Heat C1', heat_type: 'Qualifying' },
      { heat_id: 14, heat_name: 'Heat D1', heat_type: 'Qualifying' },
    ];

    const providedColumns = [
      'Rank',
      'Name',
      'Country',
      'Sail #',
      'Type',
      'Gross',
      'Overall',
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
      'Q6',
      'Q7',
    ];
    expect(() => assertLeaderboardColumns(providedColumns)).not.toThrow();

    const providedLeaderboardSnapshot = `
1 Robert Matulja CRO 33 Kantun 2R 12 7 1 2 1 1 (5) 1 1
2 Zvonko Jelacic CRO 35 VISS 13 9 3 1 1 2 1 (4) 1
3 Ante Kovacevic CRO 30 VISS 16 10 (6) 1 1 3 2 1 2
4 Springer Jan POL 100 Venti 20 12 2 1 1 2 4 (8) 2
5 Marko Matic CRO 04 VISS 19 14 3 2 (5) 1 1 4 3
6 Peter Feldman USA 41 VISS 21 15 1 3 2 4 3 2 (6)
7 Luningning Chen CHN 912 VISS 26 17 1 2 2 5 6 (9) 1
8 Tonko Puljiz CRO 40 VISS 21 17 (4) 3 4 1 4 4 1
9 Torsten Fildebrandt GER 87 Venti 27 18 6 1 3 1 4 (9) 3
10 Cavallo Elio ITA 13 GC24 27 19 3 4 (8) 3 2 2 5
11 Samson Jonas SWE 60 VISS 29 20 2 4 4 2 1 7 (9)
12 Odd Stray NOR 90 VISS 30 21 2 4 6 (9) 3 1 5
13 Matteo Longhi SUI 111 V11 39 24 5 3 (15) 4 5 3 4
14 Sven Forense CRO 142 VISS 35 26 (9) 7 3 4 4 6 2
15 Vedran Vesanovic CRO 144 Kantun 2 44 29 1 3 3 6 11 5 (15)
16 Robert Grubisa CRO 68 Alioth 45 31 13 (14) 5 2 5 3 3
17 Barindelli Fabio ITA 54 V11 45 33 2 4 2 7 8 10 (12)
18 Davor Duzevic CRO 28 Kantun 2 43 34 (9) 7 8 5 3 2 9
19 Zhao Su CHN 727 VISS 51 35 (16) 11 7 5 1 3 8
20 Cappa Paolo ITA 130 Venti 45 35 4 8 5 8 8 2 (10)
21 Tomislav Bezic CRO 150 Kantun 2 52 38 6 (14) 9 3 3 9 8
22 Matthias Patzer GER 188 V11 55 40 8 5 5 8 9 (15) 5
23 Zoltan Illes HUN 77 Venti 54 40 7 (14) 6 10 6 1 10
24 Fabianko Biocic CRO 10 Kantun 2 52 41 9 5 7 5 10 5 (11)
25 Paolo Patrini ITA 114 Kantun 2 58 42 5 5 8 (16) 6 11 7
26 Enwall Thomas SWE 50 Venti 62 45 7 (17) 9 6 7 7 9
27 Grant Larry USA 185 Kantun 2 68 47 RDG (13) 9 2 11 12 (NSC)
28 Franco Rizzo ITA 113 Venti 64 47 4 8 (17) 7 6 8 14
29 Tian Qin CHN 217 VISS 60 48 10 10 3 9 6 (12) 10
30 Kristina Jakelic CRO 15 Malteser 2 62 49 4 12 10 12 (13) 8 3
31 Hrvoje Duvancic CRO 171 Kantun 2 65 49 8 (16) 11 11 2 5 12
32 Chuck Millican BER 21 VISS 64 50 12 6 (14) 6 7 7 12
33 Jan Heiskanene SWE 9 Venti 72 51 5 12 11 10 7 6 (DNC)
34 Tibor Orszagh HUN 777 Kantun S 68 51 7 (17) 7 8 8 13 8
35 Marco Bagnara ITA 6 V12 66 53 10 7 11 7 (13) 9 9
36 Sergio Renato Naschold Richter BRA 961 Venti 70 54 13 13 12 8 (16) 4 4
37 Yang Jiangjun CHN 158 Venti 70 54 11 10 12 4 5 (16) 12
38 Max Lehman GER 25 Lintel MMX 73 55 3 6 13 17 11 (18) 5
39 Bartolomie j Jereczek POL 96 Alioth V4 72 55 (17) 6 15 13 11 3 7
40 Krisztian Foro HUN 74 Kantun S 77 56 11 6 4 (DNC) DNE 12 2
41 Marin Bizjak CRO 05 Kantun 2 77 56 12 8 (BFD) 7 7 8 14
42 Zhang Zhenkun CHN 3 Rockstar 75 57 7 2 13 11 (18) 17 7
43 Rohner Ernst SUI 20 Parabellum C10 77 59 14 (18) 14 6 15 6 4
44 Marko Vuksanovic CRO 174 V12 80 59 9 10 6 14 9 (DNF) 11
45 Dante Dalla Torre ITA 17 TBA 80 62 6 7 8 16 9 (18) 16
46 Piotr Klejszla POL 212 Venti 79 63 8 11 13 14 2 15 (16)
47 Hongyu Liu CHN 72 VISS 85 64 17 11 4 (DNF) 14 14 4
48 Olsson Per SWE 177 Kantun 2 79 64 12 9 11 9 (15) 10 13
49 Csaba Forrai HUN 31 Alioth 81 65 (16) 13 13 12 9 12 6
50 Scott Gazelle USA 8 VISS 83 65 10 12 12 15 (18) 10 6
51 Marino Koceic CRO 85 Kantun 2 87 72 (15) 8 14 15 8 14 13
52 Janos Schulek HUN 147 Kantun 2 90 72 (18) 10 17 12 11 11 11
53 Kacper Konkol POL 115 Haken 93 72 13 15 10 (DNF) 12 16 6
54 Miljenko Bezic CRO 59 Kantun 2 92 73 17 14 9 (19) 10 13 10
55 Gyula Ferencz ROU 152 Alternative 90 73 15 12 16 11 13 6 (17)
56 Ozren Marusic CRO 52 Kantun 2 92 74 (18) 15 10 16 12 14 7
57 Marco Signorelli SUI 121 BritPopo! 95 74 14 5 14 10 10 (DNC) DNC
58 Sandor Kunvari HUN 105 Kantun S 94 76 (18) 13 9 12 15 13 14
59 Haoyu HU CHN 51 VISS 98 77 10 9 6 10 DGM (DNC) DNC
60 Renato Buzzi SUI 22 V12 94 77 12 9 16 13 10 (17) 17
61 Lindberg Ulf SWE 112 Alioth 98 77 13 (DNC) 7 3 DNF 12 DNC
62 Robert Genader USA 36 VISS 95 78 15 15 16 13 (17) 11 8
63 Udo Ropke GER 11 BritPop! 97 78 11 13 (19) 18 14 5 17
64 Posmik Carsten GER 07 Shuffle 97 78 5 17 (19) 9 19 13 15
65 Claes Nordin SWE 99 V12 97 80 11 (17) 17 16 15 10 11
66 Graham Lewis GBR 24 Venti 101 83 13 (18) 12 13 17 15 13
67 Claus Lindstrom SWE 14 Kantun 2 106 85 8 16 15 17 13 16 (DNC)
68 Alexandre Ferreira Salgado BRA 42 VISS 108 87 14 16 18 15 17 7 (DNC)
69 Jakub Rempel POL 228 Alioth V4 102 87 14 (15) 15 14 14 15 15
70 Zampicinini Flavio ITA 162 Kantun S MX 109 90 17 11 16 (19) 17 14 15
71 Per Boymo NOR 269 VISS 110 91 16 16 10 17 16 (19) 16
72 Andrzej Becker POL 122 Alioth 113 94 18 (19) 17 17 18 11 13
73 Janette Nemcova SVK 196 Goth 118 99 (19) 19 19 14 16 17 14
74 Angelo Simonelli ITA 169 TNT 118 100 16 (18) 18 18 16 16 16
75 Eugeniusz Ginter POL 16 Vihueala 3 128 107 (DNC) DNC DNC 15 14 18 18
76 Jozsef Jankovic SVK 116 SMX 130 111 (19) 19 18 19 18 19 18
77 Andrej Hinic CRO 135 Kantun 2 134 113 (DNF) 20 18 18 RET 17 19
`;

    expect(providedLeaderboardSnapshot).toContain('1 Robert Matulja CRO 33 Kantun 2R 12 7');
    expect(providedLeaderboardSnapshot).toContain('77 Andrej Hinic CRO 135 Kantun 2 134 113');

    const overallByRank = [
      7, 9, 10, 12, 14, 15, 17, 17, 18, 19, 20, 21, 24, 26, 29, 31, 33, 34, 35,
      35, 38, 40, 40, 41, 42, 45, 47, 47, 48, 49, 49, 50, 51, 51, 53, 54, 54, 55,
      55, 56, 56, 57, 59, 59, 62, 63, 64, 64, 65, 65, 72, 72, 72, 73, 73, 74, 74,
      76, 77, 77, 77, 78, 78, 78, 80, 83, 85, 87, 87, 90, 91, 94, 99, 100, 107,
      111, 113,
    ];

    leaderboardRows = overallByRank.map((overall, idx) => ({
      boat_id: idx + 1,
      race_points: String(overall),
      race_statuses: 'FINISHED',
    }));

    const handler = handlerRegistry.startFinalSeriesAtomic;
    const result = await handler({}, 77);

    expect(result).toEqual({ success: true, createdHeats: 4, assignedBoats: 77 });
    expect(insertedHeats).toEqual([
      { eventId: 77, name: 'Final Gold', type: 'Final', newId: 901 },
      { eventId: 77, name: 'Final Silver', type: 'Final', newId: 902 },
      { eventId: 77, name: 'Final Bronze', type: 'Final', newId: 903 },
      { eventId: 77, name: 'Final Copper', type: 'Final', newId: 904 },
    ]);

    const expectedAssignments = [
      ...Array.from({ length: 20 }, (_, i) => ({ heatId: 901, boatId: i + 1 })),
      ...Array.from({ length: 19 }, (_, i) => ({ heatId: 902, boatId: i + 21 })),
      ...Array.from({ length: 19 }, (_, i) => ({ heatId: 903, boatId: i + 40 })),
      ...Array.from({ length: 19 }, (_, i) => ({ heatId: 904, boatId: i + 59 })),
    ];

    expect(insertedHeatBoats).toEqual(expectedAssignments);

    const fleetSizes = insertedHeats.map((heat) =>
      insertedHeatBoats.filter((assignment) => assignment.heatId === heat.newId).length,
    );

    // SHRS 4.1: fleets should be as equal as possible and not increase from Gold to Copper.
    expect(fleetSizes).toEqual([20, 19, 19, 19]);
    expect(fleetSizes[1]).toBeLessThanOrEqual(fleetSizes[0]);
    expect(fleetSizes[2]).toBeLessThanOrEqual(fleetSizes[1]);
    expect(fleetSizes[3]).toBeLessThanOrEqual(fleetSizes[2]);

    const boatsByFleet = insertedHeats.map((heat) => {
      const boats = insertedHeatBoats
        .filter((assignment) => assignment.heatId === heat.newId)
        .map((assignment) => assignment.boatId);
      return { name: heat.name, boats };
    });

    const reportLines = [
      'Simple Heat Racing System - Final Fleet Assignment Report',
      'Scenario: Provided 77-boat leaderboard (7 qualifying races)',
      'Result: PASS',
      '',
      'Checks:',
      '- Created final fleets: 4 (Gold, Silver, Bronze, Copper)',
      '- Assigned boats: 77',
      '- Fleet sizes (must be as equal as possible): Gold 20, Silver 19, Bronze 19, Copper 19',
      '- Monotonic size rule: Silver <= Gold, Bronze <= Silver, Copper <= Bronze',
      '- Rank split by boat_id (rank): Gold 1-20, Silver 21-39, Bronze 40-58, Copper 59-77',
      '',
      ...boatsByFleet.map((fleet) => `${fleet.name}: ${fleet.boats.join(', ')}`),
      '',
    ];

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf8');
  });

  it('rejects leaderboard input when required table column is missing', () => {
    const columnsMissingOverall = [
      'Rank',
      'Name',
      'Country',
      'Sail #',
      'Type',
      'Gross',
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
      'Q6',
      'Q7',
    ];

    expect(() => assertLeaderboardColumns(columnsMissingOverall)).toThrow(
      'Leaderboard table is missing required columns: Overall',
    );
  });
});
