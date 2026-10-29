import {
  formatDateTime,
  formatDateTimeShort,
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

describe('formatDateTime: one date-and-time format on screen', () => {
  it('shows dd.mm.yyyy and a 24-hour clock with seconds, never the US format', () => {
    const morning = new Date(2026, 9, 29, 10, 55, 48);
    expect(formatDateTime(morning.toISOString())).toBe('29.10.2026 10:55:48');
    const afternoon = new Date(2026, 0, 5, 15, 4, 9);
    expect(formatDateTime(afternoon)).toBe('05.01.2026 15:04:09');
    const midnight = new Date(2026, 11, 31, 0, 0, 0);
    expect(formatDateTime(midnight.getTime())).toBe('31.12.2026 00:00:00');
  });

  it('shows nothing for a missing value, and anything unrecognised as it is', () => {
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('yesterday')).toBe('yesterday');
  });
});

describe('formatDateTimeShort: the "as of" moment without seconds', () => {
  it('shows dd.mm.yyyy HH:mm in 24 hours', () => {
    expect(formatDateTimeShort(new Date(2026, 9, 29, 9, 5, 48))).toBe(
      '29.10.2026 09:05',
    );
    expect(formatDateTimeShort(new Date(2026, 0, 2, 23, 59, 59))).toBe(
      '02.01.2026 23:59',
    );
  });

  it('leaves a missing or unreadable value as formatDateTime does', () => {
    expect(formatDateTimeShort(null)).toBe('');
    expect(formatDateTimeShort('not a date')).toBe('not a date');
  });
});
