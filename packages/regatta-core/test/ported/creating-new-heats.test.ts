/**
 * Ported from the app's src/__tests__/creatingNewHeatsUtils.test.ts (the old
 * seeding in creatingNewHeatsUtls.ts, deleted with the old engine): SHRS 3
 * seeding order, the 3.1(1) first-round heats and the 3.1(2) Heat Movement
 * Table.
 */
import { type Decision } from '../../src';
import { enter, refusal, sheet, stateOf } from './helpers';

describe('SHRS 3 seeding order', () => {
  it('national letters are compared without regard to case ("cro" is CRO)', () => {
    // cro 2 and CRO 1 are the same nation, so sail number decides: CRO 1 first.
    const state = stateOf([
      enter('a', 'cro', '2'),
      enter('b', 'CRO', '1'),
      enter('c', 'GER', '1'),
      { type: 'heatsCreated', heatCount: 3 },
    ]);
    expect(state.rounds[0].map((heat) => heat.boats)).toEqual([
      ['b'],
      ['a'],
      ['c'],
    ]);
  });
});

describe('SHRS 3.1(1) and 2: the first round', () => {
  it('refuses 0 heats', () => {
    expect(
      refusal([enter('a'), enter('b'), { type: 'heatsCreated', heatCount: 0 }]),
    ).toMatch(/number of heats must be 1 to 26/);
  });

  it('2.2: 23 boats in 5 heats are within one boat of each other', () => {
    const state = stateOf([
      ...Array.from({ length: 23 }, (_v, i) => enter(`b${i + 1}`)),
      { type: 'heatsCreated', heatCount: 5 },
    ]);
    expect(state.rounds[0].map((heat) => heat.boats.length)).toEqual([
      5, 5, 5, 4, 4,
    ]);
  });
});

/**
 * SHRS Heat Movement Table 2 (alpha labels): for each place, the next heat
 * of a boat from heat A, B, … The table repeats every `heats` places (rows
 * 1-20 of the published table are these rows over and over).
 */
const TABLE: Record<number, string[]> = {
  2: ['AB', 'BA'],
  3: ['ABC', 'CAB', 'BCA'],
  4: ['ABCD', 'DABC', 'CDAB', 'BCDA'],
  5: ['ABCDE', 'EABCD', 'DEABC', 'CDEAB', 'BCDEA'],
};

describe('SHRS 3.1(2): the Heat Movement Table, places 1-20', () => {
  it.each([2, 3, 4, 5])('%i heats of 20 boats', (heats) => {
    const letters = 'ABCDE'.slice(0, heats).split('');
    const id = (heat: string, place: number) => `${heat}${place}`;
    const given = letters.map((heat) =>
      Array.from({ length: 20 }, (_v, i) => id(heat, i + 1)),
    );
    const log: Decision[] = [
      ...given.flat().map((boat, i) => enter(boat, 'CRO', String(i + 1))),
      { type: 'heatsCreated', heatCount: heats, heats: given },
      ...letters.map((heat, i) => sheet(`${heat}1`, 1, ...given[i])),
      { type: 'roundCreated' },
    ];
    const round2 = stateOf(log).rounds[1];
    const heatOf = (boat: string) =>
      round2.find((heat) => heat.boats.includes(boat))!.id[0];
    letters.forEach((heat, column) => {
      for (let place = 1; place <= 20; place += 1) {
        const expected = TABLE[heats][(place - 1) % heats][column];
        expect([heat, place, heatOf(id(heat, place))]).toEqual([
          heat,
          place,
          expected,
        ]);
      }
    });
  });
});
