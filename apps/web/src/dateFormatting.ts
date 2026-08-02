const isoCalendarDatePattern = /^(\d{4,})-(\d{2})-(\d{2})$/;

export type CalendarDateStyle = 'short' | 'medium' | 'long' | 'full';

export function isIsoCalendarDate(value: string) {
  return isoCalendarDatePattern.test(value);
}

export function parseCalendarDate(value: string) {
  const match = isoCalendarDatePattern.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date;
}

export function formatCalendarDate(
  value: string,
  language: string,
  dateStyle: CalendarDateStyle = 'long',
) {
  const date = parseCalendarDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(language, { dateStyle, timeZone: 'UTC' }).format(date);
}

export function formatTimestamp(
  value: string,
  language: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, options).format(date);
}
