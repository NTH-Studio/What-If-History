import { z } from 'zod';
import { boundedTextSchema, isoDateTimeSchema, nationCodeSchema, uuidSchema } from './common.js';

export const territoryEffectOperationSchema = z.enum([
  'cede',
  'annex',
  'occupy',
  'liberate',
  'add_claim',
  'remove_claim',
]);
export type TerritoryEffectOperation = z.infer<typeof territoryEffectOperationSchema>;

const territoryWorldEffectSchema = z.object({
  kind: z.literal('territory'),
  operation: territoryEffectOperationSchema,
  regionId: z.string().trim().min(1).max(160),
  nationCode: nationCodeSchema,
});

const unitWorldEffectSchema = z.discriminatedUnion('operation', [
  z.object({
    kind: z.literal('unit'),
    operation: z.literal('create'),
    name: z.string().trim().min(1).max(120),
    unitType: z.enum(['infantry', 'armor', 'naval', 'air', 'artillery']),
    nationCode: nationCodeSchema,
    regionId: z.string().trim().min(1).max(160),
    strength: z.number().min(0).max(100).default(100),
    organization: z.number().min(0).max(100).default(100),
  }),
  z.object({
    kind: z.literal('unit'),
    operation: z.literal('move'),
    unitId: uuidSchema,
    regionId: z.string().trim().min(1).max(160),
  }),
  z.object({
    kind: z.literal('unit'),
    operation: z.literal('update'),
    unitId: uuidSchema,
    strength: z.number().min(0).max(100).optional(),
    organization: z.number().min(0).max(100).optional(),
    experience: z.number().min(0).max(100).optional(),
  }),
  z.object({ kind: z.literal('unit'), operation: z.literal('delete'), unitId: uuidSchema }),
]);

const featureWorldEffectSchema = z.discriminatedUnion('operation', [
  z.object({
    kind: z.literal('feature'),
    operation: z.literal('create'),
    name: z.string().trim().min(1).max(120),
    featureType: z.enum(['city', 'capital', 'battalion', 'custom']),
    regionId: z.string().trim().min(1).max(160),
    nationCode: nationCodeSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('feature'),
    operation: z.literal('update'),
    featureId: uuidSchema,
    name: z.string().trim().min(1).max(120).optional(),
    regionId: z.string().trim().min(1).max(160).optional(),
    nationCode: nationCodeSchema.nullable().optional(),
  }),
  z.object({ kind: z.literal('feature'), operation: z.literal('delete'), featureId: uuidSchema }),
]);

const lawWorldEffectSchema = z.discriminatedUnion('operation', [
  z.object({
    kind: z.literal('law'),
    operation: z.literal('enact'),
    nationCode: nationCodeSchema,
    title: z.string().trim().min(1).max(180),
    summary: z.string().trim().max(800).default(''),
    category: z
      .enum([
        'constitution',
        'economy',
        'labor',
        'security',
        'military',
        'social',
        'trade',
        'other',
      ])
      .default('other'),
  }),
  z.object({
    kind: z.literal('law'),
    operation: z.literal('repeal'),
    nationCode: nationCodeSchema,
    lawId: uuidSchema,
  }),
]);

const capitalWorldEffectSchema = z.object({
  kind: z.literal('capital'),
  operation: z.literal('set'),
  nationCode: nationCodeSchema,
  featureId: uuidSchema.nullable(),
});

const nationWorldEffectSchema = z.object({
  kind: z.literal('nation'),
  operation: z.literal('adjust'),
  nationCode: nationCodeSchema,
  changes: z.record(z.string(), z.union([z.number(), z.boolean(), z.array(z.string())])),
});

export const worldEffectSchema = z.union([
  territoryWorldEffectSchema,
  unitWorldEffectSchema,
  featureWorldEffectSchema,
  lawWorldEffectSchema,
  capitalWorldEffectSchema,
  nationWorldEffectSchema,
]);
export type WorldEffect = z.infer<typeof worldEffectSchema>;

export const actionModeSchema = z.enum(['planned', 'imposed']);
export type ActionMode = z.infer<typeof actionModeSchema>;

export const actionEffectStatusSchema = z.enum([
  'draft',
  'resolved',
  'queued',
  'applied',
  'failed',
]);
export type ActionEffectStatus = z.infer<typeof actionEffectStatusSchema>;

export const actionPreviewInputSchema = z.object({
  actionText: boundedTextSchema,
  context: z
    .object({
      regionId: z.string().trim().min(1).max(160).optional(),
      nationCode: nationCodeSchema.optional(),
      featureId: uuidSchema.optional(),
      unitId: uuidSchema.optional(),
    })
    .optional(),
});
export type ActionPreviewInput = z.infer<typeof actionPreviewInputSchema>;

export const actionPreviewSchema = z.object({
  actionText: boundedTextSchema,
  effects: z.array(worldEffectSchema).max(100),
  ambiguities: z.array(
    z.object({
      field: z.enum(['region', 'nation', 'feature', 'unit', 'operation']),
      value: z.string(),
      candidates: z.array(z.object({ id: z.string(), label: z.string() })).max(20),
    }),
  ),
  warnings: z.array(z.string().max(500)).max(20),
  worldRevision: z.number().int().nonnegative(),
});
export type ActionPreview = z.infer<typeof actionPreviewSchema>;

export const actionSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  nationCode: nationCodeSchema,
  actionText: boundedTextSchema,
  actionType: z.enum(['general', 'diplomatic', 'military', 'economic', 'law']),
  status: z.enum(['pending', 'rejected', 'completed']),
  aiResponse: z.string().nullable(),
  turnNumber: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  mode: actionModeSchema.default('planned'),
  effects: z.array(worldEffectSchema).max(100).default([]),
  effectStatus: actionEffectStatusSchema.default('queued'),
  previewWorldRevision: z.number().int().nonnegative().nullable().default(null),
});
export type Action = z.infer<typeof actionSchema>;

export const createActionInputSchema = z.object({
  actionText: boundedTextSchema,
  mode: actionModeSchema.default('planned'),
  effects: z.array(worldEffectSchema).max(100).optional(),
  previewWorldRevision: z.number().int().nonnegative().optional(),
});
export type CreateActionInput = z.infer<typeof createActionInputSchema>;
export const updateActionInputSchema = createActionInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one action field is required');
export type UpdateActionInput = z.infer<typeof updateActionInputSchema>;
export const enhanceActionInputSchema = z.object({ actionText: boundedTextSchema });
