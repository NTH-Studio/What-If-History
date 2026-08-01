import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  HistoricalPolity,
  HistoricalTransition,
  HistoricalWorldPreview,
  Nation,
  OfficeHolder,
} from '@what-if-history/contracts';
import { AppError } from './errors.js';
import type { Catalog, CatalogLanguage, CountryBaseline } from './catalog.js';

const dateSchema = z.iso.date();
const nullableDateSchema = dateSchema.nullable().optional();
const polityShape = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  nameFr: z.string().min(1),
  capital: z.string().min(1),
  capitalFr: z.string().min(1),
  capitalRegionId: z.string().min(1),
  ideology: z.string().min(1),
  governmentType: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  isMajorPower: z.boolean(),
  activeFrom: dateSchema,
  activeTo: nullableDateSchema,
  population2000: z.number().nonnegative(),
});
const periodShape = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  from: dateSchema,
  to: nullableDateSchema,
  name: z.string().min(1),
  nameFr: z.string().min(1),
  capital: z.string().min(1),
  capitalFr: z.string().min(1),
  capitalRegionId: z.string().min(1),
  ideology: z.string().min(1),
  governmentType: z.string().min(1),
});
const officeShape = z.object({
  id: z.string().min(1),
  nationCode: z.string().regex(/^[A-Z]{3}$/),
  role: z.enum(['head_of_state', 'head_of_government']),
  title: z.string().min(1),
  titleFr: z.string().min(1),
  name: z.string().min(1),
  termStart: dateSchema,
  termEnd: nullableDateSchema,
  source: z.enum(['wikidata', 'curated']),
});
const ownershipRuleShape = z.object({
  from: dateSchema,
  to: nullableDateSchema,
  replaceOwner: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  owner: z.string().regex(/^[A-Z]{3}$/),
  regions: z.array(z.string().min(1)).optional(),
});
const territoryStatusRuleShape = z.object({
  regionId: z.string().min(1),
  from: dateSchema,
  to: nullableDateSchema,
  status: z.enum(['dependent_territory', 'overseas_territory']),
  administeringNationCode: z.string().regex(/^[A-Z]{3}$/),
  claimNationCodes: z.array(z.string().regex(/^[A-Z]{3}$/)).default([]),
});
const historicalCatalogSchema = z.object({
  version: z.number().int().positive(),
  coverageStart: dateSchema,
  coverageEnd: dateSchema,
  source: z.object({ officeTerms: z.string(), territories: z.string() }),
  additionalPolities: z.array(polityShape),
  polityPeriods: z.array(periodShape),
  inactivePeriods: z.array(
    z.object({
      code: z.string().regex(/^[A-Z]{3}$/),
      from: dateSchema,
      to: nullableDateSchema,
    }),
  ),
  officeTerms: z.array(officeShape),
  regionOwnershipRules: z.array(ownershipRuleShape),
  territoryStatusRules: z.array(territoryStatusRuleShape).default([]),
  populationSnapshots: z.record(
    z.string().regex(/^[A-Z]{3}$/),
    z.record(z.string().regex(/^\d{4}$/), z.number().positive()),
  ),
});

type HistoricalCatalogData = z.infer<typeof historicalCatalogSchema>;
type PolityPeriod = z.infer<typeof periodShape>;

export interface HistoricalResolvedPolity extends HistoricalPolity {
  baseline: CountryBaseline;
  nation: Nation;
}

export interface HistoricalWorldSnapshot {
  date: string;
  catalogVersion: number;
  polities: HistoricalResolvedPolity[];
  regionOwners: Map<string, string | null>;
  regionStatuses: Map<string, HistoricalRegionStatus>;
  warnings: string[];
}

export interface HistoricalRegionStatus {
  status: 'dependent_territory' | 'overseas_territory';
  administeringNationCode: string;
  claimNationCodes: string[];
}

const MODERN_NAMES: Record<
  string,
  { en: string; fr: string; ideology?: string; government?: string }
