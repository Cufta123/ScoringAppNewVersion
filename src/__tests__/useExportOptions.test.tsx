/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import useExportOptions, {
  exportOptionsKey,
  mergeStoredOptions,
} from '../renderer/hooks/useExportOptions';

const DEFAULTS = {
  language: 'en',
  columns: { country: true, club: false },
  fleets: null as string[] | null,
  count: 3,
};

describe('mergeStoredOptions', () => {
  it('lays remembered values over the defaults, group by group', () => {
    expect(
      mergeStoredOptions(DEFAULTS, {
        language: 'hr',
        columns: { club: true },
        fleets: ['Gold'],
      }),
    ).toEqual({
      language: 'hr',
      columns: { country: true, club: true },
      fleets: ['Gold'],
      count: 3,
    });
  });

  it('ignores values of the wrong kind and options it does not know', () => {
    expect(
      mergeStoredOptions(DEFAULTS, {
        language: 5,
        count: 'many',
        columns: 'all',
        unknown: true,
      }),
    ).toEqual(DEFAULTS);
  });

  it('falls back to the defaults for anything that is not an object', () => {
    expect(mergeStoredOptions(DEFAULTS, null)).toBe(DEFAULTS);
    expect(mergeStoredOptions(DEFAULTS, 'x')).toBe(DEFAULTS);
    expect(mergeStoredOptions(DEFAULTS, [1, 2])).toBe(DEFAULTS);
  });
});

describe('useExportOptions', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts from the defaults, remembers changes per event and document type', () => {
    const first = renderHook(() => useExportOptions(1, 'results', DEFAULTS));
    expect(first.result.current[0]).toEqual(DEFAULTS);
    act(() => first.result.current[1]((c) => ({ ...c, language: 'hr' })));
    const stored = window.localStorage.getItem(exportOptionsKey(1, 'results'));
    expect(JSON.parse(stored as string).language).toBe('hr');
    first.unmount();

    const language = (eventId: number, kind: string) =>
      renderHook(() => useExportOptions(eventId, kind, DEFAULTS)).result
        .current[0].language;
    expect(language(1, 'results')).toBe('hr');
    expect(language(2, 'results')).toBe('en');
    expect(language(1, 'heats')).toBe('en');
  });

  it('never requires storage', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const view = renderHook(() => useExportOptions(1, 'results', DEFAULTS));
    expect(view.result.current[0]).toEqual(DEFAULTS);
    act(() => view.result.current[1]({ ...DEFAULTS, count: 9 }));
    expect(view.result.current[0].count).toBe(9);
    jest.restoreAllMocks();
  });
});
