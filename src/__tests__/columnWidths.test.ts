import {
  allocateWidths,
  columnNeed,
  textWidthMm,
} from '../renderer/exports/columnWidths';

describe('allocateWidths', () => {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

  it('meets every need and gives the spare room to the flexible columns', () => {
    const widths = allocateWidths(
      [
        { need: 10, min: 10, flex: false },
        { need: 40, min: 20, flex: true },
        { need: 30, min: 20, flex: true },
      ],
      180,
    );
    expect(sum(widths)).toBeCloseTo(180, 1);
    expect(widths[0]).toBe(10);
    expect(widths[1]).toBeGreaterThan(40);
    expect(widths[2]).toBeGreaterThan(30);
  });

  it('takes a shortage from the flexible columns first, never below their minimum', () => {
    const widths = allocateWidths(
      [
        { need: 20, min: 20, flex: false },
        { need: 100, min: 40, flex: true },
        { need: 80, min: 30, flex: true },
      ],
      150,
    );
    expect(sum(widths)).toBeCloseTo(150, 1);
    expect(widths[0]).toBe(20);
    expect(widths[1]).toBeGreaterThanOrEqual(40);
    expect(widths[2]).toBeGreaterThanOrEqual(30);
  });

  it('squeezes everything in proportion when even the minimums do not fit', () => {
    const widths = allocateWidths(
      [
        { need: 50, min: 50, flex: false },
        { need: 100, min: 60, flex: true },
      ],
      88,
    );
    expect(sum(widths)).toBeCloseTo(88, 1);
    expect(widths.every((width) => width > 0)).toBe(true);
  });

  it('shares spare room evenly when nothing is flexible', () => {
    const widths = allocateWidths(
      [
        { need: 10, min: 10, flex: false },
        { need: 10, min: 10, flex: false },
      ],
      40,
    );
    expect(widths).toEqual([20, 20]);
  });
});

describe('columnNeed', () => {
  it('is the widest of the header and the values; a long word is capped so it can still wrap', () => {
    const plain = columnNeed('Club', ['JK Galeb'], false, false);
    expect(plain.need).toBeCloseTo(textWidthMm('JK Galeb'), 5);
    expect(plain.min).toBe(plain.need);
    const flexible = columnNeed('Sailor', ['A'.repeat(60)], true, true);
    expect(flexible.need).toBeGreaterThan(100);
    expect(flexible.min).toBeLessThanOrEqual(45);
  });
});
