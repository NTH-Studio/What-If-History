import fs from 'node:fs';
import path from 'node:path';
import {
  mapRegionSchema,
  nationSchema,
  type CountryLaw,
  type MapRegion,
  type Nation,
} from '@what-if-history/contracts';
import { z } from 'zod';
import { AppError } from './errors.js';

const citySchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  nation_code: z.string().length(3),
  type: z.string(),
  region_id: z.string().min(1),
  coords: z.tuple([z.number().min(0).max(1400.16), z.number().min(0).max(600)]),
});

const profileTierSchema = z.object({
  gdpPerCapita: z.number().positive(),
  populationGrowthRate: z.number().min(-10).max(10),
  gdpGrowthRate: z.number().min(-50).max(50),
  literacy: z.number().min(0).max(100),
  unemployment: z.number().min(0).max(100),
  inflation: z.number().min(-20).max(200),
  industrialCapacity: z.number().min(0).max(100),
  health: z.number().min(0).max(100),
  foodSecurity: z.number().min(0).max(100),
  happiness: z.number().min(0).max(100),
});
const countryProfilesSchema = z.object({
  version: z.number().int().positive(),
  baselineDate: z.iso.date(),
  tiers: z.record(z.string(), profileTierSchema),
  nations: z.record(z.string().length(3), z.string()),
});
const geographyNamesSchema = z.object({
  nations: z.record(
    z.string().length(3),
    z.object({
      name: z.string().min(1),
      capital: z.string().min(1),
    }),
  ),
  cities: z.record(z.string().min(1), z.string().min(1)),
});

export type CatalogLanguage = 'fr' | 'en';

export interface HistoricalLawSeed {
  titleFr: string;
  titleEn: string;
  summaryFr: string;
  summaryEn: string;
  category: CountryLaw['category'];
}

export interface CountryBaseline extends z.infer<typeof profileTierSchema> {
  version: number;
  baselineDate: string;
  governmentType: string;
  population: number;
  gdp: number;
  laws: HistoricalLawSeed[];
}

const policySeeds: Record<string, HistoricalLawSeed[]> = {
  democratic: [
    {
      titleFr: 'Gouvernement constitutionnel',
      titleEn: 'Constitutional government',
      summaryFr:
        'Les institutions civiles et la représentation parlementaire encadrent le pouvoir.',
      summaryEn: 'Civil institutions and parliamentary representation frame government power.',
      category: 'constitution',
    },
    {
      titleFr: 'Code électoral et libertés civiles',
      titleEn: 'Electoral code and civil liberties',
      summaryFr: 'Les élections et les principales libertés publiques sont protégées par la loi.',
      summaryEn: 'Elections and the main civil liberties are protected by law.',
      category: 'social',
    },
  ],
  authoritarian: [
    {
      titleFr: 'Pouvoir exécutif renforcé',
      titleEn: 'Expanded executive authority',
      summaryFr: 'Le chef de l’État dispose de pouvoirs étendus sur l’administration nationale.',
      summaryEn: 'The head of state holds broad authority over the national administration.',
      category: 'constitution',
    },
    {
      titleFr: 'Réglementation de l’ordre public',
      titleEn: 'Public order regulations',
      summaryFr:
        'Les réunions, publications et organisations politiques sont étroitement encadrées.',
      summaryEn: 'Meetings, publications and political organizations are closely regulated.',
      category: 'security',
    },
  ],
  fascism: [
    {
      titleFr: 'Mobilisation nationale',
      titleEn: 'National mobilization',
      summaryFr: 'L’économie et la société sont organisées au service des objectifs de l’État.',
      summaryEn: 'The economy and society are organized in support of state objectives.',
      category: 'military',
    },
    {
      titleFr: 'Contrôle de la presse et des organisations',
      titleEn: 'Control of press and organizations',
      summaryFr: 'La presse et les organisations politiques sont soumises au contrôle du régime.',
      summaryEn: 'The press and political organizations are subject to regime control.',
      category: 'security',
    },
  ],
  communist: [
    {
      titleFr: 'Économie collectivisée',
      titleEn: 'Collectivized economy',
      summaryFr: 'La production et les secteurs stratégiques sont placés sous direction publique.',
      summaryEn: 'Production and strategic sectors are placed under public direction.',
      category: 'economy',
    },
    {
      titleFr: 'Administration du parti unique',
      titleEn: 'Single-party administration',
      summaryFr: 'Le parti dirige les institutions politiques et l’administration nationale.',
      summaryEn: 'The party directs political institutions and the national administration.',
      category: 'constitution',
    },
  ],
};

