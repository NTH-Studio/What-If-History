import type { Router } from 'express';
import {
  actionPreviewInputSchema,
  createActionInputSchema,
  enhanceActionInputSchema,
  promulgateLawInputSchema,
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
  router.post('/games/:gameId/actions', llmLimiter, async (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const input = createActionInputSchema.parse(req.body);
    const resolvedInput =
      input.effects === undefined
        ? dependencies.actionEffects.preview(
            gameId,
            {
              actionText: input.actionText,
              actionType: input.actionType,
            },
            requestLanguage(req),
          )
        : null;
    // A v3 client cannot display the v4 ambiguity selectors. Preserve the public
    // compatibility contract by queueing the text without a guaranteed mutation;
    // current clients always preview first and remain blocked by the selector UI.
    const legacyEffects =
      resolvedInput?.ambiguities.length && input.effects === undefined
        ? []
        : resolvedInput?.effects;
    const confirmedInput = resolvedInput
      ? {
          ...input,
          effects: legacyEffects ?? [],
          previewWorldRevision: resolvedInput.worldRevision,
        }
      : input;
    if ((confirmedInput.effects?.length ?? 0) > 0) {
      const reason =
        requestLanguage(req) === 'en'
          ? 'Confirmed sovereign act. Its guaranteed effects are queued for the next turn.'
          : 'Acte souverain confirmé. Ses effets garantis sont mis en file pour le prochain tour.';
      res
        .status(201)
        .json(dependencies.repository.createAction(gameId, confirmedInput, true, reason));
      return;
    }
    const game = dependencies.repository.getGame(gameId);
    const activity = dependencies.llmActivity.start({
      gameId,
      gameName: game.name,
      requestId: requestId(res),
      clientId: requestClientId(req),
      type: 'action_validation',
    });
    try {
      const validation = await dependencies.llm.validateAction(
        game,
        confirmedInput.actionText,
        activity,
        requestLanguage(req),
      );
      activity.phase('applying_result');
      const validationReason = validation.value.accepted
        ? validation.value.reason
        : requestLanguage(req) === 'en'
          ? `Player decision queued for simulation. Advisory AI warning: ${validation.value.reason}`
          : `Décision du joueur mise en file pour simulation. Avis consultatif de l’IA : ${validation.value.reason}`;
      const action = dependencies.repository.createAction(
        gameId,
        confirmedInput,
        true,
        validationReason,
      );
      activity.succeed(validation.usage);
      res.status(201).json(action);
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  });
  router.post('/games/:gameId/actions/promulgate-law', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const input = promulgateLawInputSchema.parse(req.body);
    const resolvedInput =
      input.effects === undefined
        ? dependencies.actionEffects.preview(
            gameId,
            { actionText: input.actionText, actionType: 'law' },
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
        ? 'Promulgated without a vote. The law is queued and will enter into force on the next turn.'
        : 'Promulguée sans vote. La loi est mise en file et entrera en vigueur au prochain tour.';
    res
      .status(201)
      .json(dependencies.repository.createPromulgatedLaw(gameId, confirmedInput, reason));
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
