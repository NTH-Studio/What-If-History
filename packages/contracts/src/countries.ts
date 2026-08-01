import { z } from 'zod';
import { isoDateSchema, nationCodeSchema, nationStateSchema, uuidSchema } from './common.js';
import {
  countryLawCategorySchema,
  countryLawSourceSchema,
  countryLawStatusSchema,
  gameEventSchema,
} from './events.js';

export const countryIndicatorsSchema = nationStateSchema
  .omit({
    nationCode: true,
    occupiedRegions: true,
    populationGrowthRate: true,
    gdpGrowthRate: true,
    capitalFeatureId: true,
    capitalStatus: true,
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

export const historicalOfficeRoleSchema = z.enum(['head_of_state', 'head_of_government']);
export type HistoricalOfficeRole = z.infer<typeof historicalOfficeRoleSchema>;

export const officeHolderSchema = z.object({
  id: z.string().min(1).max(200),
  nationCode: nationCodeSchema,
  role: historicalOfficeRoleSchema,
  title: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  termStart: isoDateSchema,
  termEnd: isoDateSchema.nullable(),
  source: z.enum(['wikidata', 'curated', 'simulation']),
  primary: z.boolean(),
});
export type OfficeHolder = z.infer<typeof officeHolderSchema>;

export const historicalContinuitySchema = z.object({
  entityType: z.enum(['polity', 'office', 'capital', 'region']),
  entityId: z.string().min(1).max(200),
  status: z.enum(['historical', 'diverged']),
  divergedAt: isoDateSchema.nullable(),
  reason: z.string().max(500).nullable(),
});
export type HistoricalContinuity = z.infer<typeof historicalContinuitySchema>;

export const historicalPolitySchema = z.object({
  code: nationCodeSchema,
  name: z.string().min(1),
  capital: z.string().nullable(),
  capitalRegionId: z.string().min(1).nullable(),
  ideology: z.string().min(1),
  governmentType: z.string().min(1),
  isMajorPower: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  activeFrom: isoDateSchema,
  activeTo: isoDateSchema.nullable(),
  officeHolders: z.array(officeHolderSchema).max(2),
  dataQuality: z.enum(['historical', 'estimated']),
});
export type HistoricalPolity = z.infer<typeof historicalPolitySchema>;

export const historicalTransitionSchema = z.object({
  id: z.string().min(1).max(200),
  effectiveDate: isoDateSchema,
  kind: z.enum(['office', 'territory', 'polity', 'capital']),
  entityIds: z.array(z.string().min(1)).min(1),
  expectedBefore: z.record(z.string(), z.string().nullable()),
  changes: z.record(z.string(), z.string().nullable()),
  title: z.string().min(1).max(180),
  description: z.string().max(1_000),
});
export type HistoricalTransition = z.infer<typeof historicalTransitionSchema>;

export const historicalWorldPreviewSchema = z.object({
  date: isoDateSchema,
  coverageStart: isoDateSchema,
  coverageEnd: isoDateSchema,
  catalogVersion: z.number().int().positive(),
  territorialPrecision: z.literal('strategic_regions'),
  nations: z.array(historicalPolitySchema),
  warnings: z.array(z.string().max(500)),
});
export type HistoricalWorldPreview = z.infer<typeof historicalWorldPreviewSchema>;

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
  ownedRegionCount: z.number().int().nonnegative().default(0),
  controlledRegionCount: z.number().int().nonnegative().default(0),
  claimedRegionCount: z.number().int().nonnegative().default(0),
  capitalStatus: z.enum(['established', 'occupied', 'lost']).default('established'),
  officeHolders: z.array(officeHolderSchema).max(2).default([]),
  historicalContinuity: z
    .enum(['historical', 'diverged', 'legacy_static'])
    .default('legacy_static'),
});
export type CountrySummary = z.infer<typeof countrySummarySchema>;

export const countryProfileSchema = countrySummarySchema.extend({
  leaderTitle: z.string().nullable(),
  militaryStrength: z.number().min(0).max(100),
  occupiedRegions: z.array(z.string()),
  laws: z.array(countryLawSchema),
  recentEvents: z.array(gameEventSchema),
  unitCount: z.number().int().nonnegative(),
  dataQuality: z.enum(['historical', 'estimated']),
  baselineDate: isoDateSchema,
});
export type CountryProfile = z.infer<typeof countryProfileSchema>;
