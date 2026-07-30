// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getClientId } from './api';

describe('API language propagation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('what-if-history-client-id', '10000000-0000-4000-8000-000000000001');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a valid client id when randomUUID is unavailable over LAN HTTP', () => {
    sessionStorage.clear();
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes.forEach((_value, index) => {
          bytes[index] = index;
        });
        return bytes;
      },
    });

    expect(getClientId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(sessionStorage.getItem('what-if-history-client-id')).toBe(
      '00010203-0405-4607-8809-0a0b0c0d0e0f',
    );
  });

  it('sends the active French interface language to generated-content routes', async () => {
    localStorage.setItem('what-if-history-language', 'fr');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ suggestions: 'Conseil' })));

    await api.brainstorm('00000000-0000-4000-8000-000000000000');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/games/00000000-0000-4000-8000-000000000000/actions/brainstorm',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-what-if-history-language': 'fr',
          'x-what-if-history-client-id': '10000000-0000-4000-8000-000000000001',
        }),
      }),
    );
  });

  it('switches the generation language to English with the interface', async () => {
    localStorage.setItem('what-if-history-language', 'en');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ response: 'Advice' })));

    await api.advisor('00000000-0000-4000-8000-000000000000', 'What next?');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/games/00000000-0000-4000-8000-000000000000/advisor',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-what-if-history-language': 'en' }),
      }),
    );
  });
});
