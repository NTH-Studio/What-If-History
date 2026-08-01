import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, nationCodeSchema, uuidSchema } from './common.js';
import {
  characterStatusSchema,
  eventLocationSchema,
  mapFeatureTypeSchema,
  regionTypeSchema,
  strategicEventImpactKindSchema,
} from './events.js';

export const mapRegionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  fill: z.string(),
  nation_code: z.string().nullable().optional(),
});
export type MapRegion = z.infer<typeof mapRegionSchema>;
export const territorialStatusSchema = z.enum(['dependent_territory', 'overseas_territory']);
export type TerritorialStatus = z.infer<typeof territorialStatusSchema>;
export const gameRegionSchema = z.object({
  gameId: uuidSchema,
  regionId: z.string().min(1),
  name: z.string().min(1),
  ownerNationCode: nationCodeSchema.nullable(),
  controllerNationCode: nationCodeSchema.nullable(),
  claimNationCodes: z.array(nationCodeSchema),
  territorialStatus: territorialStatusSchema.nullable(),
  administeringNationCode: nationCodeSchema.nullable(),
  regionType: regionTypeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GameRegion = z.infer<typeof gameRegionSchema>;

export const mapFeatureSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  name: z.string().min(1),
  featureType: mapFeatureTypeSchema,
  regionId: z.string().min(1),
  nationCode: nationCodeSchema.nullable(),
  coords: z.tuple([z.number(), z.number()]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  symbol: z.string().min(1).max(8),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MapFeature = z.infer<typeof mapFeatureSchema>;
export const createMapFeatureInputSchema = mapFeatureSchema
  .pick({
    name: true,
    featureType: true,
    regionId: true,
    nationCode: true,
    coords: true,
    color: true,
    symbol: true,
  })
  .partial({ nationCode: true, color: true, symbol: true });
export type CreateMapFeatureInput = z.infer<typeof createMapFeatureInputSchema>;
export const updateMapFeatureInputSchema = createMapFeatureInputSchema.partial();
export type UpdateMapFeatureInput = z.infer<typeof updateMapFeatureInputSchema>;
export const updateGameRegionInputSchema = z.object({
  ownerNationCode: nationCodeSchema.nullable().optional(),
  controllerNationCode: nationCodeSchema.nullable().optional(),
  claimNationCodes: z.array(nationCodeSchema).max(100).optional(),
  regionType: regionTypeSchema.optional(),
});
export type UpdateGameRegionInput = z.infer<typeof updateGameRegionInputSchema>;

export const unitSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  unitType: z.enum(['infantry', 'armor', 'naval', 'air', 'artillery']),
  nationCode: nationCodeSchema,
  regionId: z.string().trim().min(1).max(160),
  centroid: z.tuple([z.number(), z.number()]),
  strength: z.number().min(0).max(100),
  organization: z.number().min(0).max(100),
  experience: z.number().min(0).max(100),
  createdAt: isoDateTimeSchema,
});
export type Unit = z.infer<typeof unitSchema>;

export const strategicDomainSchema = z.enum(['land', 'naval', 'air']);
export type StrategicDomain = z.infer<typeof strategicDomainSchema>;
export const strategicUnitTypeSchema = z.enum([
  'infantry',
  'armor',
  'artillery',
  'naval',
  'submarine',
  'air',
  'transport',
]);
export type StrategicUnitType = z.infer<typeof strategicUnitTypeSchema>;
export const strategicMissionSchema = z.enum([
  'idle',
  'move',
  'attack',
  'defend',
  'retreat',
  'patrol',
  'intercept',
  'bombard',
  'escort',
  'landing',
  'transport',
]);
export type StrategicMission = z.infer<typeof strategicMissionSchema>;
export const intelLevelSchema = z.enum(['unknown', 'estimated', 'exact']);
export type IntelLevel = z.infer<typeof intelLevelSchema>;

export const regionStateSchema = z.object({
  gameId: uuidSchema,
  regionId: z.string().min(1).max(160),
  nationCode: nationCodeSchema.nullable(),
  population: z.number().nonnegative(),
  displacedPopulation: z.number().nonnegative(),
  woundedPopulation: z.number().nonnegative(),
  infrastructure: z.number().min(0).max(100),
  industrialCapacity: z.number().min(0).max(100),
  supply: z.number().min(0).max(100),
  health: z.number().min(0).max(100),
  habitability: z.number().min(0).max(100),
  contamination: z.number().min(0).max(100),
  radiation: z.number().min(0).max(100),
  terrain: z.enum(['plains', 'forest', 'mountain', 'desert', 'urban', 'coastal', 'ocean']),
  neighbors: z.array(z.string().min(1).max(160)),
  updatedAt: isoDateTimeSchema,
});
export type RegionState = z.infer<typeof regionStateSchema>;

export const impactKindSchema = strategicEventImpactKindSchema;
export type ImpactKind = z.infer<typeof impactKindSchema>;
export const impactZoneSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  sourceEventId: uuidSchema.nullable(),
  kind: impactKindSchema,
  label: z.string().min(1).max(180),
  coordinates: z.tuple([z.number().min(0).max(1400.16), z.number().min(0).max(600)]),
  radius: z.number().positive().max(400),
  intensity: z.number().min(0).max(100),
  radiation: z.number().min(0).max(100),
  active: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ImpactZone = z.infer<typeof impactZoneSchema>;

export const characterIconKeySchema = z.enum([
  'leader',
  'commander',
  'diplomat',
  'operative',
  'scientist',
  'civilian',
]);
export type CharacterIconKey = z.infer<typeof characterIconKeySchema>;

export const characterSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  name: z.string().min(1).max(160),
  role: z.string().min(1).max(120),
  nationCode: nationCodeSchema.nullable(),
  loyaltyNationCode: nationCodeSchema.nullable(),
  status: characterStatusSchema,
  regionId: z.string().min(1).max(160).nullable(),
  destinationRegionId: z.string().min(1).max(160).nullable(),
  coordinates: z.tuple([z.number(), z.number()]).nullable(),
  iconKey: characterIconKeySchema,
  history: z.array(z.string().max(500)).max(100),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Character = z.infer<typeof characterSchema>;

export const strategicUnitSchema = unitSchema.extend({
  unitType: strategicUnitTypeSchema,
  domain: strategicDomainSchema,
  manpower: z.number().nonnegative(),
  equipment: z.number().min(0).max(100),
  morale: z.number().min(0).max(100),
  fuel: z.number().min(0).max(100),
  supply: z.number().min(0).max(100),
  range: z.number().nonnegative(),
  doctrine: z.string().min(1).max(120),
  mission: strategicMissionSchema,
  intelLevel: intelLevelSchema,
});
export type StrategicUnit = z.infer<typeof strategicUnitSchema>;

export const movementOrderInputSchema = z.object({
  unitId: uuidSchema,
  type: strategicMissionSchema.exclude(['idle']),
  destinationRegionId: z.string().trim().min(1).max(160),
  targetUnitId: uuidSchema.optional(),
  directive: z.string().trim().max(4_000).default(''),
  idempotencyKey: uuidSchema,
  expectedWorldRevision: z.number().int().nonnegative(),
});
export type MovementOrderInput = z.infer<typeof movementOrderInputSchema>;
export const movementOrderPreviewSchema = z.object({
  valid: z.boolean(),
  unitId: uuidSchema,
  originRegionId: z.string().min(1).max(160),
  destinationRegionId: z.string().min(1).max(160),
  route: z.array(z.string().min(1).max(160)),
  durationDays: z.number().int().positive(),
  fuelCost: z.number().nonnegative(),
  supplyRisk: z.enum(['low', 'moderate', 'high', 'blocked']),
  warnings: z.array(z.string().max(500)),
  worldRevision: z.number().int().nonnegative(),
});
export type MovementOrderPreview = z.infer<typeof movementOrderPreviewSchema>;
export const movementOrderSchema = movementOrderInputSchema.extend({
  id: uuidSchema,
  gameId: uuidSchema,
  originRegionId: z.string().min(1).max(160),
  route: z.array(z.string().min(1).max(160)),
  status: z.enum(['queued', 'moving', 'intercepted', 'completed', 'cancelled']),
  progress: z.number().min(0).max(1),
  startDate: isoDateSchema,
  arrivalDate: isoDateSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MovementOrder = z.infer<typeof movementOrderSchema>;

export const warSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  name: z.string().min(1).max(180),
  attackerNationCodes: z.array(nationCodeSchema).min(1),
  defenderNationCodes: z.array(nationCodeSchema).min(1),
  status: z.enum(['active', 'armistice', 'ended']),
  startedDate: isoDateSchema,
  endedDate: isoDateSchema.nullable(),
});
export type War = z.infer<typeof warSchema>;
export const frontSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  warId: uuidSchema,
  name: z.string().min(1).max(180),
  regionIds: z.array(z.string().min(1).max(160)).min(1),
  attackerPressure: z.number().min(0).max(100),
  defenderPressure: z.number().min(0).max(100),
  supplyStatus: z.enum(['supplied', 'strained', 'cut']),
  updatedAt: isoDateTimeSchema,
});
export type Front = z.infer<typeof frontSchema>;

