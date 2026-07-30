import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createProvider, type PrivateLlmSettings } from './providers.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function mockProviderServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

const completion = {
  system: 'System instruction',
  user: 'User instruction',
  maxTokens: 20,
  temperature: 0,
};

function settings(provider: PrivateLlmSettings['provider'], apiUrl: string): PrivateLlmSettings {
  return { provider, apiUrl, apiKey: 'test-key', model: 'test-model' };
}

describe('LLM provider contracts', () => {
  it('uses the OpenAI-compatible chat completions contract', async () => {
    let receivedPath = '';
    let authorization = '';
    const base = await mockProviderServer((request, response) => {
      receivedPath = request.url ?? '';
      authorization = request.headers.authorization ?? '';
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'openai-ok' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        }),
      );
    });

    const result = await createProvider(settings('openai', base), 1_000).complete(completion);
    expect(result).toEqual({
      text: 'openai-ok',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    expect(receivedPath).toBe('/v1/chat/completions');
    expect(authorization).toBe('Bearer test-key');
  });

  it('requests native JSON mode for structured OpenAI-compatible completions', async () => {
    let receivedBody: Record<string, unknown> = {};
    const base = await mockProviderServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
          string,
          unknown
        >;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      });
    });

    const result = await createProvider(settings('ollama', base), 1_000).complete({
      ...completion,
      responseFormat: 'json',
    });

    expect(result.text).toBe('{"ok":true}');
    expect(receivedBody.response_format).toEqual({ type: 'json_object' });
  });

  it('uses the native Anthropic messages contract', async () => {
    let receivedPath = '';
    let apiKey = '';
    const base = await mockProviderServer((request, response) => {
      receivedPath = request.url ?? '';
      apiKey = String(request.headers['x-api-key']);
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          content: [{ type: 'text', text: 'anthropic-ok' }],
          usage: { input_tokens: 9, output_tokens: 3 },
        }),
      );
    });

    const result = await createProvider(settings('anthropic', base), 1_000).complete(completion);
    expect(result).toEqual({
      text: 'anthropic-ok',
      usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
    });
    expect(receivedPath).toBe('/v1/messages');
    expect(apiKey).toBe('test-key');
  });

  it('uses the native Gemini generateContent contract', async () => {
    let receivedPath = '';
    const base = await mockProviderServer((request, response) => {
      receivedPath = request.url ?? '';
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'gemini-ok' }] } }],
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 5,
            totalTokenCount: 13,
          },
        }),
      );
    });

    const result = await createProvider(settings('google', base), 1_000).complete(completion);
    expect(result).toEqual({
      text: 'gemini-ok',
      usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
    });
    expect(receivedPath).toBe('/models/test-model:generateContent?key=test-key');
  });

  it('returns a controlled error for a malformed provider response', async () => {
    const base = await mockProviderServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [] }));
    });

    await expect(
      createProvider(settings('openai', base), 1_000).complete(completion),
    ).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE', status: 502 });
  });

  it('leaves usage absent when a provider does not report token counts', async () => {
    const base = await mockProviderServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: 'without-usage' } }] }));
    });

    await expect(
      createProvider(settings('openai', base), 1_000).complete(completion),
    ).resolves.toEqual({ text: 'without-usage' });
  });
});
