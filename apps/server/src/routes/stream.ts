import type { Router } from 'express';
import { z } from 'zod';
import { parseUuid, type ApiRouteContext } from './context.js';

export function registerStreamRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies } = context;
  router.get('/stream', (req, res) => {
    const gameId = parseUuid(z.string().parse(req.query.gameId));
    dependencies.repository.getGame(gameId);
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const unsubscribe = dependencies.stream.subscribe(gameId, res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
