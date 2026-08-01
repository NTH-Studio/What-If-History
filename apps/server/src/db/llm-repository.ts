import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite';
import type {
  LlmCallPhase,
  LlmCallStatus,
  LlmCallType,
  LlmProviderName,
  LlmSettingsInput,
  LlmSettingsPublic,
  LlmTokenUsage,
} from '@what-if-history/contracts';
import { notFound } from '../errors.js';
import { structuredOutputModeFor } from '../llm/providers.js';
import { asNullableNumber, asNumber, asString, now, type Row } from './values.js';

export class LlmRepository {
  constructor(private readonly database: DatabaseSync) {}

  getLlmSettings(editable: boolean): LlmSettingsPublic {
    const row = this.database.prepare('SELECT * FROM llm_settings WHERE id = 1').get() as
      Row | undefined;
    if (!row) {
      const settings = {
        provider: 'lm-studio',
        apiUrl: 'http://127.0.0.1:1234/v1',
        model: 'qwen/qwen3.5-9b',
      } as const;
      return {
        ...settings,
        hasApiKey: false,
        editable,
        structuredOutputMode: structuredOutputModeFor(settings),
      };
    }
    const settings = {
      provider: asString(row.provider) as LlmSettingsPublic['provider'],
      apiUrl: asString(row.api_url),
      model: asString(row.model),
    };
    return {
      ...settings,
      hasApiKey: asString(row.api_key).length > 0,
      editable,
      structuredOutputMode: structuredOutputModeFor(settings),
    };
  }

  getLlmSettingsPrivate() {
    const row = this.database.prepare('SELECT * FROM llm_settings WHERE id = 1').get() as
      Row | undefined;
    return row
      ? {
          provider: asString(row.provider) as LlmSettingsInput['provider'],
          apiUrl: asString(row.api_url),
          apiKey: asString(row.api_key),
          model: asString(row.model),
        }
      : {
          provider: 'lm-studio' as const,
          apiUrl: 'http://127.0.0.1:1234/v1',
          apiKey: '',
          model: 'qwen/qwen3.5-9b',
        };
  }

  saveLlmSettings(input: LlmSettingsInput) {
    const existing = this.getLlmSettingsPrivate();
    const submittedApiKey = input.apiKey?.trim() ? input.apiKey : undefined;
    const apiKey = input.clearApiKey ? '' : (submittedApiKey ?? existing.apiKey);
    this.database
      .prepare(
        `INSERT INTO llm_settings (
          id, provider, api_url, api_key, model, imported_legacy, updated_at
        ) VALUES (1, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          api_url = excluded.api_url,
          api_key = excluded.api_key,
          model = excluded.model,
          updated_at = excluded.updated_at`,
      )
      .run(input.provider, input.apiUrl, apiKey, input.model, now());
  }

  importLegacyLlmSettings(settings: {
    provider: string;
    apiUrl: string;
    apiKey: string;
    model: string;
  }) {
    const count = this.database.prepare('SELECT COUNT(*) AS count FROM llm_settings').get() as Row;
    if (asNumber(count.count) > 0) return false;
    this.database
      .prepare(
        `INSERT INTO llm_settings (
          id, provider, api_url, api_key, model, imported_legacy, updated_at
        ) VALUES (1, ?, ?, ?, ?, 1, ?)`,
      )
      .run(settings.provider, settings.apiUrl, settings.apiKey, settings.model, now());
    return true;
  }

  createLlmCall(input: {
    id: string;
    gameId: string | null;
    gameName: string | null;
    requestId: string;
    clientId: string;
    type: LlmCallType;
    provider: LlmProviderName;
    model: string;
  }): LlmCallRecord {
    const startedAt = now();
    this.database
      .prepare(
        `INSERT INTO llm_calls (
          id, game_id, game_name, request_id, client_id, call_type, provider, model,
          phase, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'preparing', 'running', ?)`,
      )
      .run(
        input.id,
        input.gameId,
        input.gameName,
        input.requestId,
        input.clientId,
        input.type,
        input.provider,
        input.model,
        startedAt,
      );
    return this.getLlmCall(input.id);
  }

  updateLlmCallPhase(id: string, phase: LlmCallPhase): LlmCallRecord {
    const result = this.database
      .prepare("UPDATE llm_calls SET phase = ? WHERE id = ? AND status = 'running'")
      .run(phase, id);
    this.expectChange(result, 'LLM call');
    return this.getLlmCall(id);
  }

