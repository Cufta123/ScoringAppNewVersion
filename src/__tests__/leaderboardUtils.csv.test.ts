import { escapeCsvCell } from '../renderer/utils/leaderboardUtils';

describe('escapeCsvCell — CSV formula/newline injection (LB-6)', () => {
  it('prefixes a single quote on formula-trigger leading characters', () => {
    expect(escapeCsvCell('=HYPERLINK(A1)')).toBe("'=HYPERLINK(A1)");
    expect(escapeCsvCell('=2+2')).toBe("'=2+2");
    expect(escapeCsvCell('+1-1')).toBe("'+1-1");
    expect(escapeCsvCell('-2')).toBe("'-2");
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
  });

  it('still quotes a formula-trigger value that also contains a comma', () => {
    // The quote prefix must not be lost when the cell is also wrapped in quotes.
    expect(escapeCsvCell('=1+1,2')).toBe('"\'=1+1,2"');
  });

  it('quotes cells containing a carriage return', () => {
    expect(escapeCsvCell('a\rb')).toBe('"a\rb"');
  });

  it('leaves ordinary values untouched', () => {
    expect(escapeCsvCell('Ana')).toBe('Ana');
    expect(escapeCsvCell('42')).toBe('42');
    expect(escapeCsvCell('a-b')).toBe('a-b');
  });

  it('still quotes commas, double quotes and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });

  it('neutralises tab and carriage-return formula triggers', () => {
    expect(escapeCsvCell('\t=HYPERLINK(A1)')).toBe(`'\t=HYPERLINK(A1)`);
    expect(escapeCsvCell('\r=2+2')).toBe(`"'\r=2+2"`);
  });
});
