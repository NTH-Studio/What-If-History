import type { Router } from 'express';
import {
  createChatInputSchema,
  createChatMessageInputSchema,
  nationCodeSchema,
} from '@what-if-history/contracts';
import { AppError } from '../errors.js';
import {
  parseUuid,
  requestClientId,
  requestId,
  requestLanguage,
  type ApiRouteContext,
} from './context.js';

export function registerDiplomacyRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies, llmLimiter } = context;
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
}
