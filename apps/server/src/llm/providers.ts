import type {
  LlmProviderName,
  LlmSettingsInput,
  LlmTokenUsage,
  StructuredOutputMode,
} from '@what-if-history/contracts';
import { AppError } from '../errors.js';

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'json';
  responseSchema?: {
    name: string;
    schema: unknown;
  };
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface CompletionResult {
  text: string;
  usage?: LlmTokenUsage;
}

export interface PrivateLlmSettings {
  provider: LlmProviderName;
  apiUrl: string;
  apiKey: string;
  model: string;
}

export function assertLlmProviderAllowed(provider: LlmProviderName, allowFakeProvider: boolean) {
  if (provider === 'fake' && !allowFakeProvider) {
    throw new AppError(
      409,
      'FAKE_LLM_PROVIDER_DISABLED',
      'The deterministic AI provider is restricted to isolated test servers. Configure a real AI provider.',
    );
  }
}

export function structuredOutputModeFor(
  settings: Pick<PrivateLlmSettings, 'provider' | 'apiUrl' | 'model'>,
): StructuredOutputMode {
  if (
    settings.provider === 'lm-studio' ||
    settings.provider === 'openai' ||
    settings.provider === 'google'
  ) {
    return 'native_json_schema';
  }
  if (settings.provider === 'ollama') {
    return usesOllamaCloud(settings) ? 'server_validation' : 'native_json_schema';
  }
  if (settings.provider === 'llama.cpp' || settings.provider === 'vllm') {
    return 'json_mode';
  }
  return 'server_validation';
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) {
      throw new AppError(
        502,
        'LLM_HTTP_ERROR',
        `The AI provider returned HTTP ${response.status}.`,
      );
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new AppError(502, 'LLM_INVALID_RESPONSE', 'The AI provider returned invalid JSON.');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(504, 'LLM_TIMEOUT', 'The AI provider did not answer in time.');
    }
    throw new AppError(502, 'LLM_UNREACHABLE', 'The AI provider could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOpenAiBase(url: string) {
  return url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function normalizeOllamaChatUrl(url: string) {
  const base = url.replace(/\/+$/, '');
  if (base.endsWith('/api/chat')) return base;
  if (base.endsWith('/api')) return `${base}/chat`;
  return `${base}/api/chat`;
}

function usesOllamaCloud(settings: Pick<PrivateLlmSettings, 'apiUrl' | 'model'>) {
  if (settings.model.toLowerCase().endsWith(':cloud')) return true;
  try {
    const hostname = new URL(settings.apiUrl).hostname.toLowerCase();
    return hostname === 'ollama.com' || hostname.endsWith('.ollama.com');
  } catch {
    return false;
  }
}

function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function usageFrom(input: unknown, output: unknown, total: unknown): LlmTokenUsage | undefined {
  const inputTokens = tokenCount(input);
  const outputTokens = tokenCount(output);
  const totalTokens = tokenCount(total);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? inputTokens + outputTokens,
  };
}

function structuredResponseFormat(
  provider: LlmProviderName,
  responseSchema?: CompletionRequest['responseSchema'],
) {
  if (provider === 'lm-studio' || provider === 'openai') {
    if (responseSchema) {
      return {
        type: 'json_schema',
        json_schema: {
          name: responseSchema.name,
          strict: true,
          schema: responseSchema.schema,
        },
      };
    }
    return {
      type: 'json_schema',
      json_schema: {
        name: 'structured_response',
        strict: false,
        schema: { type: 'object' },
      },
    };
  }
  return { type: 'json_object' };
}

