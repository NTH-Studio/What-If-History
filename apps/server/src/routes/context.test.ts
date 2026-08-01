import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { isLoopback, requestLanguage } from './context.js';

function requestWith(headers: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe('API route context', () => {
  it('recognizes every supported loopback address form', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('127.12.3.4')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.0.10')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it('prefers the application language header over Accept-Language', () => {
    expect(
      requestLanguage(
        requestWith({
          'x-what-if-history-language': 'en-GB',
          'accept-language': 'fr-FR',
        }),
      ),
    ).toBe('en');
    expect(requestLanguage(requestWith({ 'accept-language': 'en-US,en;q=0.9' }))).toBe('en');
    expect(requestLanguage(requestWith({ 'accept-language': 'de-DE' }))).toBe('fr');
  });
});
