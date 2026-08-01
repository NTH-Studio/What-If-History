import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite';
import type {
  Action,
  Chat,
  ChatMessage,
  CountryLaw,
  CountryProfile,
  CountrySummary,
  CreateActionInput,
  CreateGameInput,
  GameAiModels,
  Game,
  GameEvent,
  GameSummary,
  GeneratedEvent,
  GeneratedLawChange,
  LlmCallPhase,
  LlmSettingsInput,
  LlmSettingsPublic,
  LlmTokenUsage,
  Nation,
  NationState,
  PromulgateLawInput,
  ScenarioMode,
  UpdateActionInput,
  UpdateGameConfigInput,
  Unit,
  WorldEffect,
} from '@what-if-history/contracts';
import { createStartingUnits } from '@what-if-history/core';
import { AppError, notFound } from '../errors.js';
import type { Catalog, CatalogLanguage, CountryBaseline } from '../catalog.js';
import { HistoricalWorldResolver, type HistoricalWorldSnapshot } from '../historical-world.js';
import { ChatRepository } from './chat-repository.js';
import { LlmRepository } from './llm-repository.js';
import {
  asBoolean,
  asNullableNumber,
  asNumber,
  asString,
  now,
  parseJson,
  type Row,
} from './values.js';

const historicalWorldContext = (startDate: string) =>
  `Historical campaign beginning on ${startDate}. The campaign date and persisted world state ` +
  `are authoritative; do not assume a different historical year.`;

export class Repository {
  private readonly chats: ChatRepository;
  private readonly llm: LlmRepository;

  constructor(
    readonly database: DatabaseSync,
    private readonly catalog: Catalog,
    private readonly historical = new HistoricalWorldResolver(catalog, catalog.dataDirectory),
  ) {
    this.chats = new ChatRepository(database, catalog);
    this.llm = new LlmRepository(database);
    this.initializeCountryProfiles();
    this.initializeCampaignWorlds();
    this.initializeDynamicCapitals();
  }

  previewHistoricalWorld(date: string, language: CatalogLanguage = 'en') {
    return this.historical.preview(date, language);
  }

  listHistoricalNations(date: string, language: CatalogLanguage = 'en') {
    return this.historical.resolve(date, language).polities.map((polity) => polity.nation);
  }

  createGame(input: CreateGameInput, language: CatalogLanguage = 'en'): Game {
    const historicalWorld = this.historical.resolve(input.startDate, language);
    const selectedPolity = historicalWorld.polities.find(
      (candidate) => candidate.code === input.nationCode,
    );
    if (!selectedPolity) {
      throw new AppError(
        400,
        'NATION_NOT_ACTIVE_AT_DATE',
        'The selected nation does not exist at the campaign start date.',
      );
    }

    const id = randomUUID();
    const timestamp = now();
    const localizedNation = selectedPolity.nation;
    const name = input.name ?? `${localizedNation.name} — ${input.startDate}`;
    const scenarioMode = input.scenario?.mode ?? 'historical';
    const worldContext =
      input.scenario?.mode === 'custom'
        ? input.scenario.premise
        : historicalWorldContext(input.startDate);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO games (
            id, name, player_nation_code, current_date, turn_number,
            world_context, simulation_rules, scenario_mode, difficulty, ai_models,
            preset_id, historical_baseline_mode, historical_catalog_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, '{}', ?, 'historical_v1', ?, ?, ?)`,
        )
        .run(
          id,
          name,
          input.nationCode,
          input.startDate,
          worldContext,
          'Realistic consequences, diplomatic weight and historical plausibility with player flexibility.',
          scenarioMode,
          input.difficulty ?? 'normal',
          input.presetId ?? null,
          historicalWorld.catalogVersion,
          timestamp,
          timestamp,
        );

      const insertState = this.database.prepare(
        `INSERT INTO nation_states (
          game_id, nation_code, stability, war_support, manpower, political_power,
          treasury, at_war, occupied_regions, population, gdp, happiness, literacy,
          unemployment, inflation, industrial_capacity, health, food_security,
          population_growth_rate, gdp_growth_rate, profile_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const polity of historicalWorld.polities) {
        const catalogNation = polity.nation;
        const baseline = polity.baseline;
        insertState.run(
          id,
          catalogNation.code,
          70,
          20,
          catalogNation.manpower ?? 100_000,
          100,
          1_000,
          0,
          '[]',
          baseline.population,
          baseline.gdp,
          baseline.happiness,
          baseline.literacy,
          baseline.unemployment,
          baseline.inflation,
          baseline.industrialCapacity,
          baseline.health,
          baseline.foodSecurity,
          baseline.populationGrowthRate,
          baseline.gdpGrowthRate,
          baseline.version,
        );
      }
      this.seedHistoricalLaws(
        id,
        input.startDate,
        new Map(historicalWorld.polities.map((polity) => [polity.code, polity.baseline])),
      );
      this.seedCampaignWorld(
        id,
        timestamp,
        historicalWorld.regionOwners,
        historicalWorld.regionStatuses,
      );
      this.seedHistoricalSnapshot(id, historicalWorld, timestamp);
      this.initializeDynamicCapitals();

      const insertUnit = this.database.prepare(
        `INSERT INTO units (
          id, game_id, name, unit_type, nation_code, region_id, centroid,
          strength, organization, experience, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const legacyStartingUnits =
        input.startDate >= '1930-01-01' && input.startDate <= '1945-12-31'
          ? createStartingUnits(id, timestamp, randomUUID)
          : [];
      for (const unit of legacyStartingUnits) {
        if (!historicalWorld.polities.some((polity) => polity.code === unit.nationCode)) continue;
        insertUnit.run(
          unit.id,
          unit.gameId,
          unit.name,
          unit.unitType,
          unit.nationCode,
          unit.regionId,
          JSON.stringify(unit.centroid),
          unit.strength,
          unit.organization,
          unit.experience,
          unit.createdAt,
        );
      }
      if (legacyStartingUnits.length === 0) {
        const capitalRegion = selectedPolity.capitalRegionId ?? 'Ile_de_France';
        const city = this.catalog.cities.find((candidate) => candidate.region_id === capitalRegion);
        insertUnit.run(
          randomUUID(),
          id,
          language === 'fr' ? 'Brigade interarmes' : 'Combined Arms Brigade',
          input.startDate >= '1916-01-01' ? 'armor' : 'infantry',
          input.nationCode,
          capitalRegion,
          JSON.stringify(city?.coords ?? [700, 300]),
          100,
          100,
          20,
          timestamp,
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return this.getGame(id, language);
  }

  listGames(language: CatalogLanguage = 'en'): GameSummary[] {
    return (
      this.database.prepare('SELECT * FROM games ORDER BY updated_at DESC').all() as Row[]
    ).map((row) => this.mapGameSummary(row, language));
  }

  getGame(id: string, language: CatalogLanguage = 'en'): Game {
    const row = this.database.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) throw notFound('Game');

    const playerNationCode = asString(row.player_nation_code);
    const playerNation =
      this.persistedNation(id, playerNationCode, language) ??
      this.catalog.nations.get(playerNationCode);
    if (!playerNation) throw new AppError(500, 'CATALOG_INVALID', 'The player nation is missing.');

    const counts = this.database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM actions WHERE game_id = ? AND status = 'pending') AS pending_actions,
          (SELECT COUNT(*) FROM events WHERE game_id = ?) AS events,
          (SELECT COUNT(*) FROM units WHERE game_id = ?) AS units`,
      )
      .get(id, id, id) as Row;

    return {
      ...this.mapGameSummary(row, language),
      playerNation:
        asString(row.historical_baseline_mode) === 'historical_v1'
          ? playerNation
          : this.catalog.localizeNation(playerNation, language),
      nationStates: this.getNationStates(id),
      presetId: row.preset_id === null ? null : asString(row.preset_id),
      worldContext: asString(row.world_context),
      simulationRules: asString(row.simulation_rules),
      aiModels: this.mapGameAiModels(row.ai_models),
      pendingActionCount: asNumber(counts.pending_actions),
      eventCount: asNumber(counts.events),
      unitCount: asNumber(counts.units),
    };
  }

