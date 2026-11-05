/**
 * Ported from the app's src/__tests__/fleetAssignment.test.ts (the SHRS 4.3
 * split totals of src/shared/fleetAssignment.ts). The old tests fed points
 * straight in; here each is a qualifying series whose sheets give those
 * points, and the split order shows which scores 4.3 left out.
 *
 * The 4.3 window itself (6 or 7 races) is in rules.test.ts
 * ("4.3: only for 6 or 7 races; drops the second-worst too").
 */
import { qualifyingStandings, type EventState } from '../../src';
import { splitEvent, splitOrder } from './fleetSplitBuilder';

const totalOf = (state: EventState, boat: string) =>
  qualifyingStandings(state).standings.find((s) => s.boat === boat)!.total;
const qualifyingOrder = (state: EventState, boats: string[]) =>
  qualifyingStandings(state)
    .standings.map((s) => s.boat)
    .filter((b) => boats.includes(b));

// Two heats of 10 (DNF 11). X sails heat A, Y heat B.
const SEVEN = [10, 8, 1, 1, 1, 1, 1];

describe('SHRS 4.3 with the standard 5.4 discards', () => {
  const event = (rule43?: boolean) =>
    splitEvent({
      heats: 2,
      heatSize: 10,
      races: 7,
      rule43,
      featured: {
        X: { heat: 0, scores: SEVEN },
        Y: { heat: 1, scores: [2, 2, 2, 2, 2, 2, 2] },
      },
    });

  it('SHRS 4.3: at 7 races the worst (5.4) and the second-worst are out for the split', () => {
    const state = event();
    // Qualifying: X 23 - 10 = 13, Y 14 - 2 = 12, so Y is ahead.
    expect(totalOf(state, 'X')).toBe(13);
    expect(totalOf(state, 'Y')).toBe(12);
    expect(qualifyingOrder(state, ['X', 'Y'])).toEqual(['Y', 'X']);
    // Split: X 13 - 8 = 5, Y 12 - 2 = 10, so X is ahead.
    expect(splitOrder(state, ['X', 'Y'])).toEqual(['X', 'Y']);
  });

  it('SHRS 4.3 off (sailing instructions): only the 5.4 discard counts for the split', () => {
    // X 13 against Y 12.
    expect(splitOrder(event(false), ['X', 'Y'])).toEqual(['Y', 'X']);
  });
});

describe('SHRS 4.3 with discards set to none (5.4 changed by the race committee)', () => {
  it('SHRS 4.3: at 7 races only the second-worst is out; the worst stays', () => {
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 7,
      discards: { kind: 'none' },
      featured: {
        X: { heat: 0, scores: SEVEN },
        Z: { heat: 0, scores: [5, 3, 3, 2, 2, 2, 2] },
        Y: { heat: 1, scores: [4, 2, 2, 2, 2, 2, 2] },
      },
    });
    expect(totalOf(state, 'X')).toBe(23);
    // Split: Y 16 - 2 = 14, X 23 - 8 = 15, Z 19 - 3 = 16. Leaving out the
    // worst as well (one more discard) would give X 5 and put her first.
    expect(splitOrder(state, ['X', 'Y', 'Z'])).toEqual(['Y', 'X', 'Z']);
  });
});

describe('SHRS 4.3: the 5 / 6 / 7 / 8 race boundaries', () => {
  it('SHRS 4.3: not at 5 races, standard discards (only the worst is out)', () => {
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 5,
      featured: {
        X: { heat: 0, scores: [10, 8, 1, 1, 1] },
        Y: { heat: 1, scores: [2, 2, 2, 2, 2] },
      },
    });
    expect(totalOf(state, 'X')).toBe(11);
    // X 11 against Y 8; with 4.3 X would have 3 and Y 6.
    expect(splitOrder(state, ['X', 'Y'])).toEqual(['Y', 'X']);
  });

  it('SHRS 4.3: not at 5 races, no discards (nothing is out)', () => {
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 5,
      discards: { kind: 'none' },
      featured: {
        X: { heat: 0, scores: [10, 8, 1, 1, 1] },
        W: { heat: 1, scores: [4, 4, 4, 4, 4] },
      },
    });
    expect(totalOf(state, 'X')).toBe(21);
    // W 20 against X 21; with 4.3 X would have 13 and W 16.
    expect(splitOrder(state, ['X', 'W'])).toEqual(['W', 'X']);
  });

  it('SHRS 4.3: at 6 races the worst (5.4) and the second-worst are out', () => {
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 6,
      featured: {
        X: { heat: 0, scores: [10, 8, 1, 1, 1, 1] },
        Y: { heat: 1, scores: [2, 2, 2, 2, 2, 2] },
      },
    });
    // Qualifying X 22 - 10 = 12, Y 10; split X 4, Y 8.
    expect(totalOf(state, 'X')).toBe(12);
    expect(qualifyingOrder(state, ['X', 'Y'])).toEqual(['Y', 'X']);
    expect(splitOrder(state, ['X', 'Y'])).toEqual(['X', 'Y']);
  });

  it('SHRS 4.3: not at 8 races; 5.4 alone leaves out the two worst', () => {
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 8,
      featured: {
        X: { heat: 0, scores: [10, 9, 8, 1, 1, 1, 1, 1] },
        Y: { heat: 1, scores: [2, 2, 2, 2, 2, 2, 2, 2] },
      },
    });
    // X 13 against Y 12; with 4.3 X would have 5 and Y 10.
    expect(totalOf(state, 'X')).toBe(13);
    expect(splitOrder(state, ['X', 'Y'])).toEqual(['Y', 'X']);
  });
});