function governmentType(ideology: string) {
  if (ideology === 'democratic') return 'parliamentary_democracy';
  if (ideology === 'fascism') return 'fascist_state';
  if (ideology === 'communist') return 'communist_state';
  return 'authoritarian_regime';
}

function publicNation(nation: Nation): Nation {
  return nationSchema.parse({
    code: nation.code,
    name: nation.name,
    ideology: nation.ideology,
    is_major_power: nation.is_major_power,
    leader_name: nation.leader_name,
    leader_title: nation.leader_title,
    population: nation.population,
    manpower: nation.manpower,
    military_strength: nation.military_strength,
    color: nation.color,
    capital: nation.capital,
    has_territory: nation.has_territory,
  });
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new AppError(
      500,
      'CATALOG_INVALID',
      `Historical catalog ${path.basename(filePath)} could not be loaded: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

export class Catalog {
  readonly nations: Map<string, Nation>;
  readonly countryBaselines: Map<string, CountryBaseline>;
  readonly cities: Array<z.infer<typeof citySchema>>;
  readonly regions: { viewBox: string; width: string; height: string; regions: MapRegion[] };
  readonly roadmaps: unknown;
  readonly regionMetadata: unknown;
  private readonly frenchNames: z.infer<typeof geographyNamesSchema>;

  constructor(readonly dataDirectory: string) {
    const rawNations = z
      .record(z.string(), nationSchema)
      .parse(readJson(path.join(dataDirectory, 'nations_v2.json')));
    const rawProfiles = countryProfilesSchema.parse(
      readJson(path.join(dataDirectory, 'country_profiles_1936.json')),
    );
    this.frenchNames = geographyNamesSchema.parse(
      readJson(path.join(dataDirectory, 'geography_names_fr.json')),
    );
    const rawRegions = readJson(path.join(dataDirectory, 'hoi4_map.json'));
    const regionIds = new Set(
      z
        .object({ regions: z.array(z.object({ id: z.string().min(1) })) })
        .parse(rawRegions)
        .regions.map((region) => region.id),
    );
    this.nations = new Map(
      Object.entries(rawNations).map(([code, nation]) => [code, publicNation(nation)]),
    );
    const profileCodes = new Set(Object.keys(rawProfiles.nations));
    const missingProfiles = [...this.nations.keys()].filter((code) => !profileCodes.has(code));
    const unknownProfiles = [...profileCodes].filter((code) => !this.nations.has(code));
    if (missingProfiles.length || unknownProfiles.length) {
      throw new AppError(
        500,
        'CATALOG_INVALID',
        `Country profile coverage mismatch. Missing: ${missingProfiles.join(', ') || 'none'}; unknown: ${
          unknownProfiles.join(', ') || 'none'
        }.`,
      );
    }
    this.countryBaselines = new Map(
      [...this.nations.entries()].map(([code, nation]) => {
        const tierName = rawProfiles.nations[code]!;
        const tier = rawProfiles.tiers[tierName];
        if (!tier) {
          throw new AppError(500, 'CATALOG_INVALID', `Unknown country profile tier: ${tierName}.`);
        }
        const population = nation.population ?? 100_000;
        return [
          code,
          {
            ...tier,
            version: rawProfiles.version,
            baselineDate: rawProfiles.baselineDate,
            governmentType: governmentType(nation.ideology),
            population,
            gdp: (population * tier.gdpPerCapita) / 1_000_000,
            laws: policySeeds[nation.ideology] ?? policySeeds.authoritarian!,
          },
        ];
      }),
    );
    this.cities = z.array(citySchema).parse(readJson(path.join(dataDirectory, 'cities.json')));
    const nationTranslationCodes = new Set(Object.keys(this.frenchNames.nations));
    const missingNationTranslations = [...this.nations.keys()].filter(
      (code) => !nationTranslationCodes.has(code),
    );
    const unknownNationTranslations = [...nationTranslationCodes].filter(
      (code) => !this.nations.has(code),
    );
    const cityIds = new Set(this.cities.map((city) => String(city.id)));
    const cityTranslationIds = new Set(Object.keys(this.frenchNames.cities));
    const missingCityTranslations = [...cityIds].filter((id) => !cityTranslationIds.has(id));
    const unknownCityTranslations = [...cityTranslationIds].filter((id) => !cityIds.has(id));
    if (
      missingNationTranslations.length ||
      unknownNationTranslations.length ||
      missingCityTranslations.length ||
      unknownCityTranslations.length
    ) {
      throw new AppError(
        500,
        'CATALOG_INVALID',
        `French geography coverage mismatch. Missing nations: ${
          missingNationTranslations.join(', ') || 'none'
        }; unknown nations: ${unknownNationTranslations.join(', ') || 'none'}; missing cities: ${
          missingCityTranslations.join(', ') || 'none'
        }; unknown cities: ${unknownCityTranslations.join(', ') || 'none'}.`,
      );
    }
    const unknownNationCodes = [
      ...new Set(
        this.cities
          .map((city) => city.nation_code)
          .filter((nationCode) => !this.nations.has(nationCode)),
      ),
    ];
    if (unknownNationCodes.length > 0) {
      throw new AppError(
        500,
        'CATALOG_INVALID',
        `Cities reference unknown nation codes: ${unknownNationCodes.join(', ')}.`,
      );
    }
    const unknownRegionIds = [
      ...new Set(
        this.cities.map((city) => city.region_id).filter((regionId) => !regionIds.has(regionId)),
      ),
    ];
    if (unknownRegionIds.length > 0) {
      throw new AppError(
        500,
        'CATALOG_INVALID',
        `Cities reference unknown map regions: ${unknownRegionIds.join(', ')}.`,
      );
    }
    const parsedRegions = z
      .object({
        viewBox: z.string(),
        width: z.string(),
        height: z.string(),
        regions: z.array(mapRegionSchema),
      })
      .parse(rawRegions);
    this.regions = {
      ...parsedRegions,
      regions: parsedRegions.regions.map(({ nation_code: nationCode, ...region }) =>
        nationCode && this.nations.has(nationCode)
          ? { ...region, nation_code: nationCode }
          : region,
      ),
    };
    this.roadmaps = readJson(path.join(dataDirectory, 'historical_roadmaps.json'));
    this.regionMetadata = readJson(path.join(dataDirectory, 'region_metadata.json'));
  }

  localizeNation(nation: Nation, language: CatalogLanguage): Nation {
    if (language === 'en') return nation;
    const localized = this.frenchNames.nations[nation.code];
    if (!localized) return nation;
    return {
      ...nation,
      name: localized.name,
      capital: localized.capital,
    };
  }

  listNations(language: CatalogLanguage = 'en'): Nation[] {
    return [...this.nations.values()]
      .map((nation) => this.localizeNation(nation, language))
      .sort((left, right) => left.name.localeCompare(right.name, language));
  }

  listCities(language: CatalogLanguage = 'en') {
    if (language === 'en') return this.cities;
    return this.cities.map((city) => ({
      ...city,
      name: this.frenchNames.cities[String(city.id)] ?? city.name,
    }));
  }
}
