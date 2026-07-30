import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  advisorInputSchema,
  consolidationSettingsSchema,
  createActionInputSchema,
  createChatInputSchema,
  createChatMessageInputSchema,
  createGameInputSchema,
  createMapFeatureInputSchema,
  createPresetInputSchema,
  createUnitInputSchema,
  enhanceActionInputSchema,
  llmSettingsInputSchema,
  moveUnitInputSchema,
  nationCodeSchema,
  promulgateLawInputSchema,
  renameGameInputSchema,
  timeJumpSchema,
  updateActionInputSchema,
  updateConsolidationInputSchema,
  updateEventInputSchema,
  updateGameConfigInputSchema,
  updateGameRegionInputSchema,
  updateMapFeatureInputSchema,
  updatePresetInputSchema,
  uuidSchema,
} from '@what-if-history/contracts';
import type { Catalog } from './catalog.js';
import type { AdvancedRepository } from './db/advanced-repository.js';
import type { Repository } from './db/repository.js';
import { AppError } from './errors.js';
import type { LlmActivityTracker, LlmActivityHub } from './llm/activity.js';
import type { GenerationLanguage, LlmService } from './llm/service.js';
import type { SseHub } from './sse.js';
import type { TurnService } from './turn-service.js';

interface ApiDependencies {
  catalog: Catalog;
  repository: Repository;
  advanced: AdvancedRepository;
  llm: LlmService;
  turns: TurnService;
  stream: SseHub;
  llmActivity: LlmActivityTracker;
  llmActivityStream: LlmActivityHub;
  llmRateLimitPerMinute: number;
}

const parseUuid = (value: unknown) => uuidSchema.parse(value);
const requestId = (res: Response) => String(res.locals.requestId ?? 'unknown');
const requestClientId = (req: Request) => {
  const parsed = uuidSchema.safeParse(req.get('x-what-if-history-client-id'));
  return parsed.success ? parsed.data : randomUUID();
};
const requestLanguage = (req: Request): GenerationLanguage => {
  const explicit = req.get('x-what-if-history-language')?.toLowerCase();
  if (explicit === 'en' || explicit?.startsWith('en-')) return 'en';
  if (explicit === 'fr' || explicit?.startsWith('fr-')) return 'fr';
  return req.get('accept-language')?.trim().toLowerCase().startsWith('en') ? 'en' : 'fr';
};
const isLoopback = (address?: string) =>
  Boolean(
    address &&
    (address === '::1' ||
      address === '127.0.0.1' ||
      address.startsWith('127.') ||
      address.startsWith('::ffff:127.')),
  );

