import { z } from 'zod';
import {
  boundedTextSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nationCodeSchema,
  uuidSchema,
} from './common.js';
import { eventMapCueSchema, eventSeveritySchema, eventTypeSchema } from './events.js';

export const chatSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  targetNationCode: nationCodeSchema,
  targetNationName: z.string(),
  participants: z.array(z.object({ nationCode: nationCodeSchema, nationName: z.string().min(1) })),
  nextSpeakerNationCode: nationCodeSchema.nullable(),
  status: z.enum(['active', 'closed']),
  createdAt: isoDateTimeSchema,
});
export type Chat = z.infer<typeof chatSchema>;

export const createChatInputSchema = z
  .object({
    targetNationCode: nationCodeSchema.optional(),
    participantNationCodes: z.array(nationCodeSchema).min(1).max(8).optional(),
  })
  .refine(
    (value) => Boolean(value.targetNationCode || value.participantNationCodes?.length),
    'At least one participant is required',
  );

export const chatMessageSchema = z.object({
  id: uuidSchema,
  chatId: uuidSchema,
  senderNation: nationCodeSchema,
  senderName: z.string(),
  leaderName: z.string(),
  messageText: boundedTextSchema,
  gameDate: isoDateSchema,
  createdAt: isoDateTimeSchema,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const createChatMessageInputSchema = z.object({
  messageText: boundedTextSchema,
});

export const advisorInputSchema = z.object({
  question: boundedTextSchema,
});
export const advisorMessageSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  role: z.enum(['user', 'advisor']),
  messageText: boundedTextSchema,
  createdAt: isoDateTimeSchema,
});
export type AdvisorMessage = z.infer<typeof advisorMessageSchema>;

export const gameSnapshotSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  turnNumber: z.number().int().positive(),
  gameDate: isoDateSchema,
  label: z.string().min(1).max(120),
  createdAt: isoDateTimeSchema,
});
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;

export const consolidationSettingsSchema = z.object({
  startRound: z.number().int().min(2).max(200),
  chunkSize: z.number().int().min(2).max(50),
});
export type ConsolidationSettings = z.infer<typeof consolidationSettingsSchema>;
export const consolidationSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  startTurn: z.number().int().positive(),
  endTurn: z.number().int().positive(),
  summary: z.string().min(1).max(20_000),
  status: z.enum(['current', 'stale']),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Consolidation = z.infer<typeof consolidationSchema>;
export const updateConsolidationInputSchema = z.object({
  summary: z.string().trim().min(1).max(20_000),
});
export const updateEventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().min(1).max(4_000).optional(),
    event_type: eventTypeSchema.optional(),
    severity: eventSeveritySchema.optional(),
    map_cue: eventMapCueSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one event field is required');