class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: LlmProviderName;

  constructor(
    private readonly settings: PrivateLlmSettings,
    private readonly timeoutMs: number,
  ) {
    this.name = settings.provider;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    let base = normalizeOpenAiBase(this.settings.apiUrl);
    if (!base.endsWith('/v1')) base += '/v1';
    const result = await requestJson(
      `${base}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.settings.apiKey || 'not-needed'}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 3_000,
          ...(request.responseFormat === 'json'
            ? {
                response_format: structuredResponseFormat(
                  this.settings.provider,
                  request.responseSchema,
                ),
              }
            : {}),
        }),
      },
      this.timeoutMs,
    );
    const choices = result.choices;
    const message =
      Array.isArray(choices) &&
      typeof choices[0] === 'object' &&
      choices[0] !== null &&
      'message' in choices[0] &&
      typeof choices[0].message === 'object' &&
      choices[0].message !== null
        ? (choices[0].message as Record<string, unknown>)
        : undefined;
    const content =
      typeof message?.content === 'string' && message.content.trim()
        ? message.content
        : message?.reasoning_content;
    if (typeof content !== 'string') {
      throw new AppError(502, 'LLM_INVALID_RESPONSE', 'The AI response contained no message.');
    }
    const usage =
      typeof result.usage === 'object' && result.usage !== null
        ? usageFrom(
            (result.usage as Record<string, unknown>).prompt_tokens,
            (result.usage as Record<string, unknown>).completion_tokens,
            (result.usage as Record<string, unknown>).total_tokens,
          )
        : undefined;
    return { text: content, ...(usage ? { usage } : {}) };
  }
}

class OllamaProvider implements LlmProvider {
  readonly name = 'ollama' as const;

  constructor(
    private readonly settings: PrivateLlmSettings,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const result = await requestJson(
      normalizeOllamaChatUrl(this.settings.apiUrl),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.settings.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          stream: false,
          think: false,
          options: {
            temperature: request.temperature ?? 0.7,
            num_predict: request.maxTokens ?? 3_000,
          },
          ...(request.responseFormat === 'json' && !usesOllamaCloud(this.settings)
            ? { format: request.responseSchema?.schema ?? 'json' }
            : {}),
        }),
      },
      this.timeoutMs,
    );
    const message =
      typeof result.message === 'object' && result.message !== null
        ? (result.message as Record<string, unknown>)
        : undefined;
    const content =
      typeof message?.content === 'string' && message.content.trim()
        ? message.content
        : message?.thinking;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AppError(502, 'LLM_INVALID_RESPONSE', 'The Ollama response contained no message.');
    }
    const usage = usageFrom(result.prompt_eval_count, result.eval_count, undefined);
    return { text: content, ...(usage ? { usage } : {}) };
  }
}

class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly settings: PrivateLlmSettings,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const url = this.settings.apiUrl.replace(/\/+$/, '');
    const result = await requestJson(
      url.endsWith('/messages') ? url : `${url}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.settings.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.settings.model,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          max_tokens: request.maxTokens ?? 3_000,
          temperature: request.temperature ?? 0.7,
        }),
      },
      this.timeoutMs,
    );
    const content = result.content;
    const text =
      Array.isArray(content) && typeof content[0] === 'object' && content[0] !== null
        ? (content[0] as Record<string, unknown>).text
        : undefined;
    if (typeof text !== 'string') {
      throw new AppError(502, 'LLM_INVALID_RESPONSE', 'The Anthropic response contained no text.');
    }
    const usage =
      typeof result.usage === 'object' && result.usage !== null
        ? usageFrom(
            (result.usage as Record<string, unknown>).input_tokens,
            (result.usage as Record<string, unknown>).output_tokens,
            undefined,
          )
        : undefined;
    return { text, ...(usage ? { usage } : {}) };
  }
}

class GoogleProvider implements LlmProvider {
  readonly name = 'google' as const;

