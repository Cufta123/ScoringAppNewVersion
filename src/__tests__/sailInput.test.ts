import {
  resolveTypedSails,
  tokenizeSailInput,
} from '../renderer/utils/sailInput';
import { entryKeysFor } from '../shared/boatKeys';

describe('tokenizeSailInput', () => {
  it('splits on spaces, commas and semicolons', () => {
    expect(tokenizeSailInput('101 205,88;7')).toEqual([
      '101',
      '205',
      '88',
      '7',
    ]);
  });

  it('joins national letters to the number after them', () => {
    expect(tokenizeSailInput('ITA 12 cro 7 5')).toEqual([
      'ITA 12',
      'cro 7',
      '5',
    ]);
  });

  it('gives nothing for blank input', () => {
    expect(tokenizeSailInput('  , ; ')).toEqual([]);
  });
});

describe('resolveTypedSails', () => {
  const heat = [
    { boat_id: 1, sail_number: 12, country: 'ITA' },
    { boat_id: 2, sail_number: 12, country: 'CRO' },
    { boat_id: 3, sail_number: 7, country: 'CRO' },
  ];
  const keys = entryKeysFor(heat);
  const boats = heat.map((boat) => ({
    ...boat,
    key: keys.get(String(boat.boat_id))!,
  }));

  it('resolves a unique number and a boat named with her letters', () => {
    const result = resolveTypedSails(tokenizeSailInput('7 ita 12'), boats);
    expect(result).toEqual({
      validKeys: ['7', 'ITA 12'],
      ambiguous: [],
      unknown: [],
    });
  });

  it('asks for the letters when two boats share the number', () => {
    const result = resolveTypedSails(['12'], boats);
    expect(result.validKeys).toEqual([]);
    expect(result.ambiguous).toEqual([
      { number: '12', options: ['ITA 12', 'CRO 12'] },
    ]);
    expect(result.unknown).toEqual([]);
  });

  it('reports numbers that are not in the heat, once each', () => {
    const result = resolveTypedSails(['99', '99', '7'], boats);
    expect(result.unknown).toEqual(['99']);
    expect(result.validKeys).toEqual(['7']);
  });

  it('lists a boat once when named twice', () => {
    const result = resolveTypedSails(['7', 'CRO 7'], boats);
    expect(result.validKeys).toEqual(['7']);
  });
});
