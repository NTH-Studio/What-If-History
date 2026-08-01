import { z } from 'zod';
import {
  difficultySchema,
  gameAiModelsSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nationCodeSchema,
  uuidSchema,
} from './common.js';
import { regionTypeSchema } from './events.js';

export const promptMechanicSchema = z.enum([
  'actions',
  'advisor',
  'diplomacy',
  'turns',
  'consolidation',
]);
export type PromptMechanic = z.infer<typeof promptMechanicSchema>;
export const presetStatusSchema = z.enum(['draft', 'published', 'archived']);
export const presetCategorySchema = z.enum([
  'historical',
  'alternate_history',
  'fantasy',
  'science_fiction',
  'custom',
]);
export const presetSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).max(120),
  summary: z.string().max(1_000),
  category: presetCategorySchema,
  tags: z.array(z.string().min(1).max(40)).max(20),
  startDate: isoDateSchema,
  worldContext: z.string().min(1).max(20_000),
  simulationRules: z.string().min(1).max(20_000),
  recommendedDifficulty: difficultySchema,
  playableNationCodes: z.array(nationCodeSchema).min(1).max(300),
  status: presetStatusSchema,
  currentVersion: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Preset = z.infer<typeof presetSchema>;
export const presetPromptSchema = z.object({
  mechanic: promptMechanicSchema,
  mode: z.enum(['default', 'custom']),
  template: z.string().max(40_000),
});
export type PresetPrompt = z.infer<typeof presetPromptSchema>;
export const presetHelperSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  label: z.string().min(1).max(120),
  source: z.enum(['game.date', 'game.turn', 'game.player', 'game.world', 'game.rules']),
  format: z.enum(['text', 'json']).default('text'),
});
export type PresetHelper = z.infer<typeof presetHelperSchema>;
export const presetInitialWorldSchema = z.object({
  regions: z
    .array(
      z.object({
        regionId: z.string().min(1).max(160),
        ownerNationCode: nationCodeSchema.nullable(),
        controllerNationCode: nationCodeSchema.nullable(),
        claimNationCodes: z.array(nationCodeSchema).max(100).default([]),
        regionType: regionTypeSchema.default('land'),
      }),
    )
    .max(2_000)
    .default([]),
  capitalRegionIds: z.record(nationCodeSchema, z.string().min(1).max(160).nullable()).default({}),
});
export type PresetInitialWorld = z.infer<typeof presetInitialWorldSchema>;
export const presetDetailSchema = presetSchema.extend({
  aiModels: gameAiModelsSchema,
  prompts: z.array(presetPromptSchema),
  helpers: z.array(presetHelperSchema),
  initialWorld: presetInitialWorldSchema,
});
export type PresetDetail = z.infer<typeof presetDetailSchema>;
export const createPresetInputSchema = presetDetailSchema
  .omit({
    id: true,
    status: true,
    currentVersion: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({
    summary: true,
    category: true,
    tags: true,
    recommendedDifficulty: true,
    playableNationCodes: true,
    aiModels: true,
    prompts: true,
    helpers: true,
    initialWorld: true,
  });
export type CreatePresetInput = z.infer<typeof createPresetInputSchema>;
export const updatePresetInputSchema = createPresetInputSchema.partial();
export type UpdatePresetInput = z.infer<typeof updatePresetInputSchema>;
