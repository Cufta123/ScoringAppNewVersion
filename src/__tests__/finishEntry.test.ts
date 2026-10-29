import {
  addFinishers,
  emptyFinishEntry,
  findSubmittedStrangers,
  formatPlaceDisplay,
  hasFinishEntry,
  missingBoatsLine,
  moveFinisher,
  removeFinisher,
  scoringProgress,
  setBoatPenalty,
  stillMissingBoats,
  toggleTie,
} from '../renderer/utils/finishEntry';
import { buildPlaceNumbers, tieKey } from '../renderer/utils/finishOrder';

const HEAT = ['1', '2', '3', '4'];

const entryOf = (...boats: string[]) =>
  addFinishers(emptyFinishEntry(), HEAT, boats);

describe('addFinishers', () => {
  it('adds heat boats in order and ignores strangers and repeats', () => {
    const first = entryOf('3', '1');
    expect(first.boatNumbers).toEqual(['3', '1']);

    const next = addFinishers(first, HEAT, ['1', '9', '2']);
    expect(next.boatNumbers).toEqual(['3', '1', '2']);
  });

  it('matches typed numbers against numeric sail numbers', () => {
    const state = addFinishers(emptyFinishEntry(), [101, 102], ['101']);
    expect(state.boatNumbers).toEqual(['101']);
  });

  it('returns the same state when nothing is added', () => {
    const state = entryOf('1');
    expect(addFinishers(state, HEAT, ['1', '9'])).toBe(state);
  });

  it('keeps penalised boats after the finishers', () => {
    let state = setBoatPenalty(entryOf('1', '2'), '1', 'DNF');
    state = addFinishers(state, HEAT, ['3']);
    expect(state.boatNumbers).toEqual(['2', '3', '1']);
  });
});

describe('setBoatPenalty', () => {
  it('adds a boat that was not in the order, and clearing removes it again', () => {
    const withPenalty = setBoatPenalty(entryOf('1'), '4', 'DNS');
    expect(withPenalty.boatNumbers).toEqual(['1', '4']);
    expect(withPenalty.penalties).toEqual({ 4: 'DNS' });

    const cleared = setBoatPenalty(withPenalty, '4', '');
    expect(cleared.boatNumbers).toEqual(['1']);
    expect(cleared.penalties).toEqual({});
  });

  it('keeps a boat that was added as a finisher when its penalty is cleared', () => {
    const state = setBoatPenalty(
      setBoatPenalty(entryOf('1', '2'), '2', 'DNF'),
      '2',
      '',
    );
    expect(state.boatNumbers).toEqual(['1', '2']);
  });

  it('keeps a boat that was removed and then typed in again', () => {
    // The penalty alone added boat 4; removing it and adding it as a finisher
    // makes it an explicit entry, so clearing a later penalty keeps it.
    let state = setBoatPenalty(entryOf('1'), '4', 'DNS');
    state = removeFinisher(state, 1);
    state = addFinishers(state, HEAT, ['4']);
    state = setBoatPenalty(state, '4', 'DNF');
    state = setBoatPenalty(state, '4', '');
    expect(state.boatNumbers).toEqual(['1', '4']);
  });

  it('drops a tie once either boat takes a displacing penalty', () => {
    let state = entryOf('1', '2', '3');
    state = toggleTie(state, '2', 1);
    expect(state.ties.has(tieKey('2', '1'))).toBe(true);

    state = setBoatPenalty(state, '2', 'DSQ');
    expect(state.ties.size).toBe(0);
  });

  it('keeps the tie for a position-keeping penalty', () => {
    let state = entryOf('1', '2');
    state = toggleTie(state, '2', 1);
    state = setBoatPenalty(state, '2', 'ZFP');
    expect(state.ties.has(tieKey('2', '1'))).toBe(true);
  });
});

describe('removeFinisher', () => {
  it('removes the boat, its penalty and any tie that involved it', () => {
    let state = entryOf('1', '2', '3');
    state = toggleTie(state, '2', 1);
    state = removeFinisher(state, 0);
    expect(state.boatNumbers).toEqual(['2', '3']);
    expect(state.ties.size).toBe(0);
  });

  it('ignores an index outside the order', () => {
    const state = entryOf('1');
    expect(removeFinisher(state, 5)).toBe(state);
  });
});

