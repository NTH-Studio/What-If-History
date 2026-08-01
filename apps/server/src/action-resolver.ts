import type {
  ActionPreview,
  ActionPreviewInput,
  GameRegion,
  TerritoryEffectOperation,
} from '@what-if-history/contracts';
import type { Catalog, CatalogLanguage } from './catalog.js';
import type { AdvancedRepository } from './db/advanced-repository.js';

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[_'’.-]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

const operationPatterns: Array<{
  operation: TerritoryEffectOperation;
  patterns: RegExp[];
}> = [
  { operation: 'cede', patterns: [/\b(cede|ceder|donne|donner|give|transfer)\b/] },
  { operation: 'occupy', patterns: [/\b(occupe|occuper|occupy)\b/] },
  { operation: 'annex', patterns: [/\b(annexe|annexer|annex)\b/] },
  { operation: 'liberate', patterns: [/\b(libere|liberer|liberate|free)\b/] },
  {
    operation: 'remove_claim',
    patterns: [/\b(retire|retirer|remove|abandonne|abandonner)\b.*\b(revendication|claim)\b/],
  },
  { operation: 'add_claim', patterns: [/\b(revendique|revendiquer|claim)\b/] },
];

const includesPhrase = (text: string, phrase: string) =>
  phrase.length > 1 && ` ${text} `.includes(` ${phrase} `);

const commonNationAliases: Partial<Record<string, string[]>> = {
  FRA: ['France', 'français', 'française', 'French'],
  GER: [
    'Allemagne',
    'allemand',
    'allemande',
    'allemands',
    'Germany',
    'German',
    'Germans',
    'German Reich',
    'Reich allemand',
  ],
  ITA: ['Italie', 'Italy', 'Kingdom of Italy'],
  ENG: [
    'Angleterre',
    "Royaume d'Angleterre",
    'Royaume-Uni',
    'Grande-Bretagne',
    'England',
    'English',
    'United Kingdom',
    'Great Britain',
    'Britain',
  ],
  SOV: ['URSS', 'Union soviétique', 'Soviet Union'],
  USA: ['États-Unis', 'United States', 'America'],
  SPR: ['Espagne', 'Spain'],
  POL: ['Pologne', 'Poland'],
};

export class ActionEffectResolver {
  constructor(
    private readonly catalog: Catalog,
    private readonly advanced: AdvancedRepository,
  ) {}

  preview(
    gameId: string,
    input: ActionPreviewInput,
    language: CatalogLanguage = 'fr',
  ): ActionPreview {
    const normalizedText = normalize(input.actionText);
    const contextMarker = normalizedText.search(/\b(contexte cartographique|map context)\b/);
    const normalizedIntentText =
      contextMarker >= 0 ? normalizedText.slice(0, contextMarker).trim() : normalizedText;
    const operation = operationPatterns.find((candidate) =>
      candidate.patterns.some((pattern) => pattern.test(normalizedText)),
    )?.operation;
    const regions = this.advanced.listRegions(gameId);
    const regionCandidates = this.resolveRegions(
      gameId,
      regions,
      normalizedText,
      input.context?.regionId,
    );
    const nationCandidates = this.resolveNations(
      normalizedIntentText,
      input.context?.nationCode,
      language,
    );
    const ambiguities: ActionPreview['ambiguities'] = [];
    const warnings: string[] = [];

    if (!operation) {
      if (input.actionType === 'law') {
        const game = this.advanced.database
          .prepare('SELECT player_nation_code FROM games WHERE id = ?')
          .get(gameId) as { player_nation_code?: string } | undefined;
        return {
          actionText: input.actionText,
          actionType: input.actionType,
          effects: [
            {
              kind: 'law',
              operation: 'enact',
              nationCode: String(game?.player_nation_code ?? ''),
              title: input.actionText,
              summary: '',
              category: 'other',
            },
          ],
          ambiguities,
          warnings,
          worldRevision: this.currentRevision(gameId),
        };
      }
      warnings.push(
        language === 'en'
          ? 'No guaranteed world change was identified. The order may still produce simulated consequences.'
          : 'Aucun changement du monde garanti n’a été identifié. L’ordre peut néanmoins produire des conséquences simulées.',
      );
      return {
        actionText: input.actionText,
        actionType: input.actionType,
        effects: [],
        ambiguities,
        warnings,
        worldRevision: this.currentRevision(gameId),
      };
    }

    if (regionCandidates.length !== 1) {
      ambiguities.push({
        field: 'region',
        value: input.context?.regionId ?? input.actionText,
        candidates: regionCandidates.slice(0, 20).map((region) => ({
          id: region.regionId,
          label: region.name,
        })),
      });
    }

    const region = regionCandidates[0];
    let nationCode = nationCandidates.at(-1)?.code ?? null;
    if (operation === 'liberate' && region) nationCode = region.ownerNationCode;
    if (
      !nationCode &&
      region &&
      operation === 'remove_claim' &&
      region.claimNationCodes.length === 1
    ) {
      nationCode = region.claimNationCodes[0]!;
    }
    if (!nationCode) {
      ambiguities.push({
        field: 'nation',
        value: input.context?.nationCode ?? input.actionText,
        candidates: nationCandidates.slice(0, 20).map((nation) => ({
          id: nation.code,
          label: nation.name,
        })),
      });
    }

    return {
      actionText: input.actionText,
      actionType: input.actionType,
      effects:
        region && nationCode
          ? [{ kind: 'territory', operation, regionId: region.regionId, nationCode }]
          : [],
      ambiguities,
      warnings,
      worldRevision: this.currentRevision(gameId),
    };
  }

  private resolveRegions(
    gameId: string,
    regions: GameRegion[],
    normalizedText: string,
    contextRegionId?: string,
  ) {
    if (contextRegionId) {
      const selected = regions.find((region) => region.regionId === contextRegionId);
      if (selected) return [selected];
    }
    const matches = new Map<string, GameRegion>();
    for (const feature of this.advanced.listMapFeatures(gameId)) {
      if (includesPhrase(normalizedText, normalize(feature.name))) {
        const region = regions.find((candidate) => candidate.regionId === feature.regionId);
        if (region) matches.set(region.regionId, region);
      }
    }
    for (const region of regions) {
      if (
        includesPhrase(normalizedText, normalize(region.name)) ||
        includesPhrase(normalizedText, normalize(region.regionId))
      ) {
        matches.set(region.regionId, region);
      }
    }
    return [...matches.values()];
  }

  private resolveNations(
    normalizedText: string,
    contextNationCode: string | undefined,
    language: CatalogLanguage,
  ) {
    const localized = [...this.catalog.listNations('fr'), ...this.catalog.listNations('en')];
    const matches = new Map<string, { code: string; name: string; position: number }>();
    for (const nation of localized) {
      const aliases = [nation.code, nation.name, ...(commonNationAliases[nation.code] ?? [])];
      for (const alias of aliases) {
        const normalizedAlias = normalize(alias);
        const position = ` ${normalizedText} `.lastIndexOf(` ${normalizedAlias} `);
        if (position >= 0) {
          const existing = matches.get(nation.code);
          if (!existing || position > existing.position) {
            matches.set(nation.code, { code: nation.code, name: nation.name, position });
          }
        }
      }
    }
    const explicitMatches = [...matches.values()].sort(
      (left, right) => left.position - right.position,
    );
    if (explicitMatches.length > 0) return explicitMatches;
    if (contextNationCode) {
      const nation = this.catalog.nations.get(contextNationCode);
      if (nation) return [this.catalog.localizeNation(nation, language)];
    }
    return [];
  }

  private currentRevision(gameId: string) {
    const row = this.advanced.database
      .prepare('SELECT world_revision FROM games WHERE id = ?')
      .get(gameId) as { world_revision?: number } | undefined;
    return Number(row?.world_revision ?? 0);
  }
}
