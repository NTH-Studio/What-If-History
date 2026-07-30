import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type {
  LlmActivity,
  LlmCallPhase,
  LlmCallType,
  LlmProviderName,
  LlmTokenUsage,
} from '@what-if-history/contracts';
import type { Logger } from 'pino';
import { toAppError } from '../errors.js';
import type { LlmCallRecord, Repository } from '../db/repository.js';

export const toPublicLlmActivity = (record: LlmCallRecord, clientId: string): LlmActivity => ({
  id: record.id,
  gameId: record.gameId,
  gameName: record.gameName,
  requestId: record.requestId,
  type: record.type,
  provider: record.provider,
  model: record.model,
  phase: record.phase,
  status: record.status,
  startedAt: record.startedAt,
  completedAt: record.completedAt,
  durationMs: record.durationMs,
  usage: record.usage,
  errorCode: record.errorCode,
  initiatedHere: record.clientId === clientId,
});

export class LlmActivityHub {
  private readonly subscribers = new Set<{ response: Response; clientId: string }>();

  subscribe(response: Response, clientId: string) {
    const subscriber = { response, clientId };
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  publish(record: LlmCallRecord) {
    for (const subscriber of this.subscribers) {
      subscriber.response.write(
        `event: llm.activity\ndata: ${JSON.stringify(
          toPublicLlmActivity(record, subscriber.clientId),
        )}\n\n`,
      );
    }
  }
}

export interface LlmActivityHandle {
  readonly id: string;
  phase(phase: LlmCallPhase): void;
  succeed(usage?: LlmTokenUsage): void;
  fail(error: unknown): void;
}

export class LlmActivityTracker {
  constructor(
    private readonly repository: Repository,
    private readonly hub: LlmActivityHub,
    private readonly logger: Logger,
  ) {}

  recoverInterruptedCalls() {
    const interrupted = this.repository.markInterruptedLlmCalls();
    for (const record of interrupted) {
      this.log(record);
      this.hub.publish(record);
    }
    return interrupted.length;
  }

  list(clientId: string, options: { gameId?: string; limit: number }) {
    return this.repository
      .listLlmCalls(options)
      .map((record) => toPublicLlmActivity(record, clientId));
  }

  start(input: {
    gameId?: string;
    gameName?: string;
    requestId: string;
    clientId: string;
    type: LlmCallType;
    provider?: LlmProviderName;
    model?: string;
  }): LlmActivityHandle {
    const settings = this.repository.getLlmSettingsPrivate();
    let current = this.repository.createLlmCall({
      id: randomUUID(),
      gameId: input.gameId ?? null,
      gameName: input.gameName ?? null,
      requestId: input.requestId,
      clientId: input.clientId,
      type: input.type,
      provider: input.provider ?? settings.provider,
      model: input.model ?? settings.model,
    });
    let terminal = false;
    this.log(current);
    this.hub.publish(current);

    const update = (record: LlmCallRecord) => {
      current = record;
      this.log(record);
      this.hub.publish(record);
    };

    return {
      id: current.id,
      phase: (phase) => {
        if (terminal || current.phase === phase) return;
        update(this.repository.updateLlmCallPhase(current.id, phase));
      },
      succeed: (usage) => {
        if (terminal) return;
        terminal = true;
        update(this.repository.completeLlmCall(current.id, usage ?? null));
      },
      fail: (error) => {
        if (terminal) return;
        terminal = true;
        update(this.repository.failLlmCall(current.id, toAppError(error).code));
      },
    };
  }

  private log(record: LlmCallRecord) {
    this.logger.info(
      {
        activityId: record.id,
        requestId: record.requestId,
        gameId: record.gameId,
        callType: record.type,
        provider: record.provider,
        model: record.model,
        phase: record.phase,
        status: record.status,
        durationMs: record.durationMs,
        usage: record.usage,
        errorCode: record.errorCode,
      },
      'llm activity changed',
    );
  }
}