describe('moveFinisher and toggleTie', () => {
  it('moves a boat and drops a tie the move separated', () => {
    let state = entryOf('1', '2', '3');
    state = toggleTie(state, '2', 1);
    state = moveFinisher(state, 1, 0);
    expect(state.boatNumbers).toEqual(['2', '1', '3']);
    expect(state.ties.size).toBe(0);
  });

  it('ignores an impossible move', () => {
    const state = entryOf('1', '2');
    expect(moveFinisher(state, 0, 0)).toBe(state);
    expect(moveFinisher(state, 0, -1)).toBe(state);
  });

  it('shares a place between tied boats and skips the next one', () => {
    let state = entryOf('1', '2', '3');
    state = toggleTie(state, '2', 1);
    expect(buildPlaceNumbers(state.boatNumbers, state.ties)).toEqual({
      1: 1,
      2: 1,
      3: 3,
    });
    // Toggling again unties.
    state = toggleTie(state, '2', 1);
    expect(state.ties.size).toBe(0);
  });

  it('cannot tie the first boat', () => {
    const state = entryOf('1', '2');
    expect(toggleTie(state, '1', 0)).toBe(state);
  });
});

describe('progress and validation', () => {
  it('counts boats with a place or a penalty', () => {
    const state = setBoatPenalty(entryOf('1'), '3', 'DNS');
    expect(scoringProgress(HEAT, state)).toEqual({
      scoredCount: 2,
      totalBoats: 4,
      allScored: false,
      isEmpty: false,
    });
  });

  it('is complete once every boat is scored, and empty without boats', () => {
    expect(scoringProgress(HEAT, entryOf(...HEAT)).allScored).toBe(true);
    expect(scoringProgress([], emptyFinishEntry())).toMatchObject({
      allScored: false,
      isEmpty: true,
    });
  });

  it('finds entered boats that are not in the heat', () => {
    const state = {
      ...entryOf('1'),
      penalties: { 9: 'DNF' },
    };
    expect(findSubmittedStrangers(HEAT, state)).toEqual(['9']);
  });

  it('reports unsubmitted work', () => {
    expect(hasFinishEntry(emptyFinishEntry())).toBe(false);
    expect(hasFinishEntry(entryOf('1'))).toBe(true);
    expect(hasFinishEntry(setBoatPenalty(emptyFinishEntry(), '1', 'DNS'))).toBe(
      true,
    );
  });
});

describe('formatPlaceDisplay', () => {
  it('shows the place, a dash when none', () => {
    expect(formatPlaceDisplay(3, undefined)).toBe('3');
    expect(formatPlaceDisplay(undefined, undefined)).toBe('—');
    expect(formatPlaceDisplay(3, undefined, { placeSuffix: '.' })).toBe('3.');
  });

  it('shows the code alone for a displacing penalty', () => {
    expect(formatPlaceDisplay(5, 'DNF')).toBe('DNF');
  });

  it('keeps the place beside a position-keeping penalty', () => {
    expect(formatPlaceDisplay(2, 'ZFP')).toBe('2 · ZFP');
    expect(formatPlaceDisplay(2, 'ZFP', { sep: ' ', placeSuffix: '.' })).toBe(
      '2. ZFP',
    );
  });
});

describe('stillMissingBoats: the marks a failed submit leaves', () => {
  it('keeps the marked boats that have neither a place nor a penalty', () => {
    expect(stillMissingBoats(['2', '3'], entryOf('1'))).toEqual(['2', '3']);
  });

  it('drops a boat once it has a place', () => {
    expect(stillMissingBoats(['2', '3'], entryOf('1', '3'))).toEqual(['2']);
  });

  it('drops a boat once it has a penalty', () => {
    const state = setBoatPenalty(entryOf('1'), '2', 'DNS');
    expect(stillMissingBoats(['2', '3'], state)).toEqual(['3']);
  });

  it('brings the mark back when the place is taken away again', () => {
    const scored = entryOf('1', '2');
    expect(stillMissingBoats(['2'], scored)).toEqual([]);
    expect(stillMissingBoats(['2'], removeFinisher(scored, 1))).toEqual(['2']);
  });

  it('matches numeric sail numbers against typed ones', () => {
    const state = addFinishers(emptyFinishEntry(), [101, 102], ['101']);
    expect(stillMissingBoats([101, 102], state)).toEqual([102]);
  });
});

describe('missingBoatsLine', () => {
  it('names every missing boat when there are few', () => {
    expect(missingBoatsLine(['102', '103'])).toBe(
      'Still missing: sail 102, sail 103.',
    );
  });

  it('cuts a long list short and says how many more', () => {
    const many = Array.from({ length: 10 }, (_, i) => String(100 + i));
    expect(missingBoatsLine(many)).toBe(
      'Still missing: sail 100, sail 101, sail 102, sail 103, sail 104, sail 105 and 4 more.',
    );
  });
});
