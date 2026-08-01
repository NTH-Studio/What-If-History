import type { Router } from 'express';
import { advisorInputSchema } from '@what-if-history/contracts';
import {
  parseUuid,
  requestClientId,
  requestId,
  requestLanguage,
  type ApiRouteContext,
} from './context.js';

export function registerAdvisorRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies, llmLimiter } = context;
  router.get('/games/:gameId/advisor', (req, res) => {
    res.json(dependencies.advanced.listAdvisorMessages(parseUuid(req.params.gameId)));
  });
  router.delete('/games/:gameId/advisor', (req, res) => {
    dependencies.advanced.clearAdvisorMessages(parseUuid(req.params.gameId));
    res.status(204).end();
  });
  router.post('/games/:gameId/advisor', llmLimiter, async (req, res) => {
    const game = dependencies.repository.getGame(parseUuid(req.params.gameId));
    const { question } = advisorInputSchema.parse(req.body);
    const activity = dependencies.llmActivity.start({
      gameId: game.id,
      gameName: game.name,
      requestId: requestId(res),
      clientId: requestClientId(req),
      type: 'advisor',
      ...(game.aiModels.advisor ? { model: game.aiModels.advisor } : {}),
    });
    try {
      const result = await dependencies.llm.advise(game, question, activity, requestLanguage(req));
      activity.phase('applying_result');
      const messages = dependencies.advanced.addAdvisorExchange(game.id, question, result.value);
      activity.succeed(result.usage);
      res.json({ response: result.value, messages });
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  });
}
