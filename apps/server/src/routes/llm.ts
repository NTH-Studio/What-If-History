import type { Router } from 'express';
import { z } from 'zod';
import { llmSettingsInputSchema } from '@what-if-history/contracts';
import { assertLlmProviderAllowed } from '../llm/providers.js';
import {
  isLoopback,
  localOnly,
  parseUuid,
  requestClientId,
  requestId,
  type ApiRouteContext,
} from './context.js';

export function registerLlmRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies, llmLimiter } = context;
  router.get('/llm/settings', (req, res) => {
    res.json(dependencies.repository.getLlmSettings(isLoopback(req.socket.remoteAddress)));
  });
  router.patch('/llm/settings', localOnly, (req, res) => {
    const input = llmSettingsInputSchema.parse(req.body);
    assertLlmProviderAllowed(input.provider, dependencies.allowFakeLlmProvider);
    dependencies.repository.saveLlmSettings(input);
    res.json(dependencies.repository.getLlmSettings(true));
  });
  router.post('/llm/settings/test', localOnly, llmLimiter, async (req, res) => {
    const input = llmSettingsInputSchema.parse(req.body);
    assertLlmProviderAllowed(input.provider, dependencies.allowFakeLlmProvider);
    const activity = dependencies.llmActivity.start({
      requestId: requestId(res),
      clientId: requestClientId(req),
      type: 'connection_test',
      provider: input.provider,
      model: input.model,
    });
    try {
      const result = await dependencies.llm.test(input, activity);
      activity.phase('applying_result');
      activity.succeed(result.usage);
      res.json(result.value);
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  });

  router.get('/llm/activity', (req, res) => {
    const gameId = req.query.gameId === undefined ? undefined : parseUuid(req.query.gameId);
    const limit = z.coerce.number().int().min(1).max(100).default(100).parse(req.query.limit);
    res.json(
      dependencies.llmActivity.list(requestClientId(req), {
        ...(gameId ? { gameId } : {}),
        limit,
      }),
    );
  });

  router.get('/llm/activity/stream', (req, res) => {
    const clientId = parseUuid(z.string().parse(req.query.clientId));
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    const unsubscribe = dependencies.llmActivityStream.subscribe(res, clientId);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
