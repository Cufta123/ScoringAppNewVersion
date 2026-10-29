const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

/**
 * A stored date ("2026-06-01", the value of a date input) as people read it on
 * screen: dd.mm.yyyy, as the date inputs show it. The stored value is never
 * changed. Anything that is not an ISO date is shown as it is, and a missing
 * date as an empty string, so a bad row never shows "NaN.NaN.NaN".
 */
export const formatEventDate = (value: string | null | undefined): string => {
  if (!value) return '';
  const match = ISO_DAY.exec(value.trim());
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
};

/** "01.06.2026 → 03.06.2026" for the event list and the event page header. */
export const formatEventDateRange = (
  start: string | null | undefined,
  end: string | null | undefined,
): string => `${formatEventDate(start)} → ${formatEventDate(end)}`;

const two = (value: number): string => String(value).padStart(2, '0');

/**
 * A moment (an ISO timestamp such as a history entry's `at`) as people read it
 * on screen: "29.10.2026 10:55:48", dd.mm.yyyy and a 24-hour clock with
 * seconds, in the computer's time zone. Never the browser's own locale format
 * ("Thu, Oct 29, 10:55:48 AM"). Anything that is not a date is shown as it is,
 * and a missing value as an empty string.
 */
export const formatDateTime = (
  value: string | number | Date | null | undefined,
): string => {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return (
    `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
};