  constructor(
    private readonly settings: PrivateLlmSettings,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const base = this.settings.apiUrl.replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(this.settings.model)}:generateContent?key=${encodeURIComponent(this.settings.apiKey)}`;
    const result = await requestJson(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: request.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens ?? 3_000,
            ...(request.responseFormat === 'json'
              ? {
                  responseMimeType: 'application/json',
                  ...(request.responseSchema
                    ? { responseJsonSchema: request.responseSchema.schema }
                    : {}),
                }
              : {}),
          },
        }),
      },
      this.timeoutMs,
    );
    const candidates = result.candidates;
    const text =
      Array.isArray(candidates) &&
      typeof candidates[0] === 'object' &&
      candidates[0] !== null &&
      'content' in candidates[0] &&
      typeof candidates[0].content === 'object' &&
      candidates[0].content !== null &&
      'parts' in candidates[0].content &&
      Array.isArray(candidates[0].content.parts) &&
      typeof candidates[0].content.parts[0] === 'object' &&
      candidates[0].content.parts[0] !== null
        ? (candidates[0].content.parts[0] as Record<string, unknown>).text
        : undefined;
    if (typeof text !== 'string') {
      throw new AppError(502, 'LLM_INVALID_RESPONSE', 'The Google response contained no text.');
    }
    const usage =
      typeof result.usageMetadata === 'object' && result.usageMetadata !== null
        ? usageFrom(
            (result.usageMetadata as Record<string, unknown>).promptTokenCount,
            (result.usageMetadata as Record<string, unknown>).candidatesTokenCount,
            (result.usageMetadata as Record<string, unknown>).totalTokenCount,
          )
        : undefined;
    return { text, ...(usage ? { usage } : {}) };
  }
}

class FakeProvider implements LlmProvider {
  readonly name = 'fake' as const;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const french = request.system.includes('Réponds exclusivement en français.');
    if (request.user.includes('"output"') && request.user.includes('"events"')) {
      const turnInput = JSON.parse(request.user) as {
        timeJump?: { strategy?: string; amount?: number };
        playerNation?: { code?: string };
      };
      return {
        text: JSON.stringify({
          ...(turnInput.timeJump?.strategy === 'next_major_event'
            ? { time_advance_amount: Math.min(1, turnInput.timeJump.amount ?? 1) }
            : {}),
          events: [
            {
              title: french ? 'Situation stratégique actualisée' : 'Strategic situation updated',
              description: french
                ? 'La situation diplomatique et économique évolue sans incident majeur.'
                : 'The diplomatic and economic situation evolves without a major incident.',
              event_type: 'political',
              severity: 'minor',
              affected_nations: turnInput.playerNation?.code ? [turnInput.playerNation.code] : [],
              state_changes: {},
            },
          ],
          law_changes: [],
        }),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    if (request.user.includes('"accepted"')) {
      const forcedRejection = request.user.includes('FORCE_REJECT_FOR_TEST');
      return {
        text: JSON.stringify({
          accepted: !forcedRejection,
          reason: forcedRejection
            ? french
              ? 'Avertissement de faisabilité simulé.'
              : 'Simulated feasibility warning.'
            : french
              ? 'Ordre historiquement plausible.'
              : 'Historically plausible.',
        }),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    return {
      text: french
        ? 'Une réponse stratégique mesurée est recommandée.'
        : 'A measured strategic response is recommended.',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}

export function createProvider(settings: PrivateLlmSettings, timeoutMs: number): LlmProvider {
  if (settings.provider === 'fake') return new FakeProvider();
  if (settings.provider === 'ollama') return new OllamaProvider(settings, timeoutMs);
  if (settings.provider === 'anthropic') return new AnthropicProvider(settings, timeoutMs);
  if (settings.provider === 'google') return new GoogleProvider(settings, timeoutMs);
  return new OpenAiCompatibleProvider(settings, timeoutMs);
}

export function toPrivateSettings(
  input: LlmSettingsInput,
  existingApiKey = '',
): PrivateLlmSettings {
  const submittedApiKey = input.apiKey?.trim() ? input.apiKey : undefined;
  return {
    provider: input.provider,
    apiUrl: input.apiUrl,
    apiKey: input.clearApiKey ? '' : (submittedApiKey ?? existingApiKey),
    model: input.model,
  };
}
