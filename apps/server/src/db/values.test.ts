import { describe, expect, it } from 'vitest';
import {
  asBoolean,
  asNullableNumber,
  asNumber,
  asString,
  nullableText,
  parseJson,
  sqlValue,
} from './values.js';

describe('SQLite value helpers', () => {
  it('normalizes scalar database values consistently', () => {
    expect(asBoolean(1)).toBe(true);
    expect(asBoolean(0)).toBe(false);
    expect(asString(null)).toBe('');
    expect(asNumber(undefined)).toBe(0);
    expect(asNullableNumber(null)).toBeNull();
    expect(asNullableNumber('42')).toBe(42);
    expect(nullableText(undefined)).toBeNull();
    expect(nullableText(42)).toBe('42');
  });

  it('returns the fallback for malformed persisted JSON', () => {
    expect(parseJson('{"ok":true}', { ok: false })).toEqual({ ok: true });
    expect(parseJson('not-json', { ok: false })).toEqual({ ok: false });
  });

  it('preserves native SQLite values and stringifies unsupported ones', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(sqlValue(null)).toBeNull();
    expect(sqlValue(12)).toBe(12);
    expect(sqlValue(bytes)).toBe(bytes);
    expect(sqlValue({ value: 1 })).toBe('[object Object]');
  });
});
