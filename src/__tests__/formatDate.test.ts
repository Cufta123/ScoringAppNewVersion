import {
  formatEventDate,
  formatEventDateRange,
} from '../renderer/utils/formatDate';

describe('formatEventDate: one human date format on screen', () => {
  it('shows a stored ISO day as dd.mm.yyyy', () => {
    expect(formatEventDate('2026-06-01')).toBe('01.06.2026');
    expect(formatEventDate('2026-12-31')).toBe('31.12.2026');
  });

  it('reads a day out of a full timestamp without shifting it by a time zone', () => {
    expect(formatEventDate('2026-06-01T23:30:00.000Z')).toBe('01.06.2026');
    expect(formatEventDate('2026-06-01 08:00:00')).toBe('01.06.2026');
  });

  it('shows nothing for a missing date, and anything unrecognised as it is', () => {
    expect(formatEventDate(undefined)).toBe('');
    expect(formatEventDate(null)).toBe('');
    expect(formatEventDate('')).toBe('');
    expect(formatEventDate('June 1st')).toBe('June 1st');
    expect(formatEventDate('2026-6-1')).toBe('2026-6-1');
  });

  it('builds the event range used in the list and the page header', () => {
    expect(formatEventDateRange('2026-06-01', '2026-06-03')).toBe(
      '01.06.2026 → 03.06.2026',
    );
  });
});
