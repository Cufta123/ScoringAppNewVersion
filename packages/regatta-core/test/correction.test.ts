/**
 * A result corrected in a race written as a column (applyRaceColumnEdit,
 * scoreRaceColumn): what one correction does to every boat of the race.
 * Ported from the app's leaderboard tests (the correction rule lived in the
 * app's src/shared/raceColumnEdit.ts until it moved here).
 */
import {
  applyRaceColumnEdit,
  holdsPlace,
  keepsProvidedPoints,
  scoreRaceColumn,
  slotOf,
  type RaceCell,
} from '../src';

/** A sheet line: a place, a code, or [place, penalty]. */
type Line = number | string | [number, string];

/** The race as entered, scored with the largest heat of the series. */
function race(lines: Line[], largestHeat = lines.length): RaceCell[] {
  return scoreRaceColumn(
    lines.map((line) => {
      if (typeof line === 'number') {
        return { position: line, points: line, status: 'FINISHED' };
      }
      if (typeof line === 'string') {
        return { position: 0, points: 0, status: line };
      }
      return { position: line[0], points: line[0], status: line[1] };
    }),
    largestHeat,
  );
}

/** Correct boat `boat` (1-based) to `position` with `status`. */
function correct(
  cells: RaceCell[],
  boat: number,
  position: number,
  status: string,
  largestHeat = cells.length,
): RaceCell[] {
  const i = boat - 1;
  return applyRaceColumnEdit(cells, {
    index: i,
    previousPosition: cells[i].position,
    previousStatus: cells[i].status,
    newPosition: position,
    newPoints: position,
    newStatus: status,
    maxBoats: largestHeat,
  });
}

/** Each boat's [place, points, status] (1-based). */
const shown = (cells: RaceCell[]) =>
  Object.fromEntries(
    cells.map((cell, i) => [i + 1, [cell.position, cell.points, cell.status]]),
  );

const finishers = (count: number): Line[] =>
  Array.from({ length: count }, (_, i) => i + 1);

describe('the cell vocabulary', () => {
  it('a finish and ZFP / SCP / T1 hold a place; codes do not', () => {
    expect(['FINISHED', 'ZFP', 'SCP', 'T1'].every(holdsPlace)).toBe(true);
    expect(['DNF', 'DSQ', 'RDG1', 'DPI'].some(holdsPlace)).toBe(false);
  });

  it('RDG1-3 and DPI keep the points the committee set', () => {
    expect(['RDG1', 'RDG2', 'RDG3', 'DPI'].every(keepsProvidedPoints)).toBe(
      true,
    );
    expect(['FINISHED', 'ZFP', 'DSQ'].some(keepsProvidedPoints)).toBe(false);
  });

  it('a redressed boat fills the place she kept; a code fills none', () => {
    expect(
      slotOf({ position: 4, points: 4, status: 'RDG3', heldPlace: 2 }),
    ).toBe(2);
    expect(slotOf({ position: 4, points: 4, status: 'RDG3' })).toBeNull();
    expect(slotOf({ position: 5, points: 5, status: 'DNF' })).toBeNull();
    expect(slotOf({ position: 3, points: 3.8, status: 'ZFP' })).toBe(3);
  });
});

describe('RRS A6.1: a boat leaving the order moves the boats behind up', () => {
  it('moves every boat behind a DSQ up one place', () => {
    const after = shown(correct(race(finishers(4)), 2, 2, 'DSQ'));
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
    expect(after[3]).toEqual([2, 2, 'FINISHED']);
    expect(after[4]).toEqual([3, 3, 'FINISHED']);
    // SHRS 5.2: largest heat + 1.
    expect(after[2]).toEqual([5, 5, 'DSQ']);
  });

  it.each([
    'DSQ',
    'RET',
    'DNE',
    'DGM',
    'DNF',
    'DNS',
    'OCS',
    'BFD',
    'UFD',
    'DNC',
    'NSC',
    'WTH',
  ])('%s promotes the boats behind', (status) => {
    const after = shown(correct(race(finishers(3), 10), 1, 1, status, 10));
    expect(after[2]).toEqual([1, 1, 'FINISHED']);
    expect(after[3]).toEqual([2, 2, 'FINISHED']);
    expect(after[1]).toEqual([11, 11, status]);
  });

  it('does not promote when the boat never finished', () => {
    const before = race([1, 'DNS', 2], 3);
    const after = shown(correct(before, 2, 0, 'DSQ', 3));
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
    expect(after[3]).toEqual([2, 2, 'FINISHED']);
    expect(after[2]).toEqual([4, 4, 'DSQ']);
  });

  it('carries a position-keeping penalty up with the finishers', () => {
    const after = shown(correct(race([1, 2, [3, 'ZFP']]), 1, 1, 'DSQ'));
    expect(after[2]).toEqual([1, 1, 'FINISHED']);
    // RRS 44.3(c): 2 + 20% of the DNF score (4) = 2.8.
    expect(after[3]).toEqual([2, 2.8, 'ZFP']);
  });
});

