import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, nationCodeSchema, uuidSchema } from './common.js';

export const eventTypeSchema = z.enum([
  'military',
  'political',
  'economic',
  'diplomatic',
  'social',
]);
export const eventSeveritySchema = z.enum(['minor', 'moderate', 'major', 'critical']);

export const nationChangeSchema = z.object({
  stability: z.number().min(-100).max(100).optional(),
  war_support: z.number().min(-100).max(100).optional(),
  treasury: z.number().min(-1_000_000).max(1_000_000).optional(),
  manpower: z.number().min(-1_000_000_000).max(1_000_000_000).optional(),
  political_power: z.number().min(-10_000).max(10_000).optional(),
  population_percent: z.number().min(-100).max(100).optional(),
  gdp_percent: z.number().min(-100).max(500).optional(),
  happiness: z.number().min(-100).max(100).optional(),
  literacy: z.number().min(-100).max(100).optional(),
  unemployment: z.number().min(-100).max(100).optional(),
  inflation: z.number().min(-200).max(200).optional(),
  industrial_capacity: z.number().min(-100).max(100).optional(),
  health: z.number().min(-100).max(100).optional(),
  food_security: z.number().min(-100).max(100).optional(),
  at_war: z.boolean().optional(),
  occupied_regions: z.array(z.string().max(160)).max(100).optional(),
});
export const stateChangesSchema = z.record(nationCodeSchema, nationChangeSchema);

export const countryLawCategorySchema = z.enum([
  'constitution',
  'economy',
  'labor',
  'security',
  'military',
  'social',
  'trade',
  'other',
]);
export const countryLawStatusSchema = z.enum(['active', 'repealed']);
export const countryLawSourceSchema = z.enum(['historical', 'player', 'simulation']);
export const generatedLawChangeSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('enact'),
    nation_code: nationCodeSchema,
    title_fr: z.string().trim().min(1).max(180),
    title_en: z.string().trim().min(1).max(180),
    summary_fr: z.string().trim().min(1).max(800),
    summary_en: z.string().trim().min(1).max(800),
    category: countryLawCategorySchema,
  }),
  z.object({
    operation: z.literal('repeal'),
    nation_code: nationCodeSchema,
    law_id: uuidSchema,
  }),
]);
export type GeneratedLawChange = z.infer<typeof generatedLawChangeSchema>;

export const eventLocationRoleSchema = z.enum(['primary', 'secondary']);
export type EventLocationRole = z.infer<typeof eventLocationRoleSchema>;

const eventLocationBaseSchema = z.object({
  role: eventLocationRoleSchema.default('primary'),
  label: z.string().trim().min(1).max(120).optional(),
});

export const eventLocationSchema = z.discriminatedUnion('kind', [
  eventLocationBaseSchema.extend({
    kind: z.literal('region'),
    region_id: z.string().trim().min(1).max(160),
  }),
  eventLocationBaseSchema.extend({
    kind: z.literal('feature'),
    feature_id: uuidSchema,
  }),
  eventLocationBaseSchema.extend({
    kind: z.literal('unit'),
    unit_id: uuidSchema,
  }),
  eventLocationBaseSchema.extend({
    kind: z.literal('nation'),
    nation_code: nationCodeSchema,
  }),
  eventLocationBaseSchema.extend({
    kind: z.literal('coordinates'),
    coordinates: z.tuple([z.number().min(0).max(1400.16), z.number().min(0).max(600)]),
  }),
  eventLocationBaseSchema.extend({
    kind: z.literal('global'),
  }),
]);
export type EventLocation = z.infer<typeof eventLocationSchema>;

export const eventMapCueSchema = z.object({
  locations: z.array(eventLocationSchema).max(8).default([]),
  camera: z.enum(['auto', 'point', 'bounds', 'nation', 'world']).default('auto'),
});
export type EventMapCue = z.infer<typeof eventMapCueSchema>;

export const strategicEventImpactKindSchema = z.enum([
  'conventional_strike',
  'nuclear_strike',
  'fire',
  'epidemic',
  'famine',
  'natural_disaster',
  'industrial_disaster',
]);
export const strategicEventEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('nuclear_strike'),
    intensity: z.number().min(1).max(100),
    target_region_id: z.string().trim().min(1).max(160),
    source_nation_code: nationCodeSchema,
    vector: z.enum(['bomber', 'ballistic_missile', 'submarine_missile', 'editor']),
    editor_override: z.boolean().default(false),
  }),
  z.object({
    kind: strategicEventImpactKindSchema.exclude(['nuclear_strike']),
    intensity: z.number().min(1).max(100),
    target_region_id: z.string().trim().min(1).max(160),
  }),
]);
export type StrategicEventEffect = z.infer<typeof strategicEventEffectSchema>;

