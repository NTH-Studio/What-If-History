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
  capitalFeatureId: uuidSchema.nullable().default(null),
  capitalStatus: z.enum(['established', 'occupied', 'lost']).default('established'),
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
  worldRevision: z.number().int().nonnegative().default(0),
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