describe('RRS A6.2 / A10: redress and DPI move no one', () => {
  it('RDG1 leaves every other boat as it was and keeps her place', () => {
    const cells = correct(race(finishers(4)), 2, 3, 'RDG1');
    const after = shown(cells);
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
    expect(after[3]).toEqual([3, 3, 'FINISHED']);
    expect(after[4]).toEqual([4, 4, 'FINISHED']);
    // The average itself is the series' (A9(a)); the column keeps the
    // points it was given.
    expect(after[2]).toEqual([3, 3, 'RDG1']);
    expect(cells[1].heldPlace).toBe(2);
  });

  it('keeps the provided value for DPI without displacing', () => {
    const after = shown(correct(race(finishers(3)), 1, 1.5, 'DPI'));
    expect(after[1]).toEqual([1.5, 1.5, 'DPI']);
    expect(after[2]).toEqual([2, 2, 'FINISHED']);
    expect(after[3]).toEqual([3, 3, 'FINISHED']);
  });

  // Five boats, 3 and 4 level on 3rd: 1, 2, 3.5, 3.5, 5.
  const tiedRace = () => race([1, 2, 3, 3, 5]);

  it.each(['RDG3', 'DPI'])(
    '%s for one of two boats level: the other still shares the place',
    (status) => {
      const cells = correct(tiedRace(), 3, 2.5, status);
      const after = shown(cells);
      expect(after[3]).toEqual([2.5, 2.5, status]);
      expect(after[4]).toEqual([3, 3.5, 'FINISHED']);
      expect(after[5]).toEqual([5, 5, 'FINISHED']);
      expect(cells[2].heldPlace).toBe(3);
    },
  );

  it('a disqualification ahead moves her kept place up with the others', () => {
    const redressed = correct(tiedRace(), 3, 4, 'RDG3');
    const cells = correct(redressed, 1, 0, 'DSQ');
    const after = shown(cells);
    expect(after[2]).toEqual([1, 1, 'FINISHED']);
    expect(cells[2].heldPlace).toBe(2);
    expect(after[4]).toEqual([2, 2.5, 'FINISHED']);
    expect(after[5]).toEqual([4, 4, 'FINISHED']);
  });

  it('taking the redress away gives her a place back in the order', () => {
    const redressed = correct(tiedRace(), 3, 4, 'RDG3');
    const cells = correct(redressed, 3, 3, 'FINISHED');
    const after = shown(cells);
    expect(after[3]).toEqual([3, 3, 'FINISHED']);
    expect(after[4]).toEqual([4, 4, 'FINISHED']);
    expect(after[5]).toEqual([5, 5, 'FINISHED']);
    expect(cells[2].heldPlace).toBeUndefined();
  });

  it('a disqualification after redress leaves the order (A6.1)', () => {
    const redressed = correct(tiedRace(), 3, 4, 'RDG3');
    const cells = correct(redressed, 3, 0, 'DSQ');
    const after = shown(cells);
    expect(after[4]).toEqual([3, 3, 'FINISHED']);
    expect(after[5]).toEqual([4, 4, 'FINISHED']);
    expect(cells[2].heldPlace).toBeUndefined();
  });

  it('redress for a boat with no place keeps none', () => {
    const cells = correct(race([1, 2, 3, 3, 'DNF']), 5, 3, 'RDG3');
    expect(cells[4].heldPlace).toBeUndefined();
    expect(shown(cells)[4]).toEqual([3, 3.5, 'FINISHED']);
  });
});