> = {
  AFG: { en: 'Afghanistan', fr: 'Afghanistan' },
  ALB: {
    en: 'Albania',
    fr: 'Albanie',
    ideology: 'democratic',
    government: 'parliamentary_republic',
  },
  BRA: { en: 'Brazil', fr: 'Brésil', ideology: 'democratic', government: 'federal_republic' },
  BUL: {
    en: 'Bulgaria',
    fr: 'Bulgarie',
    ideology: 'democratic',
    government: 'parliamentary_republic',
  },
  EGY: { en: 'Egypt', fr: 'Égypte' },
  ETH: { en: 'Ethiopia', fr: 'Éthiopie' },
  GRE: { en: 'Greece', fr: 'Grèce', ideology: 'democratic', government: 'parliamentary_republic' },
  HOL: {
    en: 'Netherlands',
    fr: 'Pays-Bas',
    ideology: 'democratic',
    government: 'constitutional_monarchy',
  },
  HUN: {
    en: 'Hungary',
    fr: 'Hongrie',
    ideology: 'democratic',
    government: 'parliamentary_republic',
  },
  IRE: {
    en: 'Ireland',
    fr: 'Irlande',
    ideology: 'democratic',
    government: 'parliamentary_republic',
  },
  IRQ: { en: 'Iraq', fr: 'Irak' },
  ITA: {
    en: 'Italian Republic',
    fr: 'République italienne',
    ideology: 'democratic',
    government: 'parliamentary_republic',
  },
  JAP: { en: 'Japan', fr: 'Japon', ideology: 'democratic', government: 'constitutional_monarchy' },
  JOR: { en: 'Jordan', fr: 'Jordanie' },
  MON: {
    en: 'Mongolia',
    fr: 'Mongolie',
    ideology: 'democratic',
    government: 'parliamentary_republic',
  },
  OMA: { en: 'Oman', fr: 'Oman' },
  PER: { en: 'Islamic Republic of Iran', fr: 'République islamique d’Iran' },
  PHI: {
    en: 'Philippines',
    fr: 'Philippines',
    ideology: 'democratic',
    government: 'presidential_republic',
  },
  ROM: {
    en: 'Romania',
    fr: 'Roumanie',
    ideology: 'democratic',
    government: 'semi_presidential_republic',
  },
  SAF: {
    en: 'South Africa',
    fr: 'Afrique du Sud',
    ideology: 'democratic',
    government: 'parliamentary_republic',
  },
  SIA: { en: 'Thailand', fr: 'Thaïlande' },
  SPR: { en: 'Spain', fr: 'Espagne', ideology: 'democratic', government: 'parliamentary_monarchy' },
  YEM: { en: 'Yemen', fr: 'Yémen' },
};

const dateInRange = (date: string, from: string, to?: string | null) =>
  date >= from && (to === undefined || to === null || date <= to);

