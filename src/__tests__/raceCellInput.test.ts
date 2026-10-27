import { checkRaceCellInput } from '../renderer/utils/raceCellInput';

describe('checkRaceCellInput: a finishing place', () => {
  it.each([
    ['1', 1],
    ['10', 10],
    [' 7 ', 7],
  ])('accepts %p in a 10-boat race', (text, value) => {
    expect(checkRaceCellInput(text, 'place', 10)).toEqual({ ok: true, value });
  });

  it.each(['', '0', '11', '1000', '-1', '2.5', '3,0', '1e1', 'x'])(
    'refuses %p in a 10-boat race, with the range',
    (text) => {
      const check = checkRaceCellInput(text, 'place', 10);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.short).toBe('1–10');
        expect(check.message).toMatch(/1–10/);
      }
    },
  );
});

describe('checkRaceCellInput: protest-committee points', () => {
  it.each([
    ['4', 4],
    ['4.5', 4.5],
    ['4,5', 4.5],
    ['0.5', 0.5],
    ['99', 99],
  ])('accepts %p', (text, value) => {
    expect(checkRaceCellInput(text, 'points')).toEqual({ ok: true, value });
  });

  it.each(['', '0', '0.0', '100', '4.55', '-2', 'x'])('refuses %p', (text) => {
    expect(checkRaceCellInput(text, 'points').ok).toBe(false);
  });
});
