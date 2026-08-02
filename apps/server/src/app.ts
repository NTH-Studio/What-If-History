import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import pino from 'pino';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { Catalog } from './catalog.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';
import { AdvancedRepository } from './db/advanced-repository.js';
import { AppError, errorMiddleware } from './errors.js';
import { importLegacySettings } from './legacy-settings.js';
import { LlmActivityHub, LlmActivityTracker } from './llm/activity.js';
import { LlmService } from './llm/service.js';
import { createApiRouter } from './routes.js';
import { SseHub } from './sse.js';
import { TurnService } from './turn-service.js';
import { ActionEffectResolver } from './action-resolver.js';
import { StrategicRepository } from './db/strategic-repository.js';

interface CreateAppOptions {
  database?: DatabaseSync;
  databasePath?: string;
  dataDirectory?: string;
  webDirectory?: string;
  environment?: typeof config.environment;
}

export function createApp(options: CreateAppOptions = {}) {
  const dataDirectory = options.dataDirectory ?? config.dataDirectory;
  const webDirectory = options.webDirectory ?? config.webDirectory;
  const database = options.database ?? openDatabase(options.databasePath ?? config.databasePath);
  const environment = options.environment ?? config.environment;
  const catalog = new Catalog(dataDirectory);
  const repository = new Repository(database, catalog);
  const advanced = new AdvancedRepository(database, catalog);
  const strategic = new StrategicRepository(database, catalog);
  const actionEffects = new ActionEffectResolver(catalog, advanced);
  importLegacySettings(repository, dataDirectory);
  const logger = pino({ level: config.logLevel });
  const stream = new SseHub();
  const llmActivityStream = new LlmActivityHub();
  const llmActivity = new LlmActivityTracker(repository, llmActivityStream, logger);
  llmActivity.recoverInterruptedCalls();
  const llm = new LlmService(repository, advanced, config.llmTimeoutMs, environment === 'test');
  const turns = new TurnService(repository, advanced, strategic, llm, stream, llmActivity);

  const app = express();
  app.locals.logger = logger;
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
    const startedAt = Date.now();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    res.on('finish', () => {
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
        'request completed',
      );
    });
    next();
  });
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
      strictTransportSecurity: false,
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60_000,
      limit: config.globalRateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) => req.path === '/stream' || req.path === '/llm/activity/stream',
    }),
  );

  app.use('/api/v1', (req, res, next) => {
    cors({
      origin(origin, callback) {
        let isSameOrigin = false;
        if (origin) {
          try {
            isSameOrigin = new URL(origin).host === req.get('host');
          } catch {
            isSameOrigin = false;
          }
        }
        if (!origin || isSameOrigin || config.appOrigins.includes(origin)) callback(null, true);
        else callback(new AppError(403, 'ORIGIN_FORBIDDEN', 'This origin is not allowed.'));
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    })(req, res, next);
  });
  app.use(
    '/api/v1',
    createApiRouter({
      catalog,
      repository,
      advanced,
      strategic,
      actionEffects,
      llm,
      turns,
      stream,
      llmActivity,
      llmActivityStream,
      llmRateLimitPerMinute: config.llmRateLimitPerMinute,
      allowFakeLlmProvider: environment === 'test',
    }),
  );
  app.use('/api', (_req, _res, next) => {
    next(new AppError(404, 'API_ROUTE_NOT_FOUND', 'The API route does not exist.'));
  });

  if (fs.existsSync(webDirectory)) {
    app.use(express.static(webDirectory, { index: false }));
    app.use('/assets', (_req, res) => {
      res.status(404).type('text/plain').send('Asset not found. Reload the application.');
    });
    app.get('*splat', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(webDirectory, 'index.html'));
    });
  }

  app.use(errorMiddleware);
  return { app, database, repository, advanced, strategic, catalog, llmActivity };
}
