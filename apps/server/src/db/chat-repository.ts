import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Chat, ChatMessage } from '@what-if-history/contracts';
import type { Catalog } from '../catalog.js';
import { AppError, notFound } from '../errors.js';
import { asString, now, type Row } from './values.js';

export class ChatRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly catalog: Catalog,
  ) {}

  createChat(gameId: string, participantNationCodes: string[]): Chat {
    this.assertGame(gameId);
    const uniqueCodes = [...new Set(participantNationCodes)];
    const nations = uniqueCodes.map((code) => this.catalog.nations.get(code));
    if (!nations.length || nations.some((nation) => !nation)) {
      throw new AppError(400, 'UNKNOWN_NATION', 'A target nation does not exist.');
    }
    const targetNationCode = uniqueCodes[0]!;
    const nation = nations[0]!;
    const chat: Chat = {
      id: randomUUID(),
      gameId,
      targetNationCode,
      targetNationName: nation.name,
      participants: nations.map((participant) => ({
        nationCode: participant!.code,
        nationName: participant!.name,
      })),
      nextSpeakerNationCode: targetNationCode,
      status: 'active',
      createdAt: now(),
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO chats (
            id, game_id, target_nation_code, next_speaker_nation_code, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chat.id,
          chat.gameId,
          chat.targetNationCode,
          chat.nextSpeakerNationCode,
          chat.status,
          chat.createdAt,
        );
      const insertParticipant = this.database.prepare(
        'INSERT INTO chat_participants (chat_id, nation_code, sort_order) VALUES (?, ?, ?)',
      );
      uniqueCodes.forEach((code, index) => insertParticipant.run(chat.id, code, index));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return chat;
  }

  setNextChatSpeaker(gameId: string, chatId: string, nationCode: string): Chat {
    const chat = this.getChat(gameId, chatId);
    if (!chat.participants.some((participant) => participant.nationCode === nationCode)) {
      throw new AppError(400, 'NOT_CHAT_PARTICIPANT', 'The nation is not part of this chat.');
    }
    this.database
      .prepare('UPDATE chats SET next_speaker_nation_code = ? WHERE id = ? AND game_id = ?')
      .run(nationCode, chatId, gameId);
    return this.getChat(gameId, chatId);
  }

  listChats(gameId: string): Chat[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM chats WHERE game_id = ? ORDER BY created_at DESC')
        .all(gameId) as Row[]
    ).map((row) => this.mapChat(row));
  }

  getChat(gameId: string, chatId: string): Chat {
    const row = this.database
      .prepare('SELECT * FROM chats WHERE id = ? AND game_id = ?')
      .get(chatId, gameId) as Row | undefined;
    if (!row) throw notFound('Chat');
    return this.mapChat(row);
  }

  listChatMessages(gameId: string, chatId: string): ChatMessage[] {
    this.getChat(gameId, chatId);
    return (
      this.database
        .prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at')
        .all(chatId) as Row[]
    ).map(this.mapChatMessage);
  }

  addChatMessage(
    chat: Chat,
    senderNation: string,
    senderName: string,
    leaderName: string,
    messageText: string,
    gameDate: string,
  ): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      chatId: chat.id,
      senderNation,
      senderName,
      leaderName,
      messageText,
      gameDate,
      createdAt: now(),
    };
    this.database
      .prepare(
        `INSERT INTO chat_messages (
          id, chat_id, sender_nation, sender_name, leader_name,
          message_text, game_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.chatId,
        message.senderNation,
        message.senderName,
        message.leaderName,
        message.messageText,
        message.gameDate,
        message.createdAt,
      );
    return message;
  }

  private mapChat = (row: Row): Chat => {
    const targetNationCode = asString(row.target_nation_code);
    const participantRows = this.database
      .prepare(
        'SELECT nation_code FROM chat_participants WHERE chat_id = ? ORDER BY sort_order, nation_code',
      )
      .all(asString(row.id)) as Row[];
    const participantCodes = participantRows.length
      ? participantRows.map((participant) => asString(participant.nation_code))
      : [targetNationCode];
    return {
      id: asString(row.id),
      gameId: asString(row.game_id),
      targetNationCode,
      targetNationName: this.catalog.nations.get(targetNationCode)?.name ?? targetNationCode,
      participants: participantCodes.map((nationCode) => ({
        nationCode,
        nationName: this.catalog.nations.get(nationCode)?.name ?? nationCode,
      })),
      nextSpeakerNationCode:
        row.next_speaker_nation_code === null || row.next_speaker_nation_code === undefined
          ? null
          : asString(row.next_speaker_nation_code),
      status: asString(row.status) as Chat['status'],
      createdAt: asString(row.created_at),
    };
  };

  private mapChatMessage = (row: Row): ChatMessage => ({
    id: asString(row.id),
    chatId: asString(row.chat_id),
    senderNation: asString(row.sender_nation),
    senderName: asString(row.sender_name),
    leaderName: asString(row.leader_name),
    messageText: asString(row.message_text),
    gameDate: asString(row.game_date),
    createdAt: asString(row.created_at),
  });

  private assertGame(gameId: string) {
    if (!this.database.prepare('SELECT 1 FROM games WHERE id = ?').get(gameId)) {
      throw notFound('Game');
    }
  }
}