describe('a new place moves the boat; the boats in between make room', () => {
  it('ripples the boats between old and new place', () => {
    const after = shown(correct(race(finishers(4)), 4, 2, 'FINISHED'));
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
    expect(after[4]).toEqual([2, 2, 'FINISHED']);
    expect(after[2]).toEqual([3, 3, 'FINISHED']);
    expect(after[3]).toEqual([4, 4, 'FINISHED']);
  });

  it('ripples downward moves too', () => {
    const after = shown(correct(race(finishers(4)), 1, 3, 'FINISHED'));
    expect(after[2]).toEqual([1, 1, 'FINISHED']);
    expect(after[3]).toEqual([2, 2, 'FINISHED']);
    expect(after[1]).toEqual([3, 3, 'FINISHED']);
    expect(after[4]).toEqual([4, 4, 'FINISHED']);
  });

  it('two moves swap two boats, with no duplicate place', () => {
    const once = correct(race(finishers(3)), 1, 2, 'FINISHED');
    expect(shown(once)).toEqual({
      1: [2, 2, 'FINISHED'],
      2: [1, 1, 'FINISHED'],
      3: [3, 3, 'FINISHED'],
    });
  });

  it('puts a boat that had no place into the order; the rest move down', () => {
    const after = shown(
      correct(race([1, 2, 3, 'DNF'], 10), 4, 2, 'FINISHED', 10),
    );
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
    expect(after[4]).toEqual([2, 2, 'FINISHED']);
    expect(after[2]).toEqual([3, 3, 'FINISHED']);
    expect(after[3]).toEqual([4, 4, 'FINISHED']);
  });

  it('a place past the last boat is the place after the last boat', () => {
    const after = shown(correct(race(finishers(3)), 1, 9, 'FINISHED'));
    expect(after[1]).toEqual([3, 3, 'FINISHED']);
    expect(after[2]).toEqual([1, 1, 'FINISHED']);
    expect(after[3]).toEqual([2, 2, 'FINISHED']);
  });

  it('giving a redressed boat a place back never puts a boat past the last', () => {
    const redressed = correct(race(finishers(3), 10), 2, 5, 'RDG3', 10);
    const after = shown(correct(redressed, 2, 3, 'FINISHED', 10));
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
    expect(after[3]).toEqual([2, 2, 'FINISHED']);
    expect(after[2]).toEqual([3, 3, 'FINISHED']);
  });

  it('keeps a dead heat when a tied boat only gets a ZFP', () => {
    const after = shown(correct(race([1, 1, 3], 10), 2, 1, 'ZFP', 10));
    expect(after[1]).toEqual([1, 1.5, 'FINISHED']);
    // RRS 44.3(c) 2025-2028: the penalty adds to the shared 1.5 (+ 2.2).
    expect(after[2]).toEqual([1, 3.7, 'ZFP']);
    expect(after[3]).toEqual([3, 3, 'FINISHED']);
  });

  it('typed into the middle of a dead heat, she goes in front of it', () => {
    const after = shown(correct(race([1, 2, 2, 2, 5]), 1, 3, 'FINISHED'));
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
    expect(after[2]).toEqual([2, 3, 'FINISHED']);
  });

  it('carries position-keeping penalties along the ripple (LB-7)', () => {
    const after = shown(correct(race([1, [2, 'ZFP'], 3]), 3, 2, 'FINISHED'));
    expect(after[3]).toEqual([2, 2, 'FINISHED']);
    // 3 + 20% of 4 = 3.8.
    expect(after[2]).toEqual([3, 3.8, 'ZFP']);
    expect(after[1]).toEqual([1, 1, 'FINISHED']);
  });

  it('a move into a slot a redressed boat left free goes up, not past the end', () => {
    // 1 finished, 2 redressed with no place kept, 3 and 4 behind: places
    // 1, 3, 4 in a race of four. Boat 1 moved to 3rd fills the gap above.
    const cells: RaceCell[] = scoreRaceColumn(
      [
        { position: 1, points: 1, status: 'FINISHED' },
        { position: 5, points: 5, status: 'RDG3' },
        { position: 3, points: 3, status: 'FINISHED' },
        { position: 4, points: 4, status: 'FINISHED' },
      ],
      4,
    );
    const after = shown(correct(cells, 1, 4, 'FINISHED'));
    const places = [after[1][0], after[3][0], after[4][0]];
    expect(new Set(places).size).toBe(3);
    expect(Math.max(...(places as number[]))).toBeLessThanOrEqual(4);
  });
});

