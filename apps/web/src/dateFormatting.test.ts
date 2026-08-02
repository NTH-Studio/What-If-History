import { describe, expect, it } from 'vitest';
import {
  formatCalendarDate,
  formatTimestamp,
  isIsoCalendarDate,
  parseCalendarDate,
} from './dateFormatting';

describe('localized date formatting', () => {
  it('uses the active language instead of exposing ISO calendar dates', () => {
    expect(formatCalendarDate('1936-02-02', 'fr', 'long')).toBe('2 février 1936');
    expect(formatCalendarDate('1936-02-02', 'en', 'long')).toBe('February 2, 1936');
    expect(formatCalendarDate('1936-02-02', 'fr', 'long')).not.toBe(
      formatCalendarDate('1936-02-02', 'en', 'long'),
    );
  });

  it('parses years below 100 without moving them into the twentieth century', () => {
    const date = parseCalendarDate('0002-01-01');
    expect(date?.getUTCFullYear()).toBe(2);
    expect(formatCalendarDate('0002-01-01', 'fr', 'long')).toBe('1 janvier 2');
  });

  it('keeps invalid values readable and recognizes strict ISO calendar dates', () => {
    expect(isIsoCalendarDate('2026-08-02')).toBe(true);
    expect(isIsoCalendarDate('02/08/2026')).toBe(false);
    expect(formatCalendarDate('2026-02-31', 'fr')).toBe('2026-02-31');
    expect(formatTimestamp('not-a-date', 'fr')).toBe('not-a-date');
  });
});
