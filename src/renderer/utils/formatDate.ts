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
