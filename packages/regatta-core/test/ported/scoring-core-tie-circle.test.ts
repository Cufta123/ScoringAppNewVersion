/**
 * Ported from the app's src/__tests__/scoringCore.tieCircle.test.ts. "The
 * place goes to the boat no tied boat beats" and "a true circle is settled
 * by the fallback" are covered in rules.test.ts (ranking); the event below
 * was not.
 */
import { qualifyingStandings, type Decision } from '../../src';
import { enter, sheet, stateOf } from './helpers';

// CRO 3, 4, 5, 8 and 13 on 10 points each, two heats and two rounds:
//   5:  B1 2, A2 8     13: A1 6, B2 4     3: B1 6, A2 4
//   4:  B1 4, A2 6      8: B1 5, B2 5
// 5 beats every boat; 13 and 3 cannot be split; both beat 4; 8 beats 3
// but loses to 13 and to 4 (3 > 4 > 8 > 3 is a circle). Fillers are ITA.
const tied = ['3', '4', '5', '8', '13'];
const fillers = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
const races: Decision[] = [
  {
    type: 'heatsCreated',
    heatCount: 2,
    heats: [
      ['f1', 'f2', 'f3', 'f4', 'f5', '13', 'f8'],
      ['f6', '5', 'f7', '4', '8', '3'],
    ],
  },
  sheet('A1', 1, 'f1', 'f2', 'f3', 'f4', 'f5', '13', 'f8'),
  sheet('B1', 1, 'f6', '5', 'f7', '4', '8', '3'),
  {
    type: 'roundCreated',
    heats: [
      ['f1', 'f2', 'f3', '3', 'f4', '4', 'f5', '5'],
      ['f8', 'f6', 'f7', '13', '8'],
    ],
  },
  sheet('A2', 1, 'f1', 'f2', 'f3', '3', 'f4', '4', 'f5', '5'),
  sheet('B2', 1, 'f8', 'f6', 'f7', '13', '8'),
];
const entries = [
  ...tied.map((id) => enter(id, 'CRO', id)),
  ...fillers.map((id) => enter(id, 'ITA', id.slice(1))),
];

describe('SHRS 5.7(ii) ties that are not transitive', () => {
  const orders = [
    entries,
    [...entries].reverse(),
    [
      entries[2],
      entries[4],
      entries[0],
      ...entries.slice(5),
      entries[3],
      entries[1],
    ],
  ];
  const tables = orders.map((order) => {
    const { standings } = qualifyingStandings(stateOf([...order, ...races]));
    return standings
      .filter((s) => tied.includes(s.boat))
      .map((s) => [s.boat, s.total, s.place]);
  });

  it('SHRS 5.7(ii)(3): the boat that beats every tied boat takes the higher place', () => {
    tables.forEach((table) => {
      expect(table.every(([, total]) => total === 10)).toBe(true);
      expect(table[0]).toEqual(['5', 10, expect.any(Number)]);
      const place = (id: string) => table.find(([b]) => b === id)![2];
      expect(
        table.every(([b]) => b === '5' || place(b as string) > place('5')),
      ).toBe(true);
    });
  });

  it('SHRS 5.7(ii): a boat is never ranked above one that beat her, in any entry order', () => {
    tables.forEach((table) => {
      const place = (id: string) => table.find(([b]) => b === id)![2] as number;
      // 13 beat 8 in B2.
      expect(place('13')).toBeLessThan(place('8'));
      expect(table).toEqual(tables[0]);
    });
  });
});