describe('SHRS 4.3 / 5.4 count the races completed in the series', () => {
  it('SHRS 4.3: a boat that missed race 1 (DNC, RRS A5.1) is split under the series count of 6', () => {
    // X enters after the heats are made and joins heat A from race 2: she
    // has DNC for race 1 (heat A then has 11 boats, so DNC = 12) and five
    // races sailed. Counting her own 5 races would leave 4.3 out.
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 6,
      featured: {
        X: { heat: 0, joinsRound: 2, scores: [null, 8, 1, 1, 1, 1] },
        Y: { heat: 1, scores: [2, 2, 2, 2, 2, 2] },
      },
    });
    const x = qualifyingStandings(state).standings.find((s) => s.boat === 'X')!;
    expect(x.scores[0]).toMatchObject({ code: 'DNC', points: 12 });
    // Qualifying: X 24 - 12 = 12, Y 10. Split: X 12 - 8 = 4, Y 8.
    expect(x.total).toBe(12);
    expect(splitOrder(state, ['X', 'Y'])).toEqual(['X', 'Y']);
  });

  it('RRS A5.1: a boat with no qualifying heat is split on DNCs, and the others keep the 7-race 4.3', () => {
    // The old test gave a boat with no scores 0 points (which would have put
    // her first); a boat entered but never in a heat is DNC in every race
    // (RRS A5.1), so she goes last.
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 7,
      featured: {
        N: { heat: null, scores: [] },
        X: { heat: 0, scores: SEVEN },
        Y: { heat: 1, scores: [2, 2, 2, 2, 2, 2, 2] },
      },
    });
    const n = qualifyingStandings(state).standings.find((s) => s.boat === 'N')!;
    expect(n.scores.map((s) => s.code)).toEqual(Array(7).fill('DNC'));
    const order = state.fleets!.flatMap((f) => f.boats);
    expect(order.at(-1)).toBe('N');
    expect(splitOrder(state, ['X', 'Y'])).toEqual(['X', 'Y']);
  });
});

describe('RRS 90.3(b): DNE and DGM are never excluded, for the split either', () => {
  it('SHRS 4.3 / 5.4: a DNE worst score stays; the next two worst go', () => {
    // Heats of 10: DNE = 11. X: DNE, 10, 8, 1, 1, 1.
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 6,
      featured: {
        X: { heat: 0, scores: ['DNE', 10, 8, 1, 1, 1] },
        Y: { heat: 1, scores: [4, 4, 4, 3, 3, 3] },
      },
    });
    // Qualifying: X 32 - 10 = 22. Split: X 22 - 8 = 14, Y 21 - 4 - 4 = 13.
    // Excluding the DNE would give X 11 and put her first.
    expect(totalOf(state, 'X')).toBe(22);
    expect(splitOrder(state, ['X', 'Y'])).toEqual(['Y', 'X']);
  });

  it('SHRS 4.3: with one excludable score, 5.4 takes it and 4.3 has nothing left', () => {
    const state = splitEvent({
      heats: 2,
      heatSize: 10,
      races: 6,
      featured: {
        X: { heat: 0, scores: ['DNE', 'DNE', 'DNE', 'DNE', 'DNE', 5] },
      },
    });
    expect(totalOf(state, 'X')).toBe(55);
    expect(state.fleets!.flatMap((f) => f.boats).at(-1)).toBe('X');
  });
});
