import type { Router } from 'express';
import {
  actionPreviewInputSchema,
  createActionInputSchema,
  enhanceActionInputSchema,
  updateActionInputSchema,
} from '@what-if-history/contracts';
import { AppError } from '../errors.js';
import {
  parseUuid,
  requestClientId,
  requestId,
  requestLanguage,
  type ApiRouteContext,
} from './context.js';

export function registerActionRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies, llmLimiter } = context;
  router.get('/games/:gameId/actions', (req, res) => {
    res.json(dependencies.repository.listActions(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/actions/preview', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const input = actionPreviewInputSchema.parse(req.body);
    res.json(dependencies.actionEffects.preview(gameId, input, requestLanguage(req)));
  });
  router.post('/games/:gameId/actions', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const input = createActionInputSchema.parse(req.body);
    const resolvedInput =
      input.effects === undefined
        ? dependencies.actionEffects.preview(
            gameId,
            { actionText: input.actionText },
            requestLanguage(req),
          )
        : null;
    if (resolvedInput?.ambiguities.length) {
      throw new AppError(422, 'ACTION_EFFECT_AMBIGUOUS', 'The action target is ambiguous.');
    }
    const confirmedInput = resolvedInput
      ? {
          ...input,
          effects: resolvedInput.effects,
          previewWorldRevision: resolvedInput.worldRevision,
        }
      : input;
    const reason =
      requestLanguage(req) === 'en'
        ? confirmedInput.mode === 'imposed'
          ? 'Imposed. This fact is guaranteed on the next turn; only its consequences will be simulated.'
          : 'Planned. The simulation will decide its success and consequences on the next turn.'
        : confirmedInput.mode === 'imposed'
          ? 'Imposé. Ce fait est garanti au prochain tour ; seules ses conséquences seront simulées.'
          : 'Planifié. La simulation décidera de sa réussite et de ses conséquences au prochain tour.';
    res.status(201).json(dependencies.repository.createAction(gameId, confirmedInput, reason));
  });
  router.post('/games/:gameId/actions/brainstorm', llmLimiter, async (req, res) => {
    const game = dependencies.repository.getGame(parseUuid(req.params.gameId));
    const activity = dependencies.llmActivity.start({
      gameId: game.id,
      gameName: game.name,
      requestId: requestId(res),
      clientId: requestClientId(req),
      type: 'action_brainstorm',
    });
    try {
      const result = await dependencies.llm.brainstorm(game, activity, requestLanguage(req));
      activity.phase('applying_result');
      activity.succeed(result.usage);
      res.json({ suggestions: result.value });
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  });
  router.post('/games/:gameId/actions/enhance', llmLimiter, async (req, res) => {
    const game = dependencies.repository.getGame(parseUuid(req.params.gameId));
    const { actionText } = enhanceActionInputSchema.parse(req.body);
    const activity = dependencies.llmActivity.start({
      gameId: game.id,
      gameName: game.name,
      requestId: requestId(res),
      clientId: requestClientId(req),
      type: 'action_enhance',
      ...(game.aiModels.actions ? { model: game.aiModels.actions } : {}),
    });
    try {
      const result = await dependencies.llm.enhanceAction(
        game,
        actionText,
        activity,
        requestLanguage(req),
      );
      activity.phase('applying_result');
      activity.succeed(result.usage);
      res.json({ actionText: result.value });
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  });
  router.patch('/games/:gameId/actions/:actionId', (req, res) => {
    res.json(
      dependencies.repository.updateAction(
        parseUuid(req.params.gameId),
        parseUuid(req.params.actionId),
        updateActionInputSchema.parse(req.body),
      ),
    );
  });
  router.delete('/games/:gameId/actions/:actionId', (req, res) => {
    dependencies.repository.deleteAction(
      parseUuid(req.params.gameId),
      parseUuid(req.params.actionId),
    );
    res.status(204).end();
  });
}
