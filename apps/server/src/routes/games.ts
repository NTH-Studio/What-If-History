import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import {
  createGameInputSchema,
  nationCodeSchema,
  renameGameInputSchema,
  timeJumpSchema,
  updateGameConfigInputSchema,
  uuidSchema,
} from '@what-if-history/contracts';
import {
  parseUuid,
  requestClientId,
  requestId,
  requestLanguage,
  type ApiRouteContext,
} from './context.js';

export function registerGameRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies, llmLimiter } = context;
  router.get('/games', (req, res) => {
    res.json(dependencies.repository.listGames(requestLanguage(req)));
  });
  router.post('/games', (req, res) => {
    const input = createGameInputSchema.parse(req.body);
    const game = dependencies.repository.createGame(input, requestLanguage(req));
    dependencies.strategic.ensureGame(game.id);
    res.status(201).json(game);
  });
  router.get('/games/:gameId', (req, res) => {
    res.json(dependencies.repository.getGame(parseUuid(req.params.gameId), requestLanguage(req)));
  });
  router.get('/games/:gameId/countries', (req, res) => {
    res.json(
      dependencies.repository.listCountries(parseUuid(req.params.gameId), requestLanguage(req)),
    );
  });
  router.get('/games/:gameId/countries/:nationCode', (req, res) => {
    res.json(
      dependencies.repository.getCountryProfile(
        parseUuid(req.params.gameId),
        nationCodeSchema.parse(String(req.params.nationCode).toUpperCase()),
        requestLanguage(req),
      ),
    );
  });
  router.patch('/games/:gameId', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const input = renameGameInputSchema.parse(req.body);
    dependencies.repository.renameGame(gameId, input.name);
    res.json(dependencies.repository.getGame(gameId, requestLanguage(req)));
  });
  router.patch('/games/:gameId/config', (req, res) => {
    res.json(
      dependencies.repository.updateGameConfig(
        parseUuid(req.params.gameId),
        updateGameConfigInputSchema.parse(req.body),
        requestLanguage(req),
      ),
    );
  });
  router.delete('/games/:gameId', (req, res) => {
    dependencies.repository.deleteGame(parseUuid(req.params.gameId));
    res.status(204).end();
  });

  router.post('/games/:gameId/turns', llmLimiter, async (req, res) => {
    const parsedIdempotencyKey = uuidSchema.safeParse(req.get('x-idempotency-key'));
    const result = await dependencies.turns.advance(
      parseUuid(req.params.gameId),
      timeJumpSchema.parse(req.body),
      { requestId: requestId(res), clientId: requestClientId(req) },
      parsedIdempotencyKey.success ? parsedIdempotencyKey.data : randomUUID(),
      requestLanguage(req),
    );
    res.status(201).json(result);
  });
}