export const generatedEventSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(4_000),
  event_type: eventTypeSchema,
  severity: eventSeveritySchema,
  affected_nations: z.array(nationCodeSchema).max(20).default([]),
  state_changes: stateChangesSchema.default({}),
  map_cue: eventMapCueSchema.default({ locations: [], camera: 'auto' }),
  subtype: z.string().trim().min(1).max(80).optional(),
  icon_key: z.string().trim().min(1).max(80).optional(),
  strategic_effect: strategicEventEffectSchema.optional(),
});
export type GeneratedEvent = z.infer<typeof generatedEventSchema>;

export const regionTypeSchema = z.enum(['land', 'coastal', 'ocean', 'strait']);
export type RegionType = z.infer<typeof regionTypeSchema>;
export const regionChangeSchema = z.object({
  region_id: z.string().trim().min(1).max(160),
  owner_nation_code: nationCodeSchema.nullable().optional(),
  controller_nation_code: nationCodeSchema.nullable().optional(),
  claim_nation_codes: z.array(nationCodeSchema).max(100).optional(),
  region_type: regionTypeSchema.optional(),
});
export type RegionChange = z.infer<typeof regionChangeSchema>;

export const generatedUnitChangeSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    name: z.string().trim().min(1).max(120),
    unit_type: z.enum(['infantry', 'armor', 'naval', 'air', 'artillery']),
    nation_code: nationCodeSchema,
    region_id: z.string().trim().min(1).max(160),
    strength: z.number().min(0).max(100).default(100),
    organization: z.number().min(0).max(100).default(100),
  }),
  z.object({
    operation: z.literal('move'),
    unit_id: uuidSchema,
    region_id: z.string().trim().min(1).max(160),
  }),
  z.object({
    operation: z.literal('update'),
    unit_id: uuidSchema,
    strength: z.number().min(0).max(100).optional(),
    organization: z.number().min(0).max(100).optional(),
    experience: z.number().min(0).max(100).optional(),
  }),
  z.object({ operation: z.literal('delete'), unit_id: uuidSchema }),
]);
export type GeneratedUnitChange = z.infer<typeof generatedUnitChangeSchema>;

export const mapFeatureTypeSchema = z.enum(['city', 'capital', 'battalion', 'custom']);
export type MapFeatureType = z.infer<typeof mapFeatureTypeSchema>;
export const generatedMapFeatureChangeSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    name: z.string().trim().min(1).max(120),
    feature_type: mapFeatureTypeSchema,
    region_id: z.string().trim().min(1).max(160),
    nation_code: nationCodeSchema.nullable().default(null),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#f5c451'),
    symbol: z.string().trim().min(1).max(8).default('•'),
  }),
  z.object({
    operation: z.literal('update'),
    feature_id: uuidSchema,
    name: z.string().trim().min(1).max(120).optional(),
    region_id: z.string().trim().min(1).max(160).optional(),
    nation_code: nationCodeSchema.nullable().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    symbol: z.string().trim().min(1).max(8).optional(),
  }),
  z.object({ operation: z.literal('delete'), feature_id: uuidSchema }),
]);
export type GeneratedMapFeatureChange = z.infer<typeof generatedMapFeatureChangeSchema>;

export const characterStatusSchema = z.enum(['active', 'wounded', 'captured', 'missing', 'dead']);
export const generatedCharacterChangeSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    name: z.string().trim().min(1).max(160),
    role: z.string().trim().min(1).max(120),
    nation_code: nationCodeSchema.nullable(),
    loyalty_nation_code: nationCodeSchema.nullable().optional(),
    region_id: z.string().trim().min(1).max(160),
  }),
  z.object({
    operation: z.literal('update'),
    character_id: uuidSchema,
    role: z.string().trim().min(1).max(120).optional(),
    status: characterStatusSchema.optional(),
    region_id: z.string().trim().min(1).max(160).optional(),
    destination_region_id: z.string().trim().min(1).max(160).nullable().optional(),
  }),
]);
export type GeneratedCharacterChange = z.infer<typeof generatedCharacterChangeSchema>;

export const generatedTurnSchema = z.object({
  time_advance_amount: z.number().int().positive().max(365).optional(),
  resolved_imposed_action_ids: z.array(uuidSchema).max(100).default([]),
  events: z.array(generatedEventSchema).max(6),
  law_changes: z.array(generatedLawChangeSchema).max(20).default([]),
  region_changes: z.array(regionChangeSchema).max(100).default([]),
  unit_changes: z.array(generatedUnitChangeSchema).max(100).default([]),
  map_feature_changes: z.array(generatedMapFeatureChangeSchema).max(100).default([]),
  character_changes: z.array(generatedCharacterChangeSchema).max(50).default([]),
});
export type GeneratedTurn = z.infer<typeof generatedTurnSchema>;

export const gameEventSchema = generatedEventSchema.extend({
  id: uuidSchema,
  gameId: uuidSchema,
  gameDate: isoDateSchema,
  createdAt: isoDateTimeSchema,
  turnNumber: z.number().int().positive(),
});
export type GameEvent = z.infer<typeof gameEventSchema>;
