import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { uuidSchema } from '@what-if-history/contracts';
import type { Catalog } from '../catalog.js';
import type { AdvancedRepository } from '../db/advanced-repository.js';
import type { Repository } from '../db/repository.js';
import type { StrategicRepository } from '../db/strategic-repository.js';
import { AppError } from '../errors.js';
import type { LlmActivityHub, LlmActivityTracker } from '../llm/activity.js';
import type { GenerationLanguage, LlmService } from '../llm/service.js';
import type { ActionEffectResolver } from '../action-resolver.js';
import type { SseHub } from '../sse.js';
import type { TurnService } from '../turn-service.js';

export interface ApiDependencies {
  catalog: Catalog;
  repository: Repository;
  advanced: AdvancedRepository;
  strategic: StrategicRepository;
  actionEffects: ActionEffectResolver;
  llm: LlmService;
  turns: TurnService;
  stream: SseHub;
  llmActivity: LlmActivityTracker;
  llmActivityStream: LlmActivityHub;
  llmRateLimitPerMinute: number;
  allowFakeLlmProvider: boolean;
}

export interface ApiRouteContext {
  dependencies: ApiDependencies;
  llmLimiter: RequestHandler;
  publishWorldChanged: (
    gameId: string,
    touched: { regionIds?: string[]; unitIds?: string[]; featureIds?: string[] },
  ) => void;
}

export const parseUuid = (value: unknown) => uuidSchema.parse(value);

export const requestId = (res: Response) => String(res.locals.requestId ?? 'unknown');

export const requestClientId = (req: Request) => {
  const parsed = uuidSchema.safeParse(req.get('x-what-if-history-client-id'));
  return parsed.success ? parsed.data : randomUUID();
};

export const requestLanguage = (req: Request): GenerationLanguage => {
  const explicit = req.get('x-what-if-history-language')?.toLowerCase();
  if (explicit === 'en' || explicit?.startsWith('en-')) return 'en';
  if (explicit === 'fr' || explicit?.startsWith('fr-')) return 'fr';
  return req.get('accept-language')?.trim().toLowerCase().startsWith('en') ? 'en' : 'fr';
};

export const isLoopback = (address?: string) =>
  Boolean(
    address &&
    (address === '::1' ||
      address === '127.0.0.1' ||
      address.startsWith('127.') ||
      address.startsWith('::ffff:127.')),
  );

export function localOnly(req: Request, _res: Response, next: NextFunction) {
  if (!isLoopback(req.socket.remoteAddress)) {
    next(
      new AppError(
        403,
        'LOCAL_ADMIN_REQUIRED',
        'AI settings can only be changed from the server machine.',
      ),
    );
    return;
  }
  next();
}

export function createApiRouteContext(dependencies: ApiDependencies): ApiRouteContext {
  const llmLimiter = rateLimit({
    windowMs: 60_000,
    limit: dependencies.llmRateLimitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const publishWorldChanged: ApiRouteContext['publishWorldChanged'] = (gameId, touched) => {
    dependencies.stream.publish(gameId, 'world.changed', {
      gameId,
      worldRevision: dependencies.repository.getGame(gameId).worldRevision,
      regionIds: touched.regionIds ?? [],
      unitIds: touched.unitIds ?? [],
      featureIds: touched.featureIds ?? [],
    });
  };
  return { dependencies, llmLimiter, publishWorldChanged };
}
