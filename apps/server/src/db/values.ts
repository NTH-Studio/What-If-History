import type { SQLInputValue } from 'node:sqlite';

export type Row = Record<string, unknown>;

export const now = () => new Date().toISOString();
export const asBoolean = (value: unknown) => Number(value) === 1;
export const asString = (value: unknown) => String(value ?? '');
export const asNumber = (value: unknown) => Number(value ?? 0);
export const asNullableNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);
export const nullableText = (value: unknown) =>
  value === null || value === undefined ? null : asString(value);

export const text = asString;
export const number = asNumber;

export const sqlValue = (value: unknown): SQLInputValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return asString(value);
};

export function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(asString(value)) as T;
  } catch {
    return fallback;
  }
}
