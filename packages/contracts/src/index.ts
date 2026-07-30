import { z } from 'zod';

export const uuidSchema = z.uuid();
export const nationCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime();
export const boundedTextSchema = z.string().trim().min(1).max(4_000);
export const scenarioModeSchema = z.enum(['historical', 'custom']);
export type ScenarioMode = z.infer<typeof scenarioModeSchema>;
export const difficultySchema = z.enum(['very_easy', 'easy', 'normal', 'hard', 'impossible']);
export type Difficulty = z.infer<typeof difficultySchema>;
export const aiMechanicSchema = z.enum(['actions', 'advisor', 'diplomacy', 'turns']);
export type AiMechanic = z.infer<typeof aiMechanicSchema>;
export const gameAiModelsSchema = z.object({
  actions: z.string().trim().min(1).max(200).nullable().default(null),
  advisor: z.string().trim().min(1).max(200).nullable().default(null),
  diplomacy: z.string().trim().min(1).max(200).nullable().default(null),
  turns: z.string().trim().min(1).max(200).nullable().default(null),
});
export type GameAiModels = z.infer<typeof gameAiModelsSchema>;

export const nationSchema = z
  .object({
    code: nationCodeSchema,
    name: z.string().min(1),
    ideology: z.string().default('neutral'),
    is_major_power: z.boolean().default(false),
    leader_name: z.string().optional(),
    leader_title: z.string().optional(),
    population: z.number().optional(),
    manpower: z.number().optional(),
    military_strength: z.number().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    capital: z.string().optional(),
    has_territory: z.boolean().optional(),
  })
  .loose();
export type Nation = z.infer<typeof nationSchema>;

export const nationStateSchema = z.object({
  nationCode: nationCodeSchema,
  stability: z.number().min(0).max(100),
  warSupport: z.number().min(0).max(100),
  manpower: z.number().nonnegative(),
  politicalPower: z.number(),
  treasury: z.number(),
  atWar: z.boolean(),
  occupiedRegions: z.array(z.string()),
  population: z.number().nonnegative(),
  gdp: z.number().nonnegative(),
  happiness: z.number().min(0).max(100),
  literacy: z.number().min(0).max(100),
  unemployment: z.number().min(0).max(100),
  inflation: z.number().min(-20).max(200),
  industrialCapacity: z.number().min(0).max(100),
  health: z.number().min(0).max(100),
  foodSecurity: z.number().min(0).max(100),
  populationGrowthRate: z.number().min(-10).max(10),
  gdpGrowthRate: z.number().min(-50).max(50),
});
export type NationState = z.infer<typeof nationStateSchema>;

export const gameSummarySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  playerNationCode: nationCodeSchema,
  playerNationName: z.string(),
  scenarioMode: scenarioModeSchema,
  difficulty: difficultySchema,
  currentDate: isoDateSchema,
  turnNumber: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GameSummary = z.infer<typeof gameSummarySchema>;

export const gameSchema = gameSummarySchema.extend({
  playerNation: nationSchema,
  nationStates: z.array(nationStateSchema),
  presetId: uuidSchema.nullable(),
  worldContext: z.string(),
  simulationRules: z.string(),
  aiModels: gameAiModelsSchema,
  pendingActionCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  unitCount: z.number().int().nonnegative(),
});
export type Game = z.infer<typeof gameSchema>;

export const createGameInputSchema = z.object({
  nationCode: nationCodeSchema,
  startDate: isoDateSchema,
  name: z.string().trim().min(1).max(100).optional(),
  difficulty: difficultySchema.optional(),
  presetId: uuidSchema.optional(),
  scenario: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('historical') }),
      z.object({
        mode: z.literal('custom'),
        premise: z.string().trim().min(1).max(4_000),
      }),
    ])
    .optional(),
});
export type CreateGameInput = z.infer<typeof createGameInputSchema>;

export const updateGameConfigInputSchema = z
  .object({
    difficulty: difficultySchema.optional(),
    simulationRules: z.string().trim().min(1).max(20_000).optional(),
    aiModels: gameAiModelsSchema.partial().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required');
export type UpdateGameConfigInput = z.infer<typeof updateGameConfigInputSchema>;

export const renameGameInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const timeJumpSchema = z.object({
  amount: z.number().int().positive().max(365),
  unit: z.enum(['day', 'week', 'month', 'year']),
  strategy: z.enum(['fixed', 'next_major_event']).optional(),
});
export type TimeJump = z.infer<typeof timeJumpSchema>;

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
});
export type Action = z.infer<typeof actionSchema>;