export const intelContactSchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  observerNationCode: nationCodeSchema,
  targetUnitId: uuidSchema,
  level: intelLevelSchema,
  estimatedRegionId: z.string().min(1).max(160).nullable(),
  estimatedStrength: z.number().min(0).max(100).nullable(),
  observedAt: isoDateTimeSchema,
});
export type IntelContact = z.infer<typeof intelContactSchema>;

export const cinematicCueSchema = z.object({
  kind: z.enum(['focus', 'movement', 'battle', 'explosion', 'fallout', 'speech', 'treaty']),
  iconKey: z.string().min(1).max(80),
  locations: z.array(eventLocationSchema).max(8).default([]),
  path: z
    .array(z.tuple([z.number(), z.number()]))
    .max(100)
    .default([]),
  intensity: z.number().min(0).max(100).default(50),
  audioCue: z.string().max(120).nullable().default(null),
});
export type CinematicCue = z.infer<typeof cinematicCueSchema>;
export const timelineEntrySchema = z.object({
  id: uuidSchema,
  gameId: uuidSchema,
  gameDate: isoDateSchema,
  turnNumber: z.number().int().positive(),
  sequence: z.number().int().nonnegative(),
  kind: z.enum([
    'event',
    'movement_started',
    'movement_progress',
    'interception',
    'battle',
    'arrival',
    'impact',
    'recovery',
    'character',
  ]),
  title: z.string().min(1).max(180),
  description: z.string().max(4_000),
  eventId: uuidSchema.nullable(),
  entityIds: z.array(z.string().min(1)).max(100),
  consequences: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  cue: cinematicCueSchema,
  createdAt: isoDateTimeSchema,
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const strategicStateSchema = z.object({
  gameId: uuidSchema,
  worldRevision: z.number().int().nonnegative(),
  currentDate: isoDateSchema,
  regions: z.array(regionStateSchema),
  impactZones: z.array(impactZoneSchema),
  characters: z.array(characterSchema),
  units: z.array(strategicUnitSchema),
  orders: z.array(movementOrderSchema),
  wars: z.array(warSchema),
  fronts: z.array(frontSchema),
  contacts: z.array(intelContactSchema),
});
export type StrategicState = z.infer<typeof strategicStateSchema>;

export const createUnitInputSchema = unitSchema
  .pick({
    name: true,
    unitType: true,
    nationCode: true,
    regionId: true,
    centroid: true,
  })
  .extend({
    strength: z.number().min(0).max(100).default(100),
    organization: z.number().min(0).max(100).default(100),
  });

export const moveUnitInputSchema = z.object({
  regionId: z.string().trim().min(1).max(160),
  centroid: z.tuple([z.number(), z.number()]),
});
