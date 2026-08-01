import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProvider,
  structuredOutputModeFor,
  toPrivateSettings,
  type PrivateLlmSettings,
} from './providers.js';

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

describe('structured output diagnostics', () => {
  it.each([
    ['lm-studio', 'http://127.0.0.1:1234/v1', 'local', 'native_json_schema'],
    ['ollama', 'http://127.0.0.1:11434', 'qwen3', 'native_json_schema'],
    ['ollama', 'https://ollama.com/api', 'glm-5.2:cloud', 'server_validation'],
    ['openai', 'https://api.openai.com/v1', 'gpt-5', 'native_json_schema'],
    ['google', 'https://generativelanguage.googleapis.com/v1beta', 'gemini', 'native_json_schema'],
    ['anthropic', 'https://api.anthropic.com', 'claude', 'server_validation'],
    ['llama.cpp', 'http://127.0.0.1:8080', 'local', 'json_mode'],
    ['vllm', 'http://127.0.0.1:8000', 'local', 'json_mode'],
  ] as const)('%s reports %s', (provider, apiUrl, model, expected) => {
    expect(structuredOutputModeFor({ provider, apiUrl, model })).toBe(expected);
  });
});

function settings(provider: PrivateLlmSettings['provider'], apiUrl: string): PrivateLlmSettings {
  return { provider, apiUrl, apiKey: 'test-key', model: 'test-model' };
}

describe('LLM provider contracts', () => {
  it('keeps the stored API key when the settings form submits an empty password', () => {
    expect(
      toPrivateSettings(
        {
          provider: 'ollama',
          apiUrl: 'https://ollama.com/api',
          apiKey: '   ',
          model: 'glm-5.2:cloud',
          clearApiKey: false,
        },
        'stored-key',
      ).apiKey,
    ).toBe('stored-key');
  });

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

    const result = await createProvider(settings('llama.cpp', base), 1_000).complete({
      ...completion,
      responseFormat: 'json',
    });

    expect(result.text).toBe('{"ok":true}');
    expect(receivedBody.response_format).toEqual({ type: 'json_object' });
  });

  it('uses the native Ollama chat contract and reports its usage', async () => {
    let receivedPath = '';
    let authorization = '';
    let receivedBody: Record<string, unknown> = {};
    const base = await mockProviderServer((request, response) => {
      receivedPath = request.url ?? '';
      authorization = request.headers.authorization ?? '';
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
          string,
          unknown
        >;
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            message: { role: 'assistant', content: 'ollama-ok' },
            prompt_eval_count: 7,
            eval_count: 3,
            done: true,
          }),
        );
      });
    });

    const result = await createProvider(settings('ollama', `${base}/api`), 1_000).complete(
      completion,
    );

    expect(result).toEqual({
      text: 'ollama-ok',
      usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
    });
    expect(receivedPath).toBe('/api/chat');
    expect(authorization).toBe('Bearer test-key');
    expect(receivedBody).toMatchObject({
      model: 'test-model',
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 20 },
    });
  });

  it('passes a JSON schema through Ollama format for local models', async () => {
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
        response.end(JSON.stringify({ message: { content: '{"ok":true}' }, done: true }));
      });
    });
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };

    await createProvider(settings('ollama', base), 1_000).complete({
      ...completion,
      responseFormat: 'json',
      responseSchema: { name: 'local_schema', schema },
    });

    expect(receivedBody.format).toEqual(schema);
  });

  it('does not request unsupported structured output from Ollama Cloud models', async () => {
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
        response.end(JSON.stringify({ message: { content: '{"ok":true}' }, done: true }));
      });
    });
    const cloudSettings = settings('ollama', base);
    cloudSettings.model = 'test-model:cloud';

    await createProvider(cloudSettings, 1_000).complete({
      ...completion,
      responseFormat: 'json',
      responseSchema: {
        name: 'cloud_schema',
        schema: { type: 'object', properties: {}, additionalProperties: false },
      },
    });

    expect(receivedBody).not.toHaveProperty('format');
  });

  it('uses LM Studio JSON schema mode and accepts structured reasoning output', async () => {
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
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  reasoning_content: '{"accepted":true,"reason":"ok"}',
                },
              },
            ],
          }),
        );
      });
    });

    const result = await createProvider(settings('lm-studio', base), 1_000).complete({
      ...completion,
      responseFormat: 'json',
    });

    expect(result.text).toBe('{"accepted":true,"reason":"ok"}');
    expect(receivedBody.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'structured_response',
        strict: false,
        schema: { type: 'object' },
      },
    });
  });

  it('passes an exact structured schema to LM Studio', async () => {
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
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '{"accepted":true,"reason":"ok"}' } }],
          }),
        );
      });
    });
    const schema = {
      type: 'object',
      properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['accepted', 'reason'],
      additionalProperties: false,
    };

    await createProvider(settings('lm-studio', base), 1_000).complete({
      ...completion,
      responseFormat: 'json',
      responseSchema: { name: 'action_validation', schema },
    });

    expect(receivedBody.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'action_validation',
        strict: true,
        schema,
      },
    });
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