export const createActionInputSchema = z.object({
  actionText: boundedTextSchema,
  actionType: z.enum(['general', 'diplomatic', 'military', 'economic', 'law']).default('general'),
});
export type CreateActionInput = z.infer<typeof createActionInputSchema>;
export const updateActionInputSchema = createActionInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one action field is required');
export type UpdateActionInput = z.infer<typeof updateActionInputSchema>;
export const enhanceActionInputSchema = z.object({ actionText: boundedTextSchema });

export const promulgateLawInputSchema = z.object({
  actionText: boundedTextSchema,
});
export type PromulgateLawInput = z.infer<typeof promulgateLawInputSchema>;

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

export const generatedEventSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(4_000),
  event_type: eventTypeSchema,
  severity: eventSeveritySchema,
  affected_nations: z.array(nationCodeSchema).max(20).default([]),
  state_changes: stateChangesSchema.default({}),
  map_cue: eventMapCueSchema.default({ locations: [], camera: 'auto' }),
});
export type GeneratedEvent = z.infer<typeof generatedEventSchema>;

export const regionTypeSchema = z.enum(['land', 'coastal', 'ocean', 'strait']);
export type RegionType = z.infer<typeof regionTypeSchema>;
export const regionChangeSchema = z.object({
  region_id: z.string().trim().min(1).max(160),
  owner_nation_code: nationCodeSchema.nullable().optional(),
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

export const generatedTurnSchema = z.object({
  time_advance_amount: z.number().int().positive().max(365).optional(),
  events: z.array(generatedEventSchema).max(20),
  law_changes: z.array(generatedLawChangeSchema).max(20).default([]),
  region_changes: z.array(regionChangeSchema).max(100).default([]),
  unit_changes: z.array(generatedUnitChangeSchema).max(100).default([]),
  map_feature_changes: z.array(generatedMapFeatureChangeSchema).max(100).default([]),
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

export const countryIndicatorsSchema = nationStateSchema
  .omit({
    nationCode: true,
    occupiedRegions: true,
    populationGrowthRate: true,
    gdpGrowthRate: true,
  })
  .extend({
    gdpPerCapita: z.number().nonnegative(),
  });
export type CountryIndicators = z.infer<typeof countryIndicatorsSchema>;

export const countryLawSchema = z.object({
  id: uuidSchema,
  nationCode: nationCodeSchema,
  title: z.string().min(1),
  summary: z.string(),
  category: countryLawCategorySchema,
  enactedDate: isoDateSchema,
  status: countryLawStatusSchema,
  repealedDate: isoDateSchema.nullable(),
  source: countryLawSourceSchema,
});
export type CountryLaw = z.infer<typeof countryLawSchema>;

export const countrySummarySchema = z.object({
  code: nationCodeSchema,
  name: z.string().min(1),
  capital: z.string().nullable(),
  leaderName: z.string().nullable(),
  ideology: z.string(),
  governmentType: z.string(),
  isMajorPower: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  indicators: countryIndicatorsSchema,
  activeLawCount: z.number().int().nonnegative(),
});
export type CountrySummary = z.infer<typeof countrySummarySchema>;

export const countryProfileSchema = countrySummarySchema.extend({
  leaderTitle: z.string().nullable(),
  militaryStrength: z.number().min(0).max(100),
  occupiedRegions: z.array(z.string()),
  laws: z.array(countryLawSchema),
  recentEvents: z.array(gameEventSchema),
  unitCount: z.number().int().nonnegative(),
  dataQuality: z.literal('estimated'),
  baselineDate: isoDateSchema,
});
export type CountryProfile = z.infer<typeof countryProfileSchema>;

export const mapRegionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  fill: z.string(),
  nation_code: z.string().nullable().optional(),
});
export type MapRegion = z.infer<typeof mapRegionSchema>;
export const gameRegionSchema = z.object({
  gameId: uuidSchema,
  regionId: z.string().min(1),
  name: z.string().min(1),
  ownerNationCode: nationCodeSchema.nullable(),
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
export const presetDetailSchema = presetSchema.extend({
  aiModels: gameAiModelsSchema,
  prompts: z.array(presetPromptSchema),
  helpers: z.array(presetHelperSchema),
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
  });
export type CreatePresetInput = z.infer<typeof createPresetInputSchema>;
export const updatePresetInputSchema = createPresetInputSchema.partial();
export type UpdatePresetInput = z.infer<typeof updatePresetInputSchema>;

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

export const llmSettingsPublicSchema = z.object({
  provider: llmProviderSchema,
  apiUrl: httpUrlSchema,
  model: z.string(),
  hasApiKey: z.boolean(),
  editable: z.boolean(),
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

export const turnResultSchema = z.object({
  previousDate: isoDateSchema,
  newDate: isoDateSchema,
  turnNumber: z.number().int().positive(),
  events: z.array(gameEventSchema),
  processedActions: z.number().int().nonnegative(),
});
export type TurnResult = z.infer<typeof turnResultSchema>;
