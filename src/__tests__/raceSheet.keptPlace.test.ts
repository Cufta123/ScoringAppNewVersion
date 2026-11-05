/**
 * Older records stored a redressed boat's points but not the place she kept
 * (before migration 8). RRS A6.2: redress moves no other boat, so the place
 * the finishers leave free is hers. Found on a real database: the
 * conversion closed the gap and took a point off three boats.
 */
jest.mock('../main/database/DBManager', () => ({ db: {} }));

// eslint-disable-next-line import/first
import { sheetFromRows, type SheetRow } from '../main/functions/raceSheet';

const row = (
  boat: string,
  status: string,
  position: number,
  heldPlace: number | null = null,
): SheetRow => ({ boat, status, position, points: position, heldPlace });

// Heat B3, race 1 as stored: CZE won and got RDG1 (her average, 2.0, was
// stored as her place); the others kept 2, 3 and 4.
const heat = [
  row('cze', 'RDG1', 2),
  row('svk', 'FINISHED', 2),
  row('ita', 'FINISHED', 3),
  row('hun', 'FINISHED', 4),
];

describe('a redressed boat with no kept place recorded (older records)', () => {
  it('kept the place the finishers leave free; nobody moves up', () => {
    const sheet = sheetFromRows(heat, 5, 'Heat B3, race 1', (b) => b, true);
    expect(sheet.lines.map((line) => line.boat)).toEqual([
      'cze',
      'svk',
      'ita',
      'hun',
    ]);
    expect(sheet.lines.every((line) => !line.code && !line.tied)).toBe(true);
    expect(sheet.anomalies).toEqual([]);
    expect(sheet.notes.join(' ')).toMatch(/place 1 free, so she kept it/);
  });

  it('has no place when the finishers leave none free', () => {
    const sheet = sheetFromRows(
      [
        row('cze', 'RDG1', 3),
        row('svk', 'FINISHED', 1),
        row('ita', 'FINISHED', 2),
      ],
      4,
      'Heat B3, race 1',
      (b) => b,
      true,
    );
    expect(sheet.lines).toEqual([
      { boat: 'svk' },
      { boat: 'ita' },
      { boat: 'cze', code: 'DNF' },
    ]);
  });

  it('is not inferred for a Save: no kept place is the race officer’s choice', () => {
    const sheet = sheetFromRows(heat, 5, 'Heat B3, race 1');
    expect(sheet.lines.find((line) => line.boat === 'cze')).toEqual({
      boat: 'cze',
      code: 'DNF',
    });
  });
});
