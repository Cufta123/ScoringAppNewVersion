/**
 * Ported from the app's src/__tests__/submittedRaceScore.test.ts (one boat's
 * points from the scoring screen). The ZFP / SCP / T1 numbers and the DNF
 * cap are in rules.test.ts ("RRS 44.3(c)"), unknown codes in checks.test.ts;
 * parsing of typed places and codes was app input handling and is not here.
 */
import { qualifyingStandings, type NoPlaceCode } from '../../src';
import { boats, protest, sheet, stateOf } from './helpers';

const CODES: NoPlaceCode[] = [
  'DNF',
  'DNS',
  'DSQ',
  'OCS',
  'BFD',
  'UFD',
  'RET',
  'DNC',
  'WTH',
];

describe('SHRS 5.2: every code without a place scores the largest heat + 1', () => {
  it.each(CODES)('%s in a heat of 10 scores 11', (code) => {
    const state = stateOf([
      ...boats(10),
      { type: 'heatsCreated', heatCount: 1 },
      sheet(
        'A1',
        1,
        ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'],
        `b10:${code}`,
      ),
    ]);
    const b10 = qualifyingStandings(state).standings.find(
      (s) => s.boat === 'b10',
    )!;
    expect(b10.scores[0]).toMatchObject({ code, points: 11 });
    expect(b10.scores[0].place).toBeUndefined();
  });

  it('SHRS 5.2: a heat of one boat, DNF scores 2', () => {
    const state = stateOf([
      ...boats(1),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'b1:DNF'),
    ]);
    expect(qualifyingStandings(state).standings[0].scores[0].points).toBe(2);
  });
});

describe('RRS A9 / R9: average redress with nothing to average', () => {
  it('RDG1 in her only race scores as a boat with no place (largest heat + 1)', () => {
    const state = stateOf([
      ...boats(4),
      { type: 'heatsCreated', heatCount: 1 },
      sheet('A1', 1, 'b1', 'b2', 'b3', 'b4'),
      protest('A1', 1, 'b3', { kind: 'RDG1' }),
    ]);
    const b3 = qualifyingStandings(state).standings.find(
      (s) => s.boat === 'b3',
    )!;
    expect(b3.scores[0]).toMatchObject({ code: 'RDG1', points: 5 });
  });
});
