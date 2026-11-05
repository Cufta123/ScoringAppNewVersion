/**
 * Ported from the app's src/__tests__/sharedPlaces.test.ts. "Only boats
 * level with the boat above share", "1, 2, 2, 4" and "never across
 * different totals" are covered in rules.test.ts (ranking) and
 * decided-rules.test.ts (R6); the non-transitive case was not, on a log.
 */
import { explainTie, qualifyingStandings, type Decision } from '../../src';
import { enter, sheet, stateOf } from './helpers';

// a, b and c on 5.5 points each, three rounds of two heats (DNC = 4):
//   R1  A1: a, =b, f1     B1: c, f2
//   R2  A2: a, =c, f1     B2: f2, b
//   R3  A3: f1, b, c      B3: f2, a, =f3
// a met b only in A1 and c only in A2, level each time, so no rule
// separates a from either. b and c met in A3, where b beat c.
const races: Decision[] = [
  {
    type: 'heatsCreated',
    heatCount: 2,
    heats: [
      ['a', 'b', 'f1'],
      ['c', 'f2'],
    ],
  },
  sheet('A1', 1, 'a', '=b', 'f1'),
  sheet('B1', 1, 'c', 'f2'),
  {
    type: 'roundCreated',
    heats: [
      ['a', 'c', 'f1'],
      ['f2', 'b'],
    ],
  },
  sheet('A2', 1, 'a', '=c', 'f1'),
  sheet('B2', 1, 'f2', 'b'),
  {
    type: 'roundCreated',
    heats: [
      ['f1', 'b', 'c'],
      ['f2', 'a', 'f3'],
    ],
  },
  sheet('A3', 1, 'f1', 'b', 'c'),
  sheet('B3', 1, 'f2', 'a', '=f3'),
];

const sails = [
  ['1', '2', '3'],
  ['2', '1', '3'],
  ['3', '2', '1'],
  ['1', '3', '2'],
  ['2', '3', '1'],
  ['3', '1', '2'],
];

describe('shared places when the tie-break is not transitive', () => {
  it.each(sails)(
    'SHRS 5.7(ii)(3): c shares no place with b, who beat her (sails a %s, b %s, c %s)',
    (sa, sb, sc) => {
      const state = stateOf([
        enter('a', 'CRO', sa),
        enter('b', 'CRO', sb),
        enter('c', 'CRO', sc),
        enter('f1', 'ITA', '1'),
        enter('f2', 'ITA', '2'),
        enter('f3', 'ITA', '3'),
        ...races,
      ]);
      const { standings } = qualifyingStandings(state);
      const of = (id: string) => standings.find((s) => s.boat === id)!;
      expect([of('a').total, of('b').total, of('c').total]).toEqual([
        5.5, 5.5, 5.5,
      ]);
      // c never shares b's place: b beat her in A3.
      expect(of('c').place).toBeGreaterThan(of('b').place);
      expect(explainTie(state, 'b', 'c').ahead).toBe('b');
      // SHRS 5.7(ii)(3), the higher place first: no tied boat beats a or
      // b, so they share it, whatever their sail numbers; c, beaten by b,
      // takes the next place.
      expect(of('a').place).toBe(of('b').place);
      expect(of('c').place).toBe(of('b').place + 2);
    },
  );
});
