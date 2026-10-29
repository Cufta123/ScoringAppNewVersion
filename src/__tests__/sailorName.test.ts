import { sailorFullName } from '../renderer/utils/sailorName';

describe('sailorFullName', () => {
  it('joins name and surname', () => {
    expect(sailorFullName({ name: 'Ana', surname: 'Horvat' })).toBe(
      'Ana Horvat',
    );
  });

  it('leaves a missing part out instead of printing null', () => {
    expect(sailorFullName({ name: null, surname: 'Horvat' })).toBe('Horvat');
    expect(sailorFullName({ name: 'Ana', surname: undefined })).toBe('Ana');
  });

  it('gives an empty string for a boat without a sailor', () => {
    expect(sailorFullName({ name: null, surname: null })).toBe('');
    expect(sailorFullName(undefined)).toBe('');
  });

  it('trims stray spaces', () => {
    expect(sailorFullName({ name: ' Ana ', surname: ' ' })).toBe('Ana');
  });
});