function localOnly(req: Request, _res: Response, next: NextFunction) {
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

export function createApiRouter(dependencies: ApiDependencies) {
  const router = Router();
  const llmLimiter = rateLimit({
    windowMs: 60_000,
    limit: dependencies.llmRateLimitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', storage: 'sqlite', version: '3.0.0' });
  });

  router.get('/catalog/nations', (req, res) => {
    res.json(dependencies.catalog.listNations(requestLanguage(req)));
  });
  router.get('/map/regions', (_req, res) => {
    res.json(dependencies.catalog.regions);
  });
  router.get('/map/cities', (req, res) => {
    res.json(dependencies.catalog.listCities(requestLanguage(req)));
  });

  router.get('/games', (req, res) => {
    res.json(dependencies.repository.listGames(requestLanguage(req)));
  });
  router.post('/games', (req, res) => {
    const input = createGameInputSchema.parse(req.body);
    res.status(201).json(dependencies.repository.createGame(input, requestLanguage(req)));
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
    const result = await dependencies.turns.advance(
      parseUuid(req.params.gameId),
      timeJumpSchema.parse(req.body),
      { requestId: requestId(res), clientId: requestClientId(req) },
      requestLanguage(req),
    );
    res.status(201).json(result);
  });

  router.get('/games/:gameId/actions', (req, res) => {
    res.json(dependencies.repository.listActions(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/actions', llmLimiter, async (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const input = createActionInputSchema.parse(req.body);
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
        input.actionText,
        activity,
        requestLanguage(req),
      );
      activity.phase('applying_result');
      const action = dependencies.repository.createAction(
        gameId,
        input,
        validation.value.accepted,
        validation.value.reason,
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
    const reason =
      requestLanguage(req) === 'en'
        ? 'Promulgated without a vote. The law is already in force; its consequences will be simulated on the next turn.'
        : 'Promulguée sans vote. La loi est déjà en vigueur ; ses conséquences seront simulées au prochain tour.';
    res
      .status(201)
      .json(dependencies.repository.createPromulgatedLaw(gameId, input.actionText, reason));
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

  router.get('/games/:gameId/events', (req, res) => {
    res.json(dependencies.repository.listEvents(parseUuid(req.params.gameId)));
  });
  router.patch('/games/:gameId/events/:eventId', (req, res) => {
    const input = updateEventInputSchema.parse(req.body);
    res.json(
      dependencies.advanced.updateEvent(
        parseUuid(req.params.gameId),
        parseUuid(req.params.eventId),
        {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.event_type !== undefined ? { event_type: input.event_type } : {}),
          ...(input.severity !== undefined ? { severity: input.severity } : {}),
        },
      ),
    );
  });
  router.delete('/games/:gameId/events/:eventId', (req, res) => {
    dependencies.advanced.deleteEvent(parseUuid(req.params.gameId), parseUuid(req.params.eventId));
    res.status(204).end();
  });

  router.get('/games/:gameId/units', (req, res) => {
    res.json(dependencies.repository.listUnits(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/units', (req, res) => {
    const input = createUnitInputSchema.parse(req.body);
    res.status(201).json(dependencies.repository.createUnit(parseUuid(req.params.gameId), input));
  });
  router.put('/games/:gameId/units/:unitId/move', (req, res) => {
    const input = moveUnitInputSchema.parse(req.body);
    res.json(
      dependencies.repository.moveUnit(
        parseUuid(req.params.gameId),
        parseUuid(req.params.unitId),
        input.regionId,
        input.centroid,
      ),
    );
  });
  router.delete('/games/:gameId/units/:unitId', (req, res) => {
    dependencies.repository.deleteUnit(parseUuid(req.params.gameId), parseUuid(req.params.unitId));
    res.status(204).end();
  });

  router.get('/games/:gameId/chats', (req, res) => {
    res.json(dependencies.repository.listChats(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/chats', (req, res) => {
    const input = createChatInputSchema.parse(req.body);
    const participants = input.participantNationCodes ?? [input.targetNationCode!];
    res
      .status(201)
      .json(dependencies.repository.createChat(parseUuid(req.params.gameId), participants));
  });
  router.patch('/games/:gameId/chats/:chatId/speaker', (req, res) => {
    const nationCode = nationCodeSchema.parse(req.body?.nationCode);
    res.json(
      dependencies.repository.setNextChatSpeaker(
        parseUuid(req.params.gameId),
        parseUuid(req.params.chatId),
        nationCode,
      ),
    );
  });
  router.get('/games/:gameId/chats/:chatId/messages', (req, res) => {
    res.json(
      dependencies.repository.listChatMessages(
        parseUuid(req.params.gameId),
        parseUuid(req.params.chatId),
      ),
    );
  });
  router.post('/games/:gameId/chats/:chatId/messages', llmLimiter, async (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const chatId = parseUuid(req.params.chatId);
    const input = createChatMessageInputSchema.parse(req.body);
    const game = dependencies.repository.getGame(gameId);
    const chat = dependencies.repository.getChat(gameId, chatId);
    const history = dependencies.repository.listChatMessages(gameId, chatId);
    const playerMessage = dependencies.repository.addChatMessage(
      chat,
      game.playerNationCode,
      game.playerNation.name,
      game.playerNation.leader_name ?? 'Leader',
      input.messageText,
      game.currentDate,
    );
    const speakerCode = chat.nextSpeakerNationCode ?? chat.participants[0]!.nationCode;
    const target = dependencies.catalog.nations.get(speakerCode);
    if (!target) throw new AppError(500, 'CATALOG_INVALID', 'The target nation is missing.');
    const activity = dependencies.llmActivity.start({
      gameId,
      gameName: game.name,
      requestId: requestId(res),
      clientId: requestClientId(req),
      type: 'diplomacy_reply',
      ...(game.aiModels.diplomacy ? { model: game.aiModels.diplomacy } : {}),
    });
    try {
      const replyText = await dependencies.llm.diplomaticReply(
        game,
        target.name,
        history,
        input.messageText,
        activity,
        requestLanguage(req),
      );
      activity.phase('applying_result');
      const reply = dependencies.repository.addChatMessage(
        chat,
        target.code,
        target.name,
        target.leader_name ?? 'Leader',
        replyText.value,
        game.currentDate,
      );
      const currentIndex = chat.participants.findIndex(
        (participant) => participant.nationCode === target.code,
      );
      const nextParticipant = chat.participants[(currentIndex + 1) % chat.participants.length]!;
      dependencies.repository.setNextChatSpeaker(gameId, chatId, nextParticipant.nationCode);
      activity.succeed(replyText.usage);
      res.status(201).json({ playerMessage, reply });
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  });

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

  router.get('/games/:gameId/turn-runs', (req, res) => {
    res.json(dependencies.advanced.listTurnRuns(parseUuid(req.params.gameId)));
  });
  router.get('/games/:gameId/snapshots', (req, res) => {
    res.json(dependencies.advanced.listSnapshots(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/snapshots', (req, res) => {
    const label = z.string().trim().min(1).max(120).parse(req.body?.label);
    res.status(201).json(dependencies.advanced.createSnapshot(parseUuid(req.params.gameId), label));
  });
  router.post('/games/:gameId/snapshots/:snapshotId/restore', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    dependencies.advanced.restoreSnapshot(gameId, parseUuid(req.params.snapshotId));
    res.json(dependencies.repository.getGame(gameId, requestLanguage(req)));
  });

  router.get('/games/:gameId/consolidations', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    res.json({
      settings: dependencies.advanced.getConsolidationSettings(gameId),
      items: dependencies.advanced.listConsolidations(gameId),
    });
  });
  router.patch('/games/:gameId/consolidations/settings', (req, res) => {
    res.json(
      dependencies.advanced.updateConsolidationSettings(
        parseUuid(req.params.gameId),
        consolidationSettingsSchema.parse(req.body),
      ),
    );
  });
  router.patch('/games/:gameId/consolidations/:consolidationId', (req, res) => {
    const { summary } = updateConsolidationInputSchema.parse(req.body);
    res.json(
      dependencies.advanced.updateConsolidation(
        parseUuid(req.params.gameId),
        parseUuid(req.params.consolidationId),
        summary,
      ),
    );
  });
  router.delete('/games/:gameId/consolidations/:consolidationId', (req, res) => {
    dependencies.advanced.deleteConsolidation(
      parseUuid(req.params.gameId),
      parseUuid(req.params.consolidationId),
    );
    res.status(204).end();
  });

  router.get('/games/:gameId/world/regions', (req, res) => {
    res.json(dependencies.advanced.listRegions(parseUuid(req.params.gameId)));
  });
  router.patch('/games/:gameId/world/regions/:regionId', (req, res) => {
    const input = updateGameRegionInputSchema.parse(req.body);
    res.json(
      dependencies.advanced.updateRegion(
        parseUuid(req.params.gameId),
        z.string().min(1).max(160).parse(req.params.regionId),
        {
          ...(input.ownerNationCode !== undefined
            ? { ownerNationCode: input.ownerNationCode }
            : {}),
          ...(input.regionType !== undefined ? { regionType: input.regionType } : {}),
        },
      ),
    );
  });
  router.get('/games/:gameId/world/features', (req, res) => {
    res.json(dependencies.advanced.listMapFeatures(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/world/features', (req, res) => {
    res
      .status(201)
      .json(
        dependencies.advanced.createMapFeature(
          parseUuid(req.params.gameId),
          createMapFeatureInputSchema.parse(req.body),
        ),
      );
  });
  router.patch('/games/:gameId/world/features/:featureId', (req, res) => {
    res.json(
      dependencies.advanced.updateMapFeature(
        parseUuid(req.params.gameId),
        parseUuid(req.params.featureId),
        updateMapFeatureInputSchema.parse(req.body),
      ),
    );
  });
  router.delete('/games/:gameId/world/features/:featureId', (req, res) => {
    dependencies.advanced.deleteMapFeature(
      parseUuid(req.params.gameId),
      parseUuid(req.params.featureId),
    );
    res.status(204).end();
  });
  router.get('/games/:gameId/world/history', (req, res) => {
    res.json(dependencies.advanced.listWorldMutations(parseUuid(req.params.gameId)));
  });

  router.get('/presets', (_req, res) => {
    res.json(dependencies.advanced.listPresets());
  });
  router.post('/presets', (req, res) => {
    res
      .status(201)
      .json(dependencies.advanced.createPreset(createPresetInputSchema.parse(req.body)));
  });
  router.get('/presets/:presetId', (req, res) => {
    res.json(dependencies.advanced.getPreset(parseUuid(req.params.presetId)));
  });
  router.patch('/presets/:presetId', (req, res) => {
    res.json(
      dependencies.advanced.updatePreset(
        parseUuid(req.params.presetId),
        updatePresetInputSchema.parse(req.body),
      ),
    );
  });
  router.post('/presets/:presetId/publish', (req, res) => {
    res.json(dependencies.advanced.publishPreset(parseUuid(req.params.presetId)));
  });
  router.post('/presets/:presetId/duplicate', (req, res) => {
    res.status(201).json(dependencies.advanced.duplicatePreset(parseUuid(req.params.presetId)));
  });
  router.post('/presets/:presetId/archive', (req, res) => {
    dependencies.advanced.archivePreset(parseUuid(req.params.presetId));
    res.status(204).end();
  });
  router.get('/presets/:presetId/export', (req, res) => {
    res.json(dependencies.advanced.getPreset(parseUuid(req.params.presetId)));
  });
  router.post('/presets/import', (req, res) => {
    const imported = createPresetInputSchema.parse(req.body);
    res.status(201).json(dependencies.advanced.createPreset(imported));
  });
  router.get('/presets/:presetId/preview', (req, res) => {
    const gameId = req.query.gameId === undefined ? undefined : parseUuid(req.query.gameId);
    res.json(dependencies.advanced.previewPreset(parseUuid(req.params.presetId), gameId));
  });
  router.post('/presets/:presetId/play', (req, res) => {
    const preset = dependencies.advanced.getPreset(parseUuid(req.params.presetId));
    const nationCode = nationCodeSchema.parse(req.body?.nationCode);
    if (!preset.playableNationCodes.includes(nationCode)) {
      throw new AppError(400, 'NATION_NOT_PLAYABLE', 'The nation is not playable in this preset.');
    }
    const game = dependencies.repository.createGame(
      createGameInputSchema.parse({
        nationCode,
        startDate: preset.startDate,
        name: req.body?.name,
        difficulty: req.body?.difficulty ?? preset.recommendedDifficulty,
        presetId: preset.id,
        scenario: { mode: 'custom', premise: preset.worldContext },
      }),
      requestLanguage(req),
    );
    res
      .status(201)
      .json(
        dependencies.repository.updateGameConfig(
          game.id,
          { simulationRules: preset.simulationRules, aiModels: preset.aiModels },
          requestLanguage(req),
        ),
      );
  });

  router.get('/llm/settings', (req, res) => {
    res.json(dependencies.repository.getLlmSettings(isLoopback(req.socket.remoteAddress)));
  });
  router.patch('/llm/settings', localOnly, (req, res) => {
    dependencies.repository.saveLlmSettings(llmSettingsInputSchema.parse(req.body));
    res.json(dependencies.repository.getLlmSettings(true));
  });
  router.post('/llm/settings/test', localOnly, llmLimiter, async (req, res) => {
    const input = llmSettingsInputSchema.parse(req.body);
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

  return router;
}
