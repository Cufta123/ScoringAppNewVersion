export {};

import fs from 'fs';
import path from 'path';

type ParsedBoat = {
  originalRank: number;
  name: string;
  country: string;
  sail: string;
  boatType: string;
  gross: number;
  overall: number;
  qTokens: string[];
  qPoints: number[];
  qStatuses: string[];
};

type AdjustedBoat = ParsedBoat & {
  adjustedPoints: number;
  excludedIndexes: number[];
  adjustedRank: number;
  fleet: string;
};

const SOURCE_TABLE = `
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

const NON_EXCLUDABLE = new Set(['DNE', 'DGM']);
const STATUS_POINTS = 21;

function parseRaceToken(token: string): { points: number; status: string } {
  const normalized = token.replace(/[()]/g, '').toUpperCase();
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return { points: Number(normalized), status: 'FINISHED' };
  }
  return { points: STATUS_POINTS, status: normalized };
}

function parseRows(table: string): ParsedBoat[] {
  const rows = table
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\s+/.test(line));

  return rows.map((line) => {
    const tokens = line.split(/\s+/);
    const originalRank = Number(tokens[0]);
    const countryIndex = tokens.findIndex((token, idx) => idx > 0 && /^[A-Z]{3}$/.test(token));
    if (countryIndex < 2) {
      throw new Error(`Cannot parse row: ${line}`);
    }

    const country = tokens[countryIndex];
    const sail = tokens[countryIndex + 1];
    const tail = tokens.slice(-9);
    const [grossToken, overallToken, ...qTokens] = tail;
    const gross = Number(grossToken);
    const overall = Number(overallToken);

    const name = tokens.slice(1, countryIndex).join(' ');
    const boatType = tokens.slice(countryIndex + 2, tokens.length - 9).join(' ');
    const qParsed = qTokens.map(parseRaceToken);

    return {
      originalRank,
      name,
      country,
      sail,
      boatType,
      gross,
      overall,
      qTokens,
      qPoints: qParsed.map((x) => x.points),
      qStatuses: qParsed.map((x) => x.status),
    };
  });
}

function computeAdjusted(boats: ParsedBoat[]): AdjustedBoat[] {
  const adjusted = boats.map((boat) => {
    const excludeCount = boat.qPoints.length > 5 && boat.qPoints.length < 8 ? 2 : 1;
    const candidates = boat.qPoints
      .map((points, idx) => ({ points, idx, status: boat.qStatuses[idx] }))
      .filter((x) => !NON_EXCLUDABLE.has(x.status))
      .sort((a, b) => b.points - a.points || b.idx - a.idx);

    const excludedIndexes = candidates.slice(0, excludeCount).map((x) => x.idx);
    const excludedSet = new Set(excludedIndexes);
    const adjustedPoints = boat.qPoints.reduce((sum, points, idx) => {
      return excludedSet.has(idx) ? sum : sum + points;
    }, 0);

    return {
      ...boat,
      adjustedPoints,
      excludedIndexes,
      adjustedRank: 0,
      fleet: '',
    };
  });

  adjusted.sort((a, b) => a.adjustedPoints - b.adjustedPoints || a.originalRank - b.originalRank);

  adjusted.forEach((boat, idx) => {
    const adjustedRank = idx + 1;
    let fleet = 'Copper';
    if (adjustedRank <= 20) fleet = 'Gold';
    else if (adjustedRank <= 39) fleet = 'Silver';
    else if (adjustedRank <= 58) fleet = 'Bronze';

    boat.adjustedRank = adjustedRank;
    boat.fleet = fleet;
  });

  return adjusted;
}

function toDropInfo(boat: AdjustedBoat): string {
  return boat.excludedIndexes
    .sort((a, b) => a - b)
    .map((idx) => `Q${idx + 1}=${boat.qTokens[idx]}`)
    .join(', ');
}

describe('SHRS final fleet detailed report', () => {
  it('generates a detailed movement report for final fleet split', () => {
    const parsed = parseRows(SOURCE_TABLE);
    expect(parsed).toHaveLength(77);

    const adjusted = computeAdjusted(parsed);
    const byOriginalRank = [...adjusted].sort((a, b) => a.originalRank - b.originalRank);
    const marco = adjusted.find((b) => b.name === 'Marco Bagnara');

    expect(marco).toBeDefined();

    const reportLines: string[] = [];
    reportLines.push('SHRS Final Fleet Detailed Analysis (7 qualifying races)');
    reportLines.push('Rule used for fleet split: SHRS 4.2 temporary second worst score excluded (total 2 exclusions at 7 races).');
    reportLines.push('Penalty status points used in this reconstruction: 21.');
    reportLines.push('');

    if (marco) {
      const delta = marco.originalRank - marco.adjustedRank;
      const movement = delta > 0 ? `up ${delta}` : delta < 0 ? `down ${Math.abs(delta)}` : 'no change';
      reportLines.push(
        `Marco Bagnara: original #${marco.originalRank}, adjusted #${marco.adjustedRank}, fleet ${marco.fleet}, movement ${movement}.`,
      );
      reportLines.push(`Marco dropped scores for split: ${toDropInfo(marco)}.`);
      reportLines.push('');
    }

    reportLines.push('Per-boat movement (original rank -> adjusted rank):');
    byOriginalRank.forEach((boat) => {
      const delta = boat.originalRank - boat.adjustedRank;
      const movement = delta > 0 ? `+${delta}` : `${delta}`;
      reportLines.push(
        `${boat.originalRank}. ${boat.name} (${boat.country} ${boat.sail}) => ${boat.adjustedRank} [${boat.fleet}] | overall=${boat.overall} | splitPoints=${boat.adjustedPoints} | move=${movement} | dropped=${toDropInfo(boat)}`,
      );
    });

    reportLines.push('');
    reportLines.push('Fleet groups by adjusted rank:');
    ['Gold', 'Silver', 'Bronze', 'Copper'].forEach((fleet) => {
      const rows = adjusted.filter((b) => b.fleet === fleet);
      reportLines.push(`${fleet} (${rows.length}):`);
      rows.forEach((b) => {
        reportLines.push(`  #${b.adjustedRank} ${b.name} (${b.country} ${b.sail}) [orig ${b.originalRank}] pts=${b.adjustedPoints}`);
      });
    });

    const outPath = path.join(__dirname, 'artifacts', 'shrs.final-assignment.detailed.txt');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, reportLines.join('\n'), 'utf8');

    expect(fs.existsSync(outPath)).toBe(true);
  });
});
