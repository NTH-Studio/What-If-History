import type { LlmProviderName, LlmSettingsInput, LlmTokenUsage } from '@what-if-history/contracts';
import { AppError } from '../errors.js';

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'json';
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
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
      },
      this.timeoutMs,
    );
    const choices = result.choices;
    const content =
      Array.isArray(choices) &&
      typeof choices[0] === 'object' &&
      choices[0] !== null &&
      'message' in choices[0] &&
      typeof choices[0].message === 'object' &&
      choices[0].message !== null &&
      'content' in choices[0].message
        ? choices[0].message.content
        : undefined;
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
      return {
        text: JSON.stringify({
          accepted: true,
          reason: french ? 'Ordre historiquement plausible.' : 'Historically plausible.',
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
  if (settings.provider === 'anthropic') return new AnthropicProvider(settings, timeoutMs);
  if (settings.provider === 'google') return new GoogleProvider(settings, timeoutMs);
  return new OpenAiCompatibleProvider(settings, timeoutMs);
}

export function toPrivateSettings(
  input: LlmSettingsInput,
  existingApiKey = '',
): PrivateLlmSettings {
  return {
    provider: input.provider,
    apiUrl: input.apiUrl,
    apiKey: input.clearApiKey ? '' : (input.apiKey ?? existingApiKey),
    model: input.model,
  };
}
