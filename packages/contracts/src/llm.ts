import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, timeJumpSchema, uuidSchema } from './common.js';
import { gameEventSchema } from './events.js';

export const llmProviderSchema = z.enum([
  'lm-studio',
  'llama.cpp',
  'ollama',
  'vllm',
  'openai',
  'google',
  'anthropic',
  'fake',
]);
export type LlmProviderName = z.infer<typeof llmProviderSchema>;

export const httpUrlSchema = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'HTTP(S) URL required')
  .refine(
    (value) => !new URL(value).username && !new URL(value).password,
    'URL credentials forbidden',
  );

export const llmSettingsInputSchema = z.object({
  provider: llmProviderSchema,
  apiUrl: httpUrlSchema,
  apiKey: z.string().max(1_000).optional(),
  model: z.string().trim().min(1).max(200),
  clearApiKey: z.boolean().default(false),
});
export type LlmSettingsInput = z.infer<typeof llmSettingsInputSchema>;

export const structuredOutputModeSchema = z.enum([
  'native_json_schema',
  'json_mode',
  'server_validation',
]);
export type StructuredOutputMode = z.infer<typeof structuredOutputModeSchema>;

export const llmSettingsPublicSchema = z.object({
  provider: llmProviderSchema,
  apiUrl: httpUrlSchema,
  model: z.string(),
  hasApiKey: z.boolean(),
  editable: z.boolean(),
  structuredOutputMode: structuredOutputModeSchema,
});
export type LlmSettingsPublic = z.infer<typeof llmSettingsPublicSchema>;

export const llmCallTypeSchema = z.enum([
  'action_validation',
  'action_brainstorm',
  'action_enhance',
  'advisor',
  'diplomacy_reply',
  'next_speaker',
  'consolidation',
  'turn_generation',
  'connection_test',
]);
export type LlmCallType = z.infer<typeof llmCallTypeSchema>;

export const llmCallPhaseSchema = z.enum([
  'preparing',
  'waiting_provider',
  'validating_response',
  'applying_result',
]);
export type LlmCallPhase = z.infer<typeof llmCallPhaseSchema>;

export const llmCallStatusSchema = z.enum(['running', 'succeeded', 'failed']);
export type LlmCallStatus = z.infer<typeof llmCallStatusSchema>;

export const llmTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type LlmTokenUsage = z.infer<typeof llmTokenUsageSchema>;

export const llmActivitySchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema.nullable(),
  gameName: z.string().max(100).nullable(),
  requestId: z.string().min(1).max(200),
  type: llmCallTypeSchema,
  provider: llmProviderSchema,
  model: z.string().max(200),
  phase: llmCallPhaseSchema,
  status: llmCallStatusSchema,
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  usage: llmTokenUsageSchema.nullable(),
  errorCode: z.string().max(100).nullable(),
  initiatedHere: z.boolean(),
});
export type LlmActivity = z.infer<typeof llmActivitySchema>;

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string(),
  requestId: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const turnRunStatusSchema = z.enum([
  'preparing',
  'generating',
  'applying',
  'completed',
  'failed',
]);
export type TurnRunStatus = z.infer<typeof turnRunStatusSchema>;

export const turnRunSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  turnNumber: z.number().int().positive(),
  strategy: z.enum(['fixed', 'next_major_event']),
  jump: timeJumpSchema,
  status: turnRunStatusSchema,
  snapshotId: uuidSchema.nullable(),
  errorCode: z.string().max(100).nullable(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});
export type TurnRun = z.infer<typeof turnRunSchema>;

export const appliedMutationSchema = z.object({
  id: uuidSchema,
  turnNumber: z.number().int().positive(),
  source: z.enum(['player_action', 'simulation', 'manual']),
  sourceActionId: uuidSchema.nullable(),
  sourceEventId: uuidSchema.nullable(),
  mutationType: z.enum(['region', 'unit', 'feature', 'law', 'capital', 'nation']),
  targetId: z.string().min(1),
  beforeValue: z.unknown().nullable(),
  afterValue: z.unknown().nullable(),
  worldRevision: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
});
export type AppliedMutation = z.infer<typeof appliedMutationSchema>;

export const turnResultSchema = z.object({
  previousDate: isoDateSchema,
  newDate: isoDateSchema,
  turnNumber: z.number().int().positive(),
  events: z.array(gameEventSchema),
  processedActions: z.number().int().nonnegative(),
  worldRevision: z.number().int().nonnegative(),
  appliedMutations: z.array(appliedMutationSchema),
});
export type TurnResult = z.infer<typeof turnResultSchema>;