  renameGame(id: string, name: string) {
    const result = this.database
      .prepare('UPDATE games SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, now(), id);
    this.expectChange(result, 'Game');
  }

  updateGameConfig(id: string, input: UpdateGameConfigInput, language: CatalogLanguage = 'en') {
    const game = this.getGame(id, language);
    const aiModels = { ...game.aiModels, ...(input.aiModels ?? {}) };
    this.database
      .prepare(
        `UPDATE games SET difficulty = ?, simulation_rules = ?, ai_models = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.difficulty ?? game.difficulty,
        input.simulationRules ?? game.simulationRules,
        JSON.stringify(aiModels),
        now(),
        id,
      );
    return this.getGame(id, language);
  }

  deleteGame(id: string) {
    const result = this.database.prepare('DELETE FROM games WHERE id = ?').run(id);
    this.expectChange(result, 'Game');
  }

  getWorldRevision(gameId: string) {
    const row = this.database
      .prepare('SELECT world_revision FROM games WHERE id = ?')
      .get(gameId) as Row | undefined;
    if (!row) throw notFound('Game');
    return asNumber(row.world_revision);
  }

  getNationStates(gameId: string): NationState[] {
    return (
      this.database
        .prepare('SELECT * FROM nation_states WHERE game_id = ? ORDER BY nation_code')
        .all(gameId) as Row[]
    ).map((row) => ({
      nationCode: asString(row.nation_code),
      stability: asNumber(row.stability),
      warSupport: asNumber(row.war_support),
      manpower: asNumber(row.manpower),
      politicalPower: asNumber(row.political_power),
      treasury: asNumber(row.treasury),
      atWar: asBoolean(row.at_war),
      occupiedRegions: parseJson<string[]>(row.occupied_regions, []),
      population: asNumber(row.population),
      gdp: asNumber(row.gdp),
      happiness: asNumber(row.happiness),
      literacy: asNumber(row.literacy),
      unemployment: asNumber(row.unemployment),
      inflation: asNumber(row.inflation),
      industrialCapacity: asNumber(row.industrial_capacity),
      health: asNumber(row.health),
      foodSecurity: asNumber(row.food_security),
      populationGrowthRate: asNumber(row.population_growth_rate),
      gdpGrowthRate: asNumber(row.gdp_growth_rate),
      capitalFeatureId: row.capital_feature_id === null ? null : asString(row.capital_feature_id),
      capitalStatus: asString(row.capital_status || 'established') as NationState['capitalStatus'],
    }));
  }

  listCountries(gameId: string, language: CatalogLanguage = 'en'): CountrySummary[] {
    this.assertGame(gameId);
    const states = new Map(this.getNationStates(gameId).map((state) => [state.nationCode, state]));
    const lawCounts = new Map(
      (
        this.database
          .prepare(
            `SELECT nation_code, COUNT(*) AS count
             FROM country_laws WHERE game_id = ? AND status = 'active'
             GROUP BY nation_code`,
          )
          .all(gameId) as Row[]
      ).map((row) => [asString(row.nation_code), asNumber(row.count)]),
    );
    const territoryCounts = new Map<
      string,
      { ownedRegionCount: number; controlledRegionCount: number; claimedRegionCount: number }
    >();
    const campaignCapitals = new Map(
      (
        this.database
          .prepare(
            `SELECT ns.nation_code, mf.name
             FROM nation_states ns
             JOIN map_features mf ON mf.id = ns.capital_feature_id AND mf.game_id = ns.game_id
             WHERE ns.game_id = ? AND ns.capital_status != 'lost'`,
          )
          .all(gameId) as Row[]
      ).map((row) => [asString(row.nation_code), asString(row.name)]),
    );
    for (const row of this.database
      .prepare(
        `SELECT owner_nation_code, controller_nation_code, claim_nation_codes
         FROM game_regions WHERE game_id = ?`,
      )
      .all(gameId) as Row[]) {
      const owner = row.owner_nation_code === null ? null : asString(row.owner_nation_code);
      const controller =
        row.controller_nation_code === null ? null : asString(row.controller_nation_code);
      const claims = parseJson<string[]>(row.claim_nation_codes, []);
      const bump = (
        code: string,
        field: 'ownedRegionCount' | 'controlledRegionCount' | 'claimedRegionCount',
      ) => {
        const current = territoryCounts.get(code) ?? {
          ownedRegionCount: 0,
          controlledRegionCount: 0,
          claimedRegionCount: 0,
        };
        current[field] += 1;
        territoryCounts.set(code, current);
      };
      if (owner) bump(owner, 'ownedRegionCount');
      if (controller) bump(controller, 'controlledRegionCount');
      for (const claim of claims) bump(claim, 'claimedRegionCount');
    }
    const persistedPolities = this.database
      .prepare('SELECT * FROM game_polities WHERE game_id = ? ORDER BY nation_code')
      .all(gameId) as Row[];
    const sources = persistedPolities.length
      ? persistedPolities.map((row) => ({
          nation: this.persistedNation(gameId, asString(row.nation_code), language)!,
          governmentType: asString(row.government_type),
          dataQuality: asString(row.data_quality),
        }))
      : [...this.catalog.nations.values()].map((catalogNation) => ({
          nation: this.catalog.localizeNation(catalogNation, language),
          governmentType: this.catalog.countryBaselines.get(catalogNation.code)!.governmentType,
          dataQuality: 'estimated',
        }));
    return sources
      .map(({ nation, governmentType }) => {
        const state = states.get(nation.code);
        if (!state) {
          throw new AppError(
            500,
            'COUNTRY_STATE_MISSING',
            `Country state missing: ${nation.code}.`,
          );
        }
        return {
          code: nation.code,
          name: nation.name,
          capital:
            state.capitalStatus === 'lost'
              ? null
              : (campaignCapitals.get(nation.code) ?? nation.capital ?? null),
          leaderName: nation.leader_name ?? null,
          ideology: nation.ideology,
          governmentType,
          isMajorPower: nation.is_major_power,
          color: nation.color,
          indicators: this.toCountryIndicators(state),
          activeLawCount: lawCounts.get(nation.code) ?? 0,
          ...(territoryCounts.get(nation.code) ?? {
            ownedRegionCount: 0,
            controlledRegionCount: 0,
            claimedRegionCount: 0,
          }),
          capitalStatus: state.capitalStatus,
          officeHolders: this.listOfficeHolders(gameId, nation.code, language),
          historicalContinuity: persistedPolities.length
            ? (
                this.database
                  .prepare(
                    `SELECT continuity_status FROM historical_continuity
                   WHERE game_id = ? AND entity_type = 'polity' AND entity_id = ?`,
                  )
                  .get(gameId, nation.code) as Row | undefined
              )?.continuity_status === 'diverged'
              ? ('diverged' as const)
              : ('historical' as const)
            : ('legacy_static' as const),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, language));
  }

  getCountryProfile(
    gameId: string,
    nationCode: string,
    language: CatalogLanguage = 'fr',
  ): CountryProfile {
    const summary = this.listCountries(gameId, language).find(
      (country) => country.code === nationCode,
    );
    if (!summary) throw notFound('Country');
    const nation =
      this.persistedNation(gameId, nationCode, language) ?? this.catalog.nations.get(nationCode)!;
    const baseline = this.catalog.countryBaselines.get(nationCode);
    const gameRow = this.database
      .prepare(
        'SELECT games.current_date AS game_date, historical_baseline_mode FROM games WHERE id = ?',
      )
      .get(gameId) as Row;
    const polityRow = this.database
      .prepare('SELECT data_quality FROM game_polities WHERE game_id = ? AND nation_code = ?')
      .get(gameId, nationCode) as Row | undefined;
    const state = this.getNationStates(gameId).find((item) => item.nationCode === nationCode)!;
    const laws = this.listCountryLaws(gameId, nationCode, language);
    const recentEvents = this.listEvents(gameId)
      .filter((event) => event.affected_nations.includes(nationCode))
      .slice(0, 8);
    const unitCount = (
      this.database
        .prepare('SELECT COUNT(*) AS count FROM units WHERE game_id = ? AND nation_code = ?')
        .get(gameId, nationCode) as Row
    ).count;
    return {
      ...summary,
      leaderTitle:
        summary.officeHolders.find((holder) => holder.primary)?.title ??
        nation.leader_title ??
        null,
      militaryStrength: nation.military_strength ?? 0,
      occupiedRegions: state.occupiedRegions,
      laws,
      recentEvents,
      unitCount: asNumber(unitCount),
      dataQuality: asString(polityRow?.data_quality) === 'historical' ? 'historical' : 'estimated',
      baselineDate:
        asString(gameRow.historical_baseline_mode) === 'historical_v1'
          ? asString(gameRow.game_date)
          : (baseline?.baselineDate ?? asString(gameRow.game_date)),
    };
  }

  listCountryLaws(gameId: string, nationCode?: string, language: 'fr' | 'en' = 'fr'): CountryLaw[] {
    this.assertGame(gameId);
    const rows = nationCode
      ? (this.database
          .prepare(
            `SELECT * FROM country_laws
             WHERE game_id = ? AND nation_code = ?
             ORDER BY status ASC, enacted_date DESC, rowid DESC`,
          )
          .all(gameId, nationCode) as Row[])
      : (this.database
          .prepare(
            `SELECT * FROM country_laws
             WHERE game_id = ?
             ORDER BY nation_code, status ASC, enacted_date DESC, rowid DESC`,
          )
          .all(gameId) as Row[]);
    return rows.map((row) => this.mapCountryLaw(row, language));
  }

  listActiveLawsForSimulation(gameId: string) {
    return (
      this.database
        .prepare(
          `SELECT id, nation_code, title_fr, title_en
           FROM country_laws WHERE game_id = ? AND status = 'active'
           ORDER BY nation_code, enacted_date`,
        )
        .all(gameId) as Row[]
    ).map((row) => ({
      id: asString(row.id),
      nationCode: asString(row.nation_code),
      titleFr: asString(row.title_fr),
      titleEn: asString(row.title_en),
    }));
  }

  createAction(
    gameId: string,
    input: CreateActionInput,
    accepted: boolean,
    reason?: string,
  ): Action {
    const game = this.getGame(gameId);
    const action: Action = {
      id: randomUUID(),
      gameId,
      nationCode: game.playerNationCode,
      actionText: input.actionText,
      actionType: input.actionType,
      status: accepted ? 'pending' : 'rejected',
      aiResponse: reason ?? null,
      turnNumber: game.turnNumber,
      createdAt: now(),
      effects: input.effects ?? [],
      effectStatus: accepted ? 'queued' : 'failed',
      previewWorldRevision: input.previewWorldRevision ?? null,
    };
    this.assertPreviewRevision(gameId, action.effects, action.previewWorldRevision);
    this.database
      .prepare(
        `INSERT INTO actions (
          id, game_id, nation_code, action_text, action_type, status,
          ai_response, turn_number, created_at, effects_json, effect_status,
          preview_world_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.id,
        action.gameId,
        action.nationCode,
        action.actionText,
        action.actionType,
        action.status,
        action.aiResponse,
        action.turnNumber,
        action.createdAt,
        JSON.stringify(action.effects),
        action.effectStatus,
        action.previewWorldRevision,
      );
    return action;
  }

  createPromulgatedLaw(gameId: string, input: PromulgateLawInput, reason: string): Action {
    const game = this.getGame(gameId);
    const action: Action = {
      id: randomUUID(),
      gameId,
      nationCode: game.playerNationCode,
      actionText: input.actionText,
      actionType: 'law',
      status: 'pending',
      aiResponse: reason,
      turnNumber: game.turnNumber,
      createdAt: now(),
      effects: input.effects ?? [],
      effectStatus: 'queued',
      previewWorldRevision: input.previewWorldRevision ?? null,
    };
    this.assertPreviewRevision(gameId, action.effects, action.previewWorldRevision);
    this.database
      .prepare(
        `INSERT INTO actions (
          id, game_id, nation_code, action_text, action_type, status,
          ai_response, turn_number, created_at, effects_json, effect_status,
          preview_world_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.id,
        action.gameId,
        action.nationCode,
        action.actionText,
        action.actionType,
        action.status,
        action.aiResponse,
        action.turnNumber,
        action.createdAt,
        JSON.stringify(action.effects),
        action.effectStatus,
        action.previewWorldRevision,
      );
    return action;
  }

  listActions(gameId: string): Action[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM actions WHERE game_id = ? ORDER BY created_at DESC')
        .all(gameId) as Row[]
    ).map(this.mapAction);
  }

  updateAction(gameId: string, actionId: string, input: UpdateActionInput): Action {
    const current = this.database
      .prepare(
        `SELECT * FROM actions
         WHERE id = ? AND game_id = ? AND status = 'pending' AND action_type <> 'law'`,
      )
      .get(actionId, gameId) as Row | undefined;
    if (!current) throw notFound('Pending action');
    const effects = input.effects ?? parseJson<WorldEffect[]>(current.effects_json, []);
    const previewWorldRevision =
      input.previewWorldRevision ?? asNullableNumber(current.preview_world_revision);
    this.assertPreviewRevision(gameId, effects, previewWorldRevision);
    this.database
      .prepare(
        `UPDATE actions SET action_text = ?, action_type = ?, effects_json = ?,
         effect_status = 'queued', preview_world_revision = ? WHERE id = ? AND game_id = ?`,
      )
      .run(
        input.actionText ?? asString(current.action_text),
        input.actionType ?? asString(current.action_type),
        JSON.stringify(effects),
        previewWorldRevision,
        actionId,
        gameId,
      );
    const updated = this.database
      .prepare('SELECT * FROM actions WHERE id = ? AND game_id = ?')
      .get(actionId, gameId) as Row;
    return this.mapAction(updated);
  }

  deleteAction(gameId: string, actionId: string) {
    const result = this.database
      .prepare(
        "DELETE FROM actions WHERE id = ? AND game_id = ? AND status = 'pending' AND action_type <> 'law'",
      )
      .run(actionId, gameId);
    this.expectChange(result, 'Pending action');
  }

  listEvents(gameId: string): GameEvent[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare(
          'SELECT * FROM events WHERE game_id = ? ORDER BY turn_number DESC, created_at DESC',
        )
        .all(gameId) as Row[]
    ).map(this.mapEvent);
  }

  listUnits(gameId: string): Unit[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM units WHERE game_id = ? ORDER BY nation_code, name')
        .all(gameId) as Row[]
    ).map(this.mapUnit);
  }

  createUnit(
    gameId: string,
    input: Omit<Unit, 'id' | 'gameId' | 'createdAt' | 'experience'>,
  ): Unit {
    this.assertGame(gameId);
    if (!this.catalog.nations.has(input.nationCode)) {
      throw new AppError(400, 'UNKNOWN_NATION', 'The unit nation does not exist.');
    }
    const unit: Unit = {
      ...input,
      id: randomUUID(),
      gameId,
      experience: 0,
      createdAt: now(),
    };
    this.database
      .prepare(
        `INSERT INTO units (
          id, game_id, name, unit_type, nation_code, region_id, centroid,
          strength, organization, experience, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        unit.id,
        unit.gameId,
        unit.name,
        unit.unitType,
        unit.nationCode,
        unit.regionId,
        JSON.stringify(unit.centroid),
        unit.strength,
        unit.organization,
        unit.experience,
        unit.createdAt,
      );
    return unit;
  }

  moveUnit(gameId: string, unitId: string, regionId: string, centroid: [number, number]): Unit {
    const result = this.database
      .prepare('UPDATE units SET region_id = ?, centroid = ? WHERE id = ? AND game_id = ?')
      .run(regionId, JSON.stringify(centroid), unitId, gameId);
    this.expectChange(result, 'Unit');
    return this.getUnit(gameId, unitId);
  }

  deleteUnit(gameId: string, unitId: string) {
    const result = this.database
      .prepare('DELETE FROM units WHERE id = ? AND game_id = ?')
      .run(unitId, gameId);
    this.expectChange(result, 'Unit');
  }

  createChat(gameId: string, participantNationCodes: string[]): Chat {
    return this.chats.createChat(gameId, participantNationCodes);
  }

  setNextChatSpeaker(gameId: string, chatId: string, nationCode: string): Chat {
    return this.chats.setNextChatSpeaker(gameId, chatId, nationCode);
  }

  listChats(gameId: string): Chat[] {
    return this.chats.listChats(gameId);
  }

  getChat(gameId: string, chatId: string): Chat {
    return this.chats.getChat(gameId, chatId);
  }

  listChatMessages(gameId: string, chatId: string): ChatMessage[] {
    return this.chats.listChatMessages(gameId, chatId);
  }

  addChatMessage(...args: Parameters<ChatRepository['addChatMessage']>): ChatMessage {
    return this.chats.addChatMessage(...args);
  }

  commitTurn(
    gameId: string,
    expectedTurn: number,
    nextDate: string,
    states: Map<string, NationState>,
    generatedEvents: GeneratedEvent[],
    lawChanges: GeneratedLawChange[] = [],
    applyWorldChanges?: (events: GameEvent[]) => void,
  ): GameEvent[] {
    const timestamp = now();
    const persistedEvents: GameEvent[] = generatedEvents.map((event) => ({
      ...event,
      id: randomUUID(),
      gameId,
      gameDate: nextDate,
      createdAt: timestamp,
      turnNumber: expectedTurn,
    }));

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.database
        .prepare('SELECT turn_number FROM games WHERE id = ?')
        .get(gameId) as Row | undefined;
      if (!current) throw notFound('Game');
      if (asNumber(current.turn_number) !== expectedTurn) {
        throw new AppError(409, 'TURN_CONFLICT', 'The game changed while the turn was generated.');
      }

      const updateState = this.database.prepare(
        `UPDATE nation_states SET
          stability = ?, war_support = ?, manpower = ?, political_power = ?,
          treasury = ?, at_war = ?, occupied_regions = ?, population = ?, gdp = ?,
          happiness = ?, literacy = ?, unemployment = ?, inflation = ?,
          industrial_capacity = ?, health = ?, food_security = ?,
          population_growth_rate = ?, gdp_growth_rate = ?
        WHERE game_id = ? AND nation_code = ?`,
      );
      for (const state of states.values()) {
        updateState.run(
          state.stability,
          state.warSupport,
          state.manpower,
          state.politicalPower,
          state.treasury,
          state.atWar ? 1 : 0,
          JSON.stringify(state.occupiedRegions),
          state.population,
          state.gdp,
          state.happiness,
          state.literacy,
          state.unemployment,
          state.inflation,
          state.industrialCapacity,
          state.health,
          state.foodSecurity,
          state.populationGrowthRate,
          state.gdpGrowthRate,
          gameId,
          state.nationCode,
        );
      }

      const insertEvent = this.database.prepare(
        `INSERT INTO events (
          id, game_id, title, description, event_type, severity, affected_nations,
          state_changes, map_cue, subtype, icon_key, strategic_effect,
          game_date, created_at, turn_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of persistedEvents) {
        insertEvent.run(
          event.id,
          event.gameId,
          event.title,
          event.description,
          event.event_type,
          event.severity,
          JSON.stringify(event.affected_nations),
          JSON.stringify(event.state_changes),
          JSON.stringify(event.map_cue),
          event.subtype ?? 'general',
          event.icon_key ?? `event-${event.event_type}`,
          event.strategic_effect ? JSON.stringify(event.strategic_effect) : null,
          event.gameDate,
          event.createdAt,
          event.turnNumber,
        );
      }

      for (const change of lawChanges) {
        if (!this.catalog.nations.has(change.nation_code)) {
          throw new AppError(422, 'INVALID_AI_RESPONSE', 'A law referenced an unknown nation.');
        }
        if (change.operation === 'enact') {
          this.insertCountryLaw({
            gameId,
            nationCode: change.nation_code,
            titleFr: change.title_fr,
            titleEn: change.title_en,
            summaryFr: change.summary_fr,
            summaryEn: change.summary_en,
            category: change.category,
            enactedDate: nextDate,
            source: 'simulation',
          });
        } else {
          const result = this.database
            .prepare(
              `UPDATE country_laws SET status = 'repealed', repealed_date = ?
               WHERE id = ? AND game_id = ? AND nation_code = ? AND status = 'active'`,
            )
            .run(nextDate, change.law_id, gameId, change.nation_code);
          if (Number(result.changes) === 0) {
            throw new AppError(
              422,
              'INVALID_AI_RESPONSE',
              'A repealed law was not active in the referenced nation.',
            );
          }
        }
      }

      applyWorldChanges?.(persistedEvents);

      this.database
        .prepare(
          `UPDATE actions SET status = 'completed', effect_status = 'applied'
           WHERE game_id = ? AND status = 'pending'`,
        )
        .run(gameId);
      this.database
        .prepare(
          `UPDATE games SET current_date = ?, turn_number = ?, world_revision = world_revision + 1,
           updated_at = ? WHERE id = ?`,
        )
        .run(nextDate, expectedTurn + 1, timestamp, gameId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return persistedEvents;
  }

  getLlmSettings(editable: boolean): LlmSettingsPublic {
    return this.llm.getLlmSettings(editable);
  }

  getLlmSettingsPrivate() {
    return this.llm.getLlmSettingsPrivate();
  }

  saveLlmSettings(input: LlmSettingsInput) {
    return this.llm.saveLlmSettings(input);
  }

  importLegacyLlmSettings(settings: {
    provider: string;
    apiUrl: string;
    apiKey: string;
    model: string;
  }) {
    return this.llm.importLegacyLlmSettings(settings);
  }

  createLlmCall(input: Parameters<LlmRepository['createLlmCall']>[0]) {
    return this.llm.createLlmCall(input);
  }

  updateLlmCallPhase(id: string, phase: LlmCallPhase) {
    return this.llm.updateLlmCallPhase(id, phase);
  }

  completeLlmCall(id: string, usage: LlmTokenUsage | null) {
    return this.llm.completeLlmCall(id, usage);
  }

  failLlmCall(id: string, errorCode: string) {
    return this.llm.failLlmCall(id, errorCode);
  }

  markInterruptedLlmCalls() {
    return this.llm.markInterruptedLlmCalls();
  }

  listLlmCalls(options: Parameters<LlmRepository['listLlmCalls']>[0]) {
    return this.llm.listLlmCalls(options);
  }

  private initializeCountryProfiles() {
    const games = this.database
      .prepare('SELECT id, games.current_date FROM games ORDER BY created_at')
      .all() as Row[];
    if (!games.length) return;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updateState = this.database.prepare(
        `UPDATE nation_states SET
          population = ?, gdp = ?, happiness = ?, literacy = ?, unemployment = ?,
          inflation = ?, industrial_capacity = ?, health = ?, food_security = ?,
          population_growth_rate = ?, gdp_growth_rate = ?, profile_version = ?
         WHERE game_id = ? AND nation_code = ? AND profile_version < ?`,
      );
      for (const game of games) {
        const gameId = asString(game.id);
        const gameDate = asString(game.current_date);
        for (const [nationCode, baseline] of this.catalog.countryBaselines) {
          updateState.run(
            baseline.population,
            baseline.gdp,
            baseline.happiness,
            baseline.literacy,
            baseline.unemployment,
            baseline.inflation,
            baseline.industrialCapacity,
            baseline.health,
            baseline.foodSecurity,
            baseline.populationGrowthRate,
            baseline.gdpGrowthRate,
            baseline.version,
            gameId,
            nationCode,
            baseline.version,
          );
        }
        this.seedHistoricalLaws(gameId, gameDate);
        const legacyLaws = this.database
          .prepare(
            `SELECT actions.* FROM actions
             WHERE game_id = ? AND action_type = 'law'
             AND NOT EXISTS (
               SELECT 1 FROM country_laws WHERE source_action_id = actions.id
             )`,
          )
          .all(gameId) as Row[];
        for (const row of legacyLaws) {
          const title = asString(row.action_text);
          this.insertCountryLaw({
            gameId,
            nationCode: asString(row.nation_code),
            titleFr: title,
            titleEn: title,
            summaryFr: asString(row.ai_response),
            summaryEn: asString(row.ai_response),
            category: 'other',
            enactedDate: gameDate,
            source: 'player',
            sourceActionId: asString(row.id),
          });
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private seedHistoricalLaws(
    gameId: string,
    enactedDate: string,
    baselines: ReadonlyMap<string, CountryBaseline> = this.catalog.countryBaselines,
  ) {
    const existing = new Set(
      (
        this.database
          .prepare(
            `SELECT DISTINCT nation_code FROM country_laws
             WHERE game_id = ? AND source = 'historical'`,
          )
          .all(gameId) as Row[]
      ).map((row) => asString(row.nation_code)),
    );
    for (const [nationCode, baseline] of baselines) {
      if (existing.has(nationCode)) continue;
      for (const law of baseline.laws) {
        this.insertCountryLaw({
          gameId,
          nationCode,
          titleFr: law.titleFr,
          titleEn: law.titleEn,
          summaryFr: law.summaryFr,
          summaryEn: law.summaryEn,
          category: law.category,
          enactedDate,
          source: 'historical',
        });
      }
    }
  }

  private insertCountryLaw(input: {
    gameId: string;
    nationCode: string;
    titleFr: string;
    titleEn: string;
    summaryFr: string;
    summaryEn: string;
    category: CountryLaw['category'];
    enactedDate: string;
    source: CountryLaw['source'];
    sourceActionId?: string;
  }) {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO country_laws (
          id, game_id, nation_code, title_fr, title_en, summary_fr, summary_en,
          category, enacted_date, status, repealed_date, source, source_action_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
      )
      .run(
        id,
        input.gameId,
        input.nationCode,
        input.titleFr,
        input.titleEn,
        input.summaryFr,
        input.summaryEn,
        input.category,
        input.enactedDate,
        input.source,
        input.sourceActionId ?? null,
      );
    return id;
  }

  private toCountryIndicators(state: NationState): CountrySummary['indicators'] {
    return {
      stability: state.stability,
      warSupport: state.warSupport,
      manpower: state.manpower,
      politicalPower: state.politicalPower,
      treasury: state.treasury,
      atWar: state.atWar,
      population: state.population,
      gdp: state.gdp,
      gdpPerCapita: state.population > 0 ? (state.gdp * 1_000_000) / state.population : 0,
      happiness: state.happiness,
      literacy: state.literacy,
      unemployment: state.unemployment,
      inflation: state.inflation,
      industrialCapacity: state.industrialCapacity,
      health: state.health,
      foodSecurity: state.foodSecurity,
    };
  }

  private mapCountryLaw(row: Row, language: 'fr' | 'en'): CountryLaw {
    return {
      id: asString(row.id),
      nationCode: asString(row.nation_code),
      title: asString(language === 'en' ? row.title_en : row.title_fr),
      summary: asString(language === 'en' ? row.summary_en : row.summary_fr),
      category: asString(row.category) as CountryLaw['category'],
      enactedDate: asString(row.enacted_date),
      status: asString(row.status) as CountryLaw['status'],
      repealedDate: row.repealed_date === null ? null : asString(row.repealed_date),
      source: asString(row.source) as CountryLaw['source'],
    };
  }

  private getUnit(gameId: string, unitId: string): Unit {
    const row = this.database
      .prepare('SELECT * FROM units WHERE id = ? AND game_id = ?')
      .get(unitId, gameId) as Row | undefined;
    if (!row) throw notFound('Unit');
    return this.mapUnit(row);
  }

  private assertGame(gameId: string) {
    if (!this.database.prepare('SELECT 1 FROM games WHERE id = ?').get(gameId)) {
      throw notFound('Game');
    }
  }

  private expectChange(result: StatementResultingChanges, resource: string) {
    if (Number(result.changes) === 0) throw notFound(resource);
  }

  private assertPreviewRevision(
    gameId: string,
    effects: WorldEffect[],
    previewWorldRevision: number | null,
  ) {
    if (effects.length === 0) return;
    const currentRevision = this.getWorldRevision(gameId);
    if (previewWorldRevision === null || previewWorldRevision !== currentRevision) {
      throw new AppError(
        409,
        'WORLD_REVISION_CONFLICT',
        'The world changed after this action was previewed. Preview the effects again.',
      );
    }
  }

  private persistedNation(
    gameId: string,
    nationCode: string,
    language: CatalogLanguage,
  ): Nation | null {
    const row = this.database
      .prepare(
        `SELECT gp.*, ns.population, ns.manpower,
                COALESCE((
                  SELECT holder_name FROM game_office_holders goh
                  WHERE goh.game_id = gp.game_id AND goh.nation_code = gp.nation_code
                  ORDER BY is_primary DESC, role LIMIT 1
                ), '') AS leader_name,
                COALESCE((
                  SELECT CASE WHEN ? = 'fr' THEN title_fr ELSE title_en END
                  FROM game_office_holders goh
                  WHERE goh.game_id = gp.game_id AND goh.nation_code = gp.nation_code
                  ORDER BY is_primary DESC, role LIMIT 1
                ), '') AS leader_title
         FROM game_polities gp
         JOIN nation_states ns ON ns.game_id = gp.game_id AND ns.nation_code = gp.nation_code
         WHERE gp.game_id = ? AND gp.nation_code = ?`,
      )
      .get(language, gameId, nationCode) as Row | undefined;
    if (!row) return null;
    return {
      code: nationCode,
      name: asString(language === 'fr' ? row.name_fr : row.name_en),
      capital:
        row.capital_en === null
          ? undefined
          : asString(language === 'fr' ? row.capital_fr : row.capital_en),
      ideology: asString(row.ideology),
      is_major_power: asBoolean(row.is_major_power),
      color: asString(row.color),
      population: asNumber(row.population),
      manpower: asNumber(row.manpower),
      military_strength: asBoolean(row.is_major_power) ? 75 : 35,
      has_territory: true,
      leader_name: asString(row.leader_name) || undefined,
      leader_title: asString(row.leader_title) || undefined,
    };
  }

  private listOfficeHolders(gameId: string, nationCode: string, language: CatalogLanguage) {
    return (
      this.database
        .prepare(
          `SELECT * FROM game_office_holders
           WHERE game_id = ? AND nation_code = ? ORDER BY is_primary DESC, role`,
        )
        .all(gameId, nationCode) as Row[]
    ).map((row) => ({
      id: asString(row.holder_id),
      nationCode: asString(row.nation_code),
      role: asString(row.role) as 'head_of_state' | 'head_of_government',
      title: asString(language === 'fr' ? row.title_fr : row.title_en),
      name: asString(row.holder_name),
      termStart: asString(row.term_start),
      termEnd: row.term_end === null ? null : asString(row.term_end),
      source: asString(row.source) as 'wikidata' | 'curated' | 'simulation',
      primary: asBoolean(row.is_primary),
    }));
  }

  private mapGameSummary = (row: Row, language: CatalogLanguage = 'en'): GameSummary => {
    const playerNationCode = asString(row.player_nation_code);
    const playerNation =
      this.persistedNation(asString(row.id), playerNationCode, language) ??
      this.catalog.nations.get(playerNationCode);
    return {
      id: asString(row.id),
      name: asString(row.name),
      playerNationCode,
      playerNationName: playerNation
        ? asString(row.historical_baseline_mode) === 'historical_v1'
          ? playerNation.name
          : this.catalog.localizeNation(playerNation, language).name
        : playerNationCode,
      scenarioMode: asString(row.scenario_mode || 'historical') as ScenarioMode,
      difficulty: asString(row.difficulty || 'normal') as GameSummary['difficulty'],
      currentDate: asString(row.current_date),
      turnNumber: asNumber(row.turn_number),
      worldRevision: asNumber(row.world_revision),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  };

  private mapAction = (row: Row): Action => ({
    id: asString(row.id),
    gameId: asString(row.game_id),
    nationCode: asString(row.nation_code),
    actionText: asString(row.action_text),
    actionType: asString(row.action_type) as Action['actionType'],
    status: asString(row.status) as Action['status'],
    aiResponse: row.ai_response === null ? null : asString(row.ai_response),
    turnNumber: asNumber(row.turn_number),
    createdAt: asString(row.created_at),
    effects: parseJson<WorldEffect[]>(row.effects_json, []),
    effectStatus: asString(row.effect_status || 'queued') as Action['effectStatus'],
    previewWorldRevision: asNullableNumber(row.preview_world_revision),
  });

  private mapEvent = (row: Row): GameEvent => {
    const affectedNations = parseJson<string[]>(row.affected_nations, []);
    const storedCue = parseJson<GameEvent['map_cue']>(row.map_cue, {
      locations: [],
      camera: 'auto',
    });
    return {
      id: asString(row.id),
      gameId: asString(row.game_id),
      title: asString(row.title),
      description: asString(row.description),
      event_type: asString(row.event_type) as GameEvent['event_type'],
      severity: asString(row.severity) as GameEvent['severity'],
      affected_nations: affectedNations,
      state_changes: parseJson(row.state_changes, {}),
      map_cue:
        storedCue.locations.length > 0
          ? storedCue
          : affectedNations[0]
            ? {
                locations: [{ kind: 'nation', role: 'primary', nation_code: affectedNations[0] }],
                camera: 'nation',
              }
            : { locations: [{ kind: 'global', role: 'primary' }], camera: 'world' },
      subtype: asString(row.subtype || 'general'),
      icon_key: asString(row.icon_key || `event-${asString(row.event_type)}`),
      ...(row.strategic_effect
        ? {
            strategic_effect: parseJson<GameEvent['strategic_effect']>(
              row.strategic_effect,
              undefined,
            ),
          }
        : {}),
      gameDate: asString(row.game_date),
      createdAt: asString(row.created_at),
      turnNumber: asNumber(row.turn_number),
    };
  };

  private mapUnit = (row: Row): Unit => ({
    id: asString(row.id),
    gameId: asString(row.game_id),
    name: asString(row.name),
    unitType: asString(row.unit_type) as Unit['unitType'],
    nationCode: asString(row.nation_code),
    regionId: asString(row.region_id),
    centroid: parseJson(row.centroid, [0, 0]),
    strength: asNumber(row.strength),
    organization: asNumber(row.organization),
    experience: asNumber(row.experience),
    createdAt: asString(row.created_at),
  });

  private mapGameAiModels(value: unknown): GameAiModels {
    const parsed = parseJson<Partial<GameAiModels>>(value, {});
    return {
      actions: parsed.actions ?? null,
      advisor: parsed.advisor ?? null,
      diplomacy: parsed.diplomacy ?? null,
      turns: parsed.turns ?? null,
    };
  }

  private initializeCampaignWorlds() {
    const games = this.database.prepare('SELECT id FROM games').all() as Row[];
    if (!games.length) return;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const game of games) this.seedCampaignWorld(asString(game.id), now());
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private initializeDynamicCapitals() {
    this.database.exec(`
      UPDATE nation_states
      SET capital_feature_id = (
        SELECT map_features.id
        FROM map_features
        WHERE map_features.game_id = nation_states.game_id
          AND map_features.nation_code = nation_states.nation_code
          AND map_features.feature_type = 'capital'
        ORDER BY map_features.created_at
        LIMIT 1
      )
      WHERE capital_feature_id IS NULL;
    `);
  }

  private seedHistoricalSnapshot(
    gameId: string,
    snapshot: HistoricalWorldSnapshot,
    timestamp: string,
  ) {
    const english = this.historical.resolve(snapshot.date, 'en');
    const french = this.historical.resolve(snapshot.date, 'fr');
    const frenchByCode = new Map(french.polities.map((polity) => [polity.code, polity]));
    const insertPolity = this.database.prepare(
      `INSERT INTO game_polities (
        game_id, nation_code, name_en, name_fr, capital_en, capital_fr, capital_region_id,
        ideology, government_type, is_major_power, color, active_from, active_to,
        data_quality, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertOffice = this.database.prepare(
      `INSERT INTO game_office_holders (
        game_id, office_key, holder_id, nation_code, role, title_en, title_fr,
        holder_name, term_start, term_end, source, is_primary, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertContinuity = this.database.prepare(
      `INSERT OR IGNORE INTO historical_continuity (
        game_id, entity_type, entity_id, continuity_status, diverged_at, reason, updated_at
      ) VALUES (?, ?, ?, 'historical', NULL, NULL, ?)`,
    );
    for (const polity of english.polities) {
      const localized = frenchByCode.get(polity.code) ?? polity;
      insertPolity.run(
        gameId,
        polity.code,
        polity.name,
        localized.name,
        polity.capital,
        localized.capital,
        polity.capitalRegionId,
        polity.ideology,
        polity.governmentType,
        polity.isMajorPower ? 1 : 0,
        polity.color,
        polity.activeFrom,
        polity.activeTo,
        polity.dataQuality,
        timestamp,
        timestamp,
      );
      insertContinuity.run(gameId, 'polity', polity.code, timestamp);
      if (polity.capitalRegionId) {
        insertContinuity.run(gameId, 'capital', polity.code, timestamp);
        const feature = this.database
          .prepare(
            `SELECT id FROM map_features WHERE game_id = ? AND region_id = ?
             ORDER BY feature_type = 'capital' DESC, rowid LIMIT 1`,
          )
          .get(gameId, polity.capitalRegionId) as Row | undefined;
        if (feature) {
          this.database
            .prepare('UPDATE map_features SET nation_code = ? WHERE id = ? AND game_id = ?')
            .run(polity.code, asString(feature.id), gameId);
          this.database
            .prepare(
              `UPDATE nation_states SET capital_feature_id = ?, capital_status = 'established'
               WHERE game_id = ? AND nation_code = ?`,
            )
            .run(asString(feature.id), gameId, polity.code);
        }
      }
      const localizedOffices = new Map(
        (localized.officeHolders ?? []).map((holder) => [holder.id, holder]),
      );
      for (const holder of polity.officeHolders) {
        const localizedHolder = localizedOffices.get(holder.id) ?? holder;
        const officeKey = `${polity.code}:${holder.role}`;
        insertOffice.run(
          gameId,
          officeKey,
          holder.id,
          polity.code,
          holder.role,
          holder.title,
          localizedHolder.title,
          holder.name,
          holder.termStart,
          holder.termEnd,
          holder.source,
          holder.primary ? 1 : 0,
          timestamp,
        );
        insertContinuity.run(gameId, 'office', officeKey, timestamp);
      }
    }
    for (const regionId of snapshot.regionOwners.keys()) {
      insertContinuity.run(gameId, 'region', regionId, timestamp);
    }
  }

  private seedCampaignWorld(
    gameId: string,
    timestamp: string,
    historicalOwners?: ReadonlyMap<string, string | null>,
    historicalStatuses?: HistoricalWorldSnapshot['regionStatuses'],
  ) {
    const insertRegion = this.database.prepare(
      `INSERT OR IGNORE INTO game_regions (
        game_id, region_id, name, owner_nation_code, controller_nation_code,
        claim_nation_codes, territorial_status, administering_nation_code,
        region_type, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const region of this.catalog.regions.regions) {
      const owner = historicalOwners?.get(region.id) ?? region.nation_code ?? null;
      const status = historicalStatuses?.get(region.id);
      insertRegion.run(
        gameId,
        region.id,
        region.name,
        owner,
        owner,
        JSON.stringify(status?.claimNationCodes ?? []),
        status?.status ?? null,
        status?.administeringNationCode ?? null,
        owner ? 'land' : 'ocean',
        timestamp,
      );
    }
    const featureCount = this.database
      .prepare('SELECT COUNT(*) AS count FROM map_features WHERE game_id = ?')
      .get(gameId) as Row;
    if (asNumber(featureCount.count) === 0) {
      const insertFeature = this.database.prepare(
        `INSERT INTO map_features (
          id, game_id, name, feature_type, region_id, nation_code, color, symbol,
          created_at, updated_at, coords_x, coords_y
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const city of this.catalog.cities) {
        const featureType = String(city.type).toLowerCase().includes('capital')
          ? 'capital'
          : 'city';
        insertFeature.run(
          randomUUID(),
          gameId,
          city.name,
          featureType,
          city.region_id,
          city.nation_code,
          '#f5c451',
          featureType === 'capital' ? '★' : '■',
          timestamp,
          timestamp,
          city.coords[0],
          city.coords[1],
        );
      }
    }
  }
}

export type { LlmCallRecord } from './llm-repository.js';
export type RepositoryCatalog = Pick<Catalog, 'nations' | 'listNations'>;
export type { Nation };