describe('RRS A7: shared places split the points', () => {
  it('averages a tie created by a promotion', () => {
    const after = shown(correct(race([1, 2, 2, 4]), 1, 1, 'DSQ'));
    expect(after[2]).toEqual([1, 1.5, 'FINISHED']);
    expect(after[3]).toEqual([1, 1.5, 'FINISHED']);
    expect(after[4]).toEqual([3, 3, 'FINISHED']);
  });

  it('re-averages after a move onto an occupied place', () => {
    const after = shown(correct(race(finishers(3)), 3, 1, 'FINISHED'));
    expect(after[3]).toEqual([1, 1, 'FINISHED']);
    expect(after[1]).toEqual([2, 2, 'FINISHED']);
    expect(after[2]).toEqual([3, 3, 'FINISHED']);
  });

  it('scores a shared place as the average of the places it fills', () => {
    const after = shown(race([1, 2, 2, 4]));
    expect(after[2]).toEqual([2, 2.5, 'FINISHED']);
    expect(after[3]).toEqual([2, 2.5, 'FINISHED']);
  });
});

describe('SHRS 5.2 and RRS 44.3(c) / T1: points', () => {
  it('a code scores the largest heat + 1, not the boats in this race', () => {
    expect(shown(correct(race(finishers(3), 10), 3, 0, 'DNF', 10))[3]).toEqual([
      11,
      11,
      'DNF',
    ]);
  });

  it('the place sent with a code is not used', () => {
    expect(shown(correct(race(finishers(3)), 2, 99, 'DNS'))[2]).toEqual([
      4,
      4,
      'DNS',
    ]);
  });

  it('ZFP: place + 20% of the DNF score', () => {
    expect(shown(correct(race(finishers(3), 10), 3, 3, 'ZFP', 10))[3]).toEqual([
      3,
      5.2,
      'ZFP',
    ]);
  });

  it('SCP is capped at the DNF score', () => {
    expect(shown(correct(race(finishers(5)), 5, 5, 'SCP'))[5]).toEqual([
      5,
      6,
      'SCP',
    ]);
  });

  it('no minimum in a small heat', () => {
    expect(shown(correct(race(finishers(5)), 2, 2, 'ZFP'))[2]).toEqual([
      2,
      3.2,
      'ZFP',
    ]);
  });

  it('T1: place + 30% of the DNF score', () => {
    expect(shown(correct(race(finishers(5), 10), 4, 4, 'T1', 10))[4]).toEqual([
      4,
      7.3,
      'T1',
    ]);
  });

  it('RDG / DPI points are kept as given; a gap is not closed', () => {
    const cells = scoreRaceColumn(
      [
        { position: 1, points: 1, status: 'FINISHED' },
        { position: 4.5, points: 4.5, status: 'RDG3' },
        { position: 3, points: 3, status: 'FINISHED' },
      ],
      10,
    );
    expect(shown(cells)).toEqual({
      1: [1, 1, 'FINISHED'],
      2: [4.5, 4.5, 'RDG3'],
      3: [3, 3, 'FINISHED'],
    });
  });

  it('drops a kept place from a cell that is not RDG / DPI', () => {
    const [cell] = scoreRaceColumn(
      [{ position: 2, points: 2, status: 'FINISHED', heldPlace: 2 }],
      3,
    );
    expect(cell).toEqual({ position: 2, points: 2, status: 'FINISHED' });
  });
});

describe('every correction leaves a race the rules can hold', () => {
  // Random corrections on random races: every place inside the race, no
  // two boats on one place unless they share it from a tie on the sheet,
  // and the points of each place-holder its A7 share.
  const STATUSES = ['FINISHED', 'FINISHED', 'DNF', 'DSQ', 'ZFP', 'RDG3', 'DPI'];
  it('holds over 2,000 random corrections', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 200; n += 1) {
      const boats = 2 + Math.floor(rand() * 9);
      let cells = race(finishers(boats), 12);
      for (let k = 0; k < 10; k += 1) {
        const boat = 1 + Math.floor(rand() * boats);
        const status = STATUSES[Math.floor(rand() * STATUSES.length)];
        const position = 1 + Math.floor(rand() * boats);
        cells = correct(cells, boat, position, status, 12);
        const slots = cells
          .map((cell) => slotOf(cell))
          .filter((slot): slot is number => slot != null);
        slots.forEach((slot) => {
          expect(slot).toBeGreaterThanOrEqual(1);
          expect(slot).toBeLessThanOrEqual(boats);
        });
        // A finisher scores her A7 share; ZFP / SCP / T1 more than it.
        const wrong = cells.filter((cell) => {
          if (!holdsPlace(cell.status)) return false;
          const n2 = slots.filter((slot) => slot === cell.position).length;
          const share = cell.position + (n2 - 1) / 2;
          return cell.status === 'FINISHED'
            ? cell.points !== share
            : cell.points <= share;
        });
        expect(wrong).toEqual([]);
      }
    }
  });
});