const addDays = (date: string, amount: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

const normalizeRegion = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();

function cloneBaseline(
  baseline: CountryBaseline,
  population: number,
  date: string,
): CountryBaseline {
  const gdpPerCapita =
    baseline.population > 0 ? (baseline.gdp * 1_000_000) / baseline.population : 1_000;
  return {
    ...baseline,
    baselineDate: date,
    population,
    gdp: (population * gdpPerCapita) / 1_000_000,
  };
}

export class HistoricalWorldResolver {
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly version: number;
  private readonly data: HistoricalCatalogData;
  private readonly actualRegionByNormalized: Map<string, string>;

  constructor(
    private readonly catalog: Catalog,
    dataDirectory: string,
  ) {
    const filePath = path.join(dataDirectory, 'historical_world.json');
    try {
      this.data = historicalCatalogSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      throw new AppError(
        500,
        'HISTORICAL_CATALOG_INVALID',
        `Historical chronology could not be loaded: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    this.coverageStart = this.data.coverageStart;
    this.coverageEnd = this.data.coverageEnd;
    this.version = this.data.version;
    this.actualRegionByNormalized = new Map(
      this.catalog.regions.regions.map((region) => [normalizeRegion(region.id), region.id]),
    );
    this.validateCatalog();
  }

  assertSupportedDate(date: string) {
    if (date < this.coverageStart || date > this.coverageEnd) {
      throw new AppError(
        422,
        'HISTORICAL_DATE_OUT_OF_RANGE',
        `Historical campaigns support dates from ${this.coverageStart} through ${this.coverageEnd}.`,
        [
          {
            path: 'startDate',
            message: `Use a date between ${this.coverageStart} and ${this.coverageEnd}.`,
          },
        ],
      );
    }
  }

  resolve(date: string, language: CatalogLanguage = 'en'): HistoricalWorldSnapshot {
    this.assertSupportedDate(date);
    const warnings: string[] = [];
    const polities = new Map<string, HistoricalResolvedPolity>();

    for (const baseNation of this.catalog.nations.values()) {
      if (!this.isBasePolityActive(baseNation.code, date)) continue;
      const localized = this.catalog.localizeNation(baseNation, language);
      const period = this.periodFor(baseNation.code, date);
      const modern = date >= '1990-01-01' ? MODERN_NAMES[baseNation.code] : undefined;
      let officeHolders = this.officeHolders(baseNation.code, date, language);
      if (
        officeHolders.length === 0 &&
        date >= '1930-01-01' &&
        date <= '1940-12-31' &&
        baseNation.leader_name &&
        baseNation.leader_name !== 'Unknown'
      ) {
        officeHolders = [
          {
            id: `legacy-1936:${baseNation.code}`,
            nationCode: baseNation.code,
            role: 'head_of_state',
            title: baseNation.leader_title ?? (language === 'fr' ? 'Chef d’État' : 'Head of state'),
            name: baseNation.leader_name,
            termStart: '1930-01-01',
            termEnd: '1940-12-31',
            source: 'curated',
            primary: true,
          },
        ];
      }
      const baseline = this.resolveBaseline(
        baseNation.code,
        date,
        this.catalog.countryBaselines.get(baseNation.code)!,
      );
      const name = period
        ? language === 'fr'
          ? period.nameFr
          : period.name
        : language === 'fr'
          ? (modern?.fr ?? localized.name)
          : (modern?.en ?? localized.name);
      const capital = period
        ? language === 'fr'
          ? period.capitalFr
          : period.capital
        : (localized.capital ?? null);
      const leader = officeHolders.find((holder) => holder.primary);
      const nation: Nation = {
        ...localized,
        name,
        capital: capital ?? undefined,
        ideology: period?.ideology ?? modern?.ideology ?? localized.ideology,
        leader_name: leader?.name,
        leader_title: leader?.title,
      };
      polities.set(baseNation.code, {
        code: baseNation.code,
        name,
        capital,
        capitalRegionId: period?.capitalRegionId ?? this.capitalRegionFor(baseNation.code),
        ideology: nation.ideology,
        governmentType: period?.governmentType ?? modern?.government ?? baseline.governmentType,
        isMajorPower: baseNation.is_major_power,
        color: baseNation.color,
        activeFrom: period?.from ?? this.coverageStart,
        activeTo: period?.to ?? null,
        officeHolders,
        dataQuality: officeHolders.length ? 'historical' : 'estimated',
        baseline,
        nation,
      });
    }

    for (const entry of this.data.additionalPolities) {
      if (!dateInRange(date, entry.activeFrom, entry.activeTo)) continue;
      const officeHolders = this.officeHolders(entry.code, date, language);
      const sourceBaseline =
        this.catalog.countryBaselines.get(entry.code) ?? this.catalog.countryBaselines.get('FRA')!;
      const baseline = cloneBaseline(
        sourceBaseline,
        this.resolvePopulation(entry.code, date, entry.population2000),
        date,
      );
      baseline.governmentType = entry.governmentType;
      const name = language === 'fr' ? entry.nameFr : entry.name;
      const capital = language === 'fr' ? entry.capitalFr : entry.capital;
      const leader = officeHolders.find((holder) => holder.primary);
      const nation: Nation = {
        code: entry.code,
        name,
        capital,
        ideology: entry.ideology,
        is_major_power: entry.isMajorPower,
        color: entry.color,
        population: baseline.population,
        manpower: Math.round(baseline.population * 0.015),
        military_strength: entry.isMajorPower ? 75 : 35,
        has_territory: true,
        leader_name: leader?.name,
        leader_title: leader?.title,
      };
      polities.set(entry.code, {
        code: entry.code,
        name,
        capital,
        capitalRegionId: entry.capitalRegionId,
        ideology: entry.ideology,
        governmentType: entry.governmentType,
        isMajorPower: entry.isMajorPower,
        color: entry.color,
        activeFrom: entry.activeFrom,
        activeTo: entry.activeTo ?? null,
        officeHolders,
        dataQuality: officeHolders.length ? 'historical' : 'estimated',
        baseline,
        nation,
      });
    }

    const regionOwners = new Map(
      this.catalog.regions.regions.map((region) => [region.id, region.nation_code ?? null]),
    );
    for (const rule of this.data.regionOwnershipRules) {
      if (!dateInRange(date, rule.from, rule.to)) continue;
      if (rule.replaceOwner) {
        for (const [regionId, owner] of regionOwners) {
          if (owner === rule.replaceOwner) regionOwners.set(regionId, rule.owner);
        }
      }
      for (const requestedRegion of rule.regions ?? []) {
        const regionId = this.actualRegionByNormalized.get(normalizeRegion(requestedRegion));
        if (!regionId) {
          warnings.push(`Historical region mapping is unavailable for ${requestedRegion}.`);
          continue;
        }
        regionOwners.set(regionId, rule.owner);
      }
    }
    for (const owner of new Set(regionOwners.values())) {
      if (owner && !polities.has(owner)) {
        warnings.push(
          `Territory owner ${owner} is not represented as an active polity on ${date}.`,
        );
      }
    }
    const regionStatuses = new Map<string, HistoricalRegionStatus>();
    for (const rule of this.data.territoryStatusRules) {
      if (!dateInRange(date, rule.from, rule.to)) continue;
      const regionId = this.actualRegionByNormalized.get(normalizeRegion(rule.regionId));
      if (!regionId) {
        warnings.push(`Historical territorial status mapping is unavailable for ${rule.regionId}.`);
        continue;
      }
      regionStatuses.set(regionId, {
        status: rule.status,
        administeringNationCode: rule.administeringNationCode,
        claimNationCodes: [...rule.claimNationCodes],
      });
    }
    return {
      date,
      catalogVersion: this.version,
      polities: [...polities.values()],
      regionOwners,
      regionStatuses,
      warnings,
    };
  }

  preview(date: string, language: CatalogLanguage = 'en'): HistoricalWorldPreview {
    const snapshot = this.resolve(date, language);
    return {
      date,
      coverageStart: this.coverageStart,
      coverageEnd: this.coverageEnd,
      catalogVersion: this.version,
      territorialPrecision: 'strategic_regions',
      nations: snapshot.polities.map(
        ({ baseline: _baseline, nation: _nation, ...polity }) => polity,
      ),
      warnings: snapshot.warnings,
    };
  }

  transitionsBetween(previousDate: string, nextDate: string, language: CatalogLanguage = 'fr') {
    const transitions: HistoricalTransition[] = [];
    for (const term of this.data.officeTerms) {
      if (term.termStart <= previousDate || term.termStart > nextDate) continue;
      const predecessor = this.data.officeTerms
        .filter(
          (candidate) => candidate.nationCode === term.nationCode && candidate.role === term.role,
        )
        .filter((candidate) => candidate.termStart < term.termStart)
        .sort((left, right) => right.termStart.localeCompare(left.termStart))[0];
      transitions.push({
        id: `office:${term.id}`,
        effectiveDate: term.termStart,
        kind: 'office',
        entityIds: [`office:${term.nationCode}:${term.role}`],
        expectedBefore: { holderId: predecessor?.id ?? null },
        changes: { holderId: term.id },
        title: language === 'fr' ? `${term.name} entre en fonction` : `${term.name} takes office`,
        description:
          language === 'fr'
            ? `${term.name} devient ${term.titleFr}.`
            : `${term.name} becomes ${term.title}.`,
      });
    }
    const territorialDates = [
      ...new Set(
        this.data.regionOwnershipRules
          .map((rule) => rule.from)
          .filter((date) => date > previousDate && date <= nextDate),
      ),
    ].sort();
    for (const effectiveDate of territorialDates) {
      const before = this.resolve(addDays(effectiveDate, -1), language).regionOwners;
      const after = this.resolve(effectiveDate, language).regionOwners;
      for (const [regionId, owner] of after) {
        const previousOwner = before.get(regionId) ?? null;
        if (owner === previousOwner) continue;
        transitions.push({
          id: `territory:${effectiveDate}:${regionId}:${previousOwner ?? 'none'}:${owner ?? 'none'}`,
          effectiveDate,
          kind: 'territory',
          entityIds: [`region:${regionId}`],
          expectedBefore: { owner: previousOwner },
          changes: { owner },
          title:
            language === 'fr'
              ? `Changement territorial : ${regionId}`
              : `Territorial change: ${regionId}`,
          description:
            language === 'fr'
              ? `${regionId} passe sous souveraineté ${owner ?? 'sans propriétaire'}.`
              : `${regionId} becomes sovereign territory of ${owner ?? 'no owner'}.`,
        });
      }
    }
    const statusDates = [
      ...new Set(
        this.data.territoryStatusRules
          .map((rule) => rule.from)
          .filter((date) => date > previousDate && date <= nextDate),
      ),
    ].sort();
    for (const effectiveDate of statusDates) {
      const before = this.resolve(addDays(effectiveDate, -1), language).regionStatuses;
      const after = this.resolve(effectiveDate, language).regionStatuses;
      for (const [regionId, status] of after) {
        const previous = before.get(regionId);
        if (
          previous?.status === status.status &&
          previous.administeringNationCode === status.administeringNationCode &&
          previous.claimNationCodes.join(',') === status.claimNationCodes.join(',')
        ) {
          continue;
        }
        transitions.push({
          id: `territory-status:${effectiveDate}:${regionId}:${status.status}`,
          effectiveDate,
          kind: 'territory',
          entityIds: [`region:${regionId}`],
          expectedBefore: { territorialStatus: previous?.status ?? null },
          changes: {
            territorialStatus: status.status,
            administeringNationCode: status.administeringNationCode,
            claimNationCodes: JSON.stringify(status.claimNationCodes),
          },
          title:
            language === 'fr'
              ? `Nouveau statut territorial : ${regionId}`
              : `New territorial status: ${regionId}`,
          description:
            language === 'fr'
              ? `${regionId} devient un territoire britannique d’outre-mer distinct du Royaume-Uni.`
              : `${regionId} becomes a British Overseas Territory distinct from the United Kingdom.`,
        });
      }
    }
    return transitions.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  }

  officeTerm(id: string) {
    return this.data.officeTerms.find((term) => term.id === id);
  }

  private officeHolders(code: string, date: string, language: CatalogLanguage): OfficeHolder[] {
    const matched = this.data.officeTerms.filter(
      (term) => term.nationCode === code && dateInRange(date, term.termStart, term.termEnd),
    );
    const uniqueNames = new Set<string>();
    return matched
      .sort((left, right) =>
        left.role === 'head_of_state' ? -1 : right.role === 'head_of_state' ? 1 : 0,
      )
      .filter((term) => {
        if (uniqueNames.has(term.name)) return false;
        uniqueNames.add(term.name);
        return true;
      })
      .slice(0, 2)
      .map((term) => ({
        id: term.id,
        nationCode: term.nationCode,
        role: term.role,
        title: language === 'fr' ? term.titleFr : term.title,
        name: term.name,
        termStart: term.termStart,
        termEnd: term.termEnd ?? null,
        source: term.source,
        primary:
          term.role === 'head_of_state' ||
          !matched.some((candidate) => candidate.role === 'head_of_state'),
      }));
  }

  private isBasePolityActive(code: string, date: string) {
    const bounded: Record<string, [string, string | null]> = {
      CZE: ['1918-10-28', null],
      DNZ: ['1920-01-10', '1939-09-01'],
      GLC: ['1918-01-01', '1938-12-31'],
      MAN: ['1932-03-01', '1945-08-17'],
      MEN: ['1936-01-01', '1945-08-18'],
      PRC: ['1931-11-07', null],
      SOV: ['1922-12-30', '1991-12-25'],
      TAN: ['1921-08-14', '1944-10-10'],
      YUG: ['1918-12-01', '2003-02-03'],
    };
    const range = bounded[code];
    if (range && !dateInRange(date, range[0], range[1])) return false;
    return !this.data.inactivePeriods.some(
      (period) => period.code === code && dateInRange(date, period.from, period.to),
    );
  }

  private periodFor(code: string, date: string): PolityPeriod | undefined {
    return this.data.polityPeriods.find(
      (period) => period.code === code && dateInRange(date, period.from, period.to),
    );
  }

  private capitalRegionFor(code: string) {
    return (
      (
        this.catalog.cities.find((city) => city.nation_code === code && city.type === 'capital') ??
        this.catalog.cities.find((city) => city.nation_code === code)
      )?.region_id ?? null
    );
  }

  private resolvePopulation(code: string, date: string, population2000: number) {
    const snapshots = this.data.populationSnapshots[code];
    const exact = snapshots?.[date.slice(0, 4)];
    if (exact) return exact;
    const years = Number(date.slice(0, 4)) - 2000;
    return Math.max(1, Math.round(population2000 * Math.exp(years * 0.006)));
  }

  private resolveBaseline(code: string, date: string, baseline: CountryBaseline) {
    const snapshots = this.data.populationSnapshots[code];
    const exact = snapshots?.[date.slice(0, 4)];
    if (exact) return cloneBaseline(baseline, exact, date);
    const baseYear = Number(baseline.baselineDate.slice(0, 4));
    const targetYear = Number(date.slice(0, 4));
    const annualRate = Math.max(-0.01, Math.min(0.025, baseline.populationGrowthRate / 100));
    const population = Math.max(
      1,
      Math.round(baseline.population * Math.exp((targetYear - baseYear) * annualRate)),
    );
    return cloneBaseline(baseline, population, date);
  }

  private validateCatalog() {
    if (this.coverageStart > this.coverageEnd) {
      throw new AppError(
        500,
        'HISTORICAL_CATALOG_INVALID',
        'Historical coverage dates are reversed.',
      );
    }
    const ids = new Set<string>();
    for (const term of this.data.officeTerms) {
      if (ids.has(term.id))
        throw new AppError(500, 'HISTORICAL_CATALOG_INVALID', `Duplicate office term: ${term.id}.`);
      ids.add(term.id);
      if (term.termEnd && term.termEnd < term.termStart) {
        throw new AppError(
          500,
          'HISTORICAL_CATALOG_INVALID',
          `Office term ends before it starts: ${term.id}.`,
        );
      }
    }
    const knownCodes = new Set([
      ...this.catalog.nations.keys(),
      ...this.data.additionalPolities.map((polity) => polity.code),
    ]);
    for (const rule of this.data.regionOwnershipRules) {
      if (!knownCodes.has(rule.owner)) {
        throw new AppError(
          500,
          'HISTORICAL_CATALOG_INVALID',
          `Unknown historical territory owner: ${rule.owner}.`,
        );
      }
    }
    for (const rule of this.data.territoryStatusRules) {
      if (!this.actualRegionByNormalized.has(normalizeRegion(rule.regionId))) {
        throw new AppError(
          500,
          'HISTORICAL_CATALOG_INVALID',
          `Unknown historical territorial status region: ${rule.regionId}.`,
        );
      }
      for (const code of [rule.administeringNationCode, ...rule.claimNationCodes]) {
        if (!knownCodes.has(code)) {
          throw new AppError(
            500,
            'HISTORICAL_CATALOG_INVALID',
            `Unknown nation in territorial status: ${code}.`,
          );
        }
      }
    }
  }
}