  completeLlmCall(id: string, usage: LlmTokenUsage | null): LlmCallRecord {
    const completedAt = now();
    const started = this.getLlmCall(id);
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(started.startedAt));
    const result = this.database
      .prepare(
        `UPDATE llm_calls
         SET phase = 'applying_result', status = 'succeeded', completed_at = ?, duration_ms = ?,
             input_tokens = ?, output_tokens = ?, total_tokens = ?, error_code = NULL
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        completedAt,
        durationMs,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.totalTokens ?? null,
        id,
      );
    this.expectChange(result, 'LLM call');
    this.pruneLlmCalls();
    return this.getLlmCall(id);
  }

  failLlmCall(id: string, errorCode: string): LlmCallRecord {
    const completedAt = now();
    const started = this.getLlmCall(id);
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(started.startedAt));
    const result = this.database
      .prepare(
        `UPDATE llm_calls
         SET status = 'failed', completed_at = ?, duration_ms = ?, error_code = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(completedAt, durationMs, errorCode, id);
    this.expectChange(result, 'LLM call');
    this.pruneLlmCalls();
    return this.getLlmCall(id);
  }

  markInterruptedLlmCalls(): LlmCallRecord[] {
    const running = this.database
      .prepare("SELECT id FROM llm_calls WHERE status = 'running'")
      .all() as Row[];
    return running.map((row) => this.failLlmCall(asString(row.id), 'SERVER_RESTARTED'));
  }

  listLlmCalls(options: { gameId?: string; limit: number }): LlmCallRecord[] {
    const gameFilter = options.gameId ? ' AND game_id = ?' : '';
    const parameters = options.gameId ? [options.gameId] : [];
    const active = this.database
      .prepare(
        `SELECT * FROM llm_calls
         WHERE status = 'running'${gameFilter}
         ORDER BY started_at DESC, rowid DESC`,
      )
      .all(...parameters) as Row[];
    const completed = this.database
      .prepare(
        `SELECT * FROM llm_calls
         WHERE status != 'running'${gameFilter}
         ORDER BY completed_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(...parameters, Math.min(100, Math.max(1, options.limit))) as Row[];
    return [...active, ...completed].map(this.mapLlmCall);
  }

  private getLlmCall(id: string): LlmCallRecord {
    const row = this.database.prepare('SELECT * FROM llm_calls WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) throw notFound('LLM call');
    return this.mapLlmCall(row);
  }

  private pruneLlmCalls() {
    this.database
      .prepare(
        `DELETE FROM llm_calls
         WHERE status != 'running'
           AND id NOT IN (
             SELECT id FROM llm_calls
             WHERE status != 'running'
             ORDER BY completed_at DESC, rowid DESC
             LIMIT 100
           )`,
      )
      .run();
  }

  private mapLlmCall = (row: Row): LlmCallRecord => ({
    id: asString(row.id),
    gameId: row.game_id === null ? null : asString(row.game_id),
    gameName: row.game_name === null ? null : asString(row.game_name),
    requestId: asString(row.request_id),
    clientId: asString(row.client_id),
    type: asString(row.call_type) as LlmCallType,
    provider: asString(row.provider) as LlmProviderName,
    model: asString(row.model),
    phase: asString(row.phase) as LlmCallPhase,
    status: asString(row.status) as LlmCallStatus,
    startedAt: asString(row.started_at),
    completedAt: row.completed_at === null ? null : asString(row.completed_at),
    durationMs: asNullableNumber(row.duration_ms),
    usage:
      row.input_tokens === null || row.output_tokens === null || row.total_tokens === null
        ? null
        : {
            inputTokens: asNumber(row.input_tokens),
            outputTokens: asNumber(row.output_tokens),
            totalTokens: asNumber(row.total_tokens),
          },
    errorCode: row.error_code === null ? null : asString(row.error_code),
  });

  private expectChange(result: StatementResultingChanges, resource: string) {
    if (result.changes === 0) throw notFound(resource);
  }
}

export interface LlmCallRecord {
  id: string;
  gameId: string | null;
  gameName: string | null;
  requestId: string;
  clientId: string;
  type: LlmCallType;
  provider: LlmProviderName;
  model: string;
  phase: LlmCallPhase;
  status: LlmCallStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  usage: LlmTokenUsage | null;
  errorCode: string | null;
}
