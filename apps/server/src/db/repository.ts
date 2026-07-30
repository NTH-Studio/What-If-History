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
  LlmCallStatus,
  LlmCallType,
  LlmProviderName,
  LlmSettingsInput,
  LlmSettingsPublic,
  LlmTokenUsage,
  Nation,
  NationState,
  ScenarioMode,
  UpdateActionInput,
  UpdateGameConfigInput,
  Unit,
} from '@what-if-history/contracts';
import { createStartingUnits } from '@what-if-history/core';
import { AppError, notFound } from '../errors.js';
import type { Catalog, CatalogLanguage } from '../catalog.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const asBoolean = (value: unknown) => Number(value) === 1;
const asString = (value: unknown) => String(value ?? '');
const asNumber = (value: unknown) => Number(value ?? 0);
const asNullableNumber = (value: unknown) => (value === null ? null : Number(value));
const historicalWorldContext =
  'Historical 1936 start. Europe is on the brink of tension as ideologies clash.';
const parseJson = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(asString(value)) as T;
  } catch {
    return fallback;
  }
};

export class Repository {
  constructor(
    readonly database: DatabaseSync,
    private readonly catalog: Catalog,
  ) {
    this.initializeCountryProfiles();
    this.initializeCampaignWorlds();
  }

  createGame(input: CreateGameInput, language: CatalogLanguage = 'en'): Game {
    const nation = this.catalog.nations.get(input.nationCode);
    if (!nation) throw new AppError(400, 'UNKNOWN_NATION', 'The selected nation does not exist.');

    const id = randomUUID();
    const timestamp = now();
    const localizedNation = this.catalog.localizeNation(nation, language);
    const name = input.name ?? `${localizedNation.name} — ${input.startDate}`;
    const scenarioMode = input.scenario?.mode ?? 'historical';
    const worldContext =
      input.scenario?.mode === 'custom' ? input.scenario.premise : historicalWorldContext;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO games (
            id, name, player_nation_code, current_date, turn_number,
            world_context, simulation_rules, scenario_mode, difficulty, ai_models,
            preset_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, '{}', ?, ?, ?)`,
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
      for (const catalogNation of this.catalog.nations.values()) {
        const baseline = this.catalog.countryBaselines.get(catalogNation.code)!;
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
      this.seedHistoricalLaws(id, input.startDate);
      this.seedCampaignWorld(id, timestamp);

      const insertUnit = this.database.prepare(
        `INSERT INTO units (
          id, game_id, name, unit_type, nation_code, region_id, centroid,
          strength, organization, experience, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const unit of createStartingUnits(id, timestamp, randomUUID)) {
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
    const playerNation = this.catalog.nations.get(playerNationCode);
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
      playerNation: this.catalog.localizeNation(playerNation, language),
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
    return [...this.catalog.nations.values()]
      .map((catalogNation) => {
        const nation = this.catalog.localizeNation(catalogNation, language);
        const state = states.get(nation.code);
        const baseline = this.catalog.countryBaselines.get(nation.code);
        if (!state || !baseline) {
          throw new AppError(
            500,
            'COUNTRY_STATE_MISSING',
            `Country state missing: ${nation.code}.`,
          );
        }
        return {
          code: nation.code,
          name: nation.name,
          capital: nation.capital ?? null,
          leaderName: nation.leader_name ?? null,
          ideology: nation.ideology,
          governmentType: baseline.governmentType,
          isMajorPower: nation.is_major_power,
          color: nation.color,
          indicators: this.toCountryIndicators(state),
          activeLawCount: lawCounts.get(nation.code) ?? 0,
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
    const nation = this.catalog.nations.get(nationCode)!;
    const baseline = this.catalog.countryBaselines.get(nationCode)!;
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
      leaderTitle: nation.leader_title ?? null,
      militaryStrength: nation.military_strength ?? 0,
      occupiedRegions: state.occupiedRegions,
      laws,
      recentEvents,
      unitCount: asNumber(unitCount),
      dataQuality: 'estimated',
      baselineDate: baseline.baselineDate,
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
    };
    this.database
      .prepare(
        `INSERT INTO actions (
          id, game_id, nation_code, action_text, action_type, status,
          ai_response, turn_number, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return action;
  }

  createPromulgatedLaw(gameId: string, actionText: string, reason: string): Action {
    const game = this.getGame(gameId);
    const action: Action = {
      id: randomUUID(),
      gameId,
      nationCode: game.playerNationCode,
      actionText,
      actionType: 'law',
      status: 'pending',
      aiResponse: reason,
      turnNumber: game.turnNumber,
      createdAt: now(),
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO actions (
            id, game_id, nation_code, action_text, action_type, status,
            ai_response, turn_number, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
      this.insertCountryLaw({
        gameId,
        nationCode: game.playerNationCode,
        titleFr: actionText,
        titleEn: actionText,
        summaryFr: reason,
        summaryEn: reason,
        category: 'other',
        enactedDate: game.currentDate,
        source: 'player',
        sourceActionId: action.id,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
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
    this.database
      .prepare('UPDATE actions SET action_text = ?, action_type = ? WHERE id = ? AND game_id = ?')
      .run(
        input.actionText ?? asString(current.action_text),
        input.actionType ?? asString(current.action_type),
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
    this.assertGame(gameId);
    const uniqueCodes = [...new Set(participantNationCodes)];
    const nations = uniqueCodes.map((code) => this.catalog.nations.get(code));
    if (!nations.length || nations.some((nation) => !nation)) {
      throw new AppError(400, 'UNKNOWN_NATION', 'A target nation does not exist.');
    }
    const targetNationCode = uniqueCodes[0]!;
    const nation = nations[0]!;
    const chat: Chat = {
      id: randomUUID(),
      gameId,
      targetNationCode,
      targetNationName: nation.name,
      participants: nations.map((participant) => ({
        nationCode: participant!.code,
        nationName: participant!.name,
      })),
      nextSpeakerNationCode: targetNationCode,
      status: 'active',
      createdAt: now(),
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO chats (
            id, game_id, target_nation_code, next_speaker_nation_code, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chat.id,
          chat.gameId,
          chat.targetNationCode,
          chat.nextSpeakerNationCode,
          chat.status,
          chat.createdAt,
        );
      const insertParticipant = this.database.prepare(
        'INSERT INTO chat_participants (chat_id, nation_code, sort_order) VALUES (?, ?, ?)',
      );
      uniqueCodes.forEach((code, index) => insertParticipant.run(chat.id, code, index));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return chat;
  }

  setNextChatSpeaker(gameId: string, chatId: string, nationCode: string): Chat {
    const chat = this.getChat(gameId, chatId);
    if (!chat.participants.some((participant) => participant.nationCode === nationCode)) {
      throw new AppError(400, 'NOT_CHAT_PARTICIPANT', 'The nation is not part of this chat.');
    }
    this.database
      .prepare('UPDATE chats SET next_speaker_nation_code = ? WHERE id = ? AND game_id = ?')
      .run(nationCode, chatId, gameId);
    return this.getChat(gameId, chatId);
  }

  listChats(gameId: string): Chat[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM chats WHERE game_id = ? ORDER BY created_at DESC')
        .all(gameId) as Row[]
    ).map((row) => this.mapChat(row));
  }

  getChat(gameId: string, chatId: string): Chat {
    const row = this.database
      .prepare('SELECT * FROM chats WHERE id = ? AND game_id = ?')
      .get(chatId, gameId) as Row | undefined;
    if (!row) throw notFound('Chat');
    return this.mapChat(row);
  }

  listChatMessages(gameId: string, chatId: string): ChatMessage[] {
    this.getChat(gameId, chatId);
    return (
      this.database
        .prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at')
        .all(chatId) as Row[]
    ).map(this.mapChatMessage);
  }

  addChatMessage(
    chat: Chat,
    senderNation: string,
    senderName: string,
    leaderName: string,
    messageText: string,
    gameDate: string,
  ): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      chatId: chat.id,
      senderNation,
      senderName,
      leaderName,
      messageText,
      gameDate,
      createdAt: now(),
    };
    this.database
      .prepare(
        `INSERT INTO chat_messages (
          id, chat_id, sender_nation, sender_name, leader_name,
          message_text, game_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.chatId,
        message.senderNation,
        message.senderName,
        message.leaderName,
        message.messageText,
        message.gameDate,
        message.createdAt,
      );
    return message;
  }

  commitTurn(
    gameId: string,
    expectedTurn: number,
    nextDate: string,
    states: Map<string, NationState>,
    generatedEvents: GeneratedEvent[],
    lawChanges: GeneratedLawChange[] = [],
    applyWorldChanges?: () => void,
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
          state_changes, map_cue, game_date, created_at, turn_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

      applyWorldChanges?.();

      this.database
        .prepare("UPDATE actions SET status = 'completed' WHERE game_id = ? AND status = 'pending'")
        .run(gameId);
      this.database
        .prepare('UPDATE games SET current_date = ?, turn_number = ?, updated_at = ? WHERE id = ?')
        .run(nextDate, expectedTurn + 1, timestamp, gameId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return persistedEvents;
  }

  getLlmSettings(editable: boolean): LlmSettingsPublic {
    const row = this.database.prepare('SELECT * FROM llm_settings WHERE id = 1').get() as
      Row | undefined;
    if (!row) {
      return {
        provider: 'lm-studio',
        apiUrl: 'http://127.0.0.1:1234/v1',
        model: 'qwen/qwen3.5-9b',
        hasApiKey: false,
        editable,
      };
    }
    return {
      provider: asString(row.provider) as LlmSettingsPublic['provider'],
      apiUrl: asString(row.api_url),
      model: asString(row.model),
      hasApiKey: asString(row.api_key).length > 0,
      editable,
    };
  }

  getLlmSettingsPrivate() {
    const row = this.database.prepare('SELECT * FROM llm_settings WHERE id = 1').get() as
      Row | undefined;
    return row
      ? {
          provider: asString(row.provider) as LlmSettingsInput['provider'],
          apiUrl: asString(row.api_url),
          apiKey: asString(row.api_key),
          model: asString(row.model),
        }
      : {
          provider: 'lm-studio' as const,
          apiUrl: 'http://127.0.0.1:1234/v1',
          apiKey: '',
          model: 'qwen/qwen3.5-9b',
        };
  }

  saveLlmSettings(input: LlmSettingsInput) {
    const existing = this.getLlmSettingsPrivate();
    const apiKey = input.clearApiKey ? '' : (input.apiKey ?? existing.apiKey);
    this.database
      .prepare(
        `INSERT INTO llm_settings (
          id, provider, api_url, api_key, model, imported_legacy, updated_at
        ) VALUES (1, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          api_url = excluded.api_url,
          api_key = excluded.api_key,
          model = excluded.model,
          updated_at = excluded.updated_at`,
      )
      .run(input.provider, input.apiUrl, apiKey, input.model, now());
  }

  importLegacyLlmSettings(settings: {
    provider: string;
    apiUrl: string;
    apiKey: string;
    model: string;
  }) {
    const count = this.database.prepare('SELECT COUNT(*) AS count FROM llm_settings').get() as Row;
    if (asNumber(count.count) > 0) return false;
    this.database
      .prepare(
        `INSERT INTO llm_settings (
          id, provider, api_url, api_key, model, imported_legacy, updated_at
        ) VALUES (1, ?, ?, ?, ?, 1, ?)`,
      )
      .run(settings.provider, settings.apiUrl, settings.apiKey, settings.model, now());
    return true;
  }

  createLlmCall(input: {
    id: string;
    gameId: string | null;
    gameName: string | null;
    requestId: string;
    clientId: string;
    type: LlmCallType;
    provider: LlmProviderName;
    model: string;
  }): LlmCallRecord {
    const startedAt = now();
    this.database
      .prepare(
        `INSERT INTO llm_calls (
          id, game_id, game_name, request_id, client_id, call_type, provider, model,
          phase, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'preparing', 'running', ?)`,
      )
      .run(
        input.id,
        input.gameId,
        input.gameName,
        input.requestId,
        input.clientId,
        input.type,
        input.provider,
        input.model,
        startedAt,
      );
    return this.getLlmCall(input.id);
  }

  updateLlmCallPhase(id: string, phase: LlmCallPhase): LlmCallRecord {
    const result = this.database
      .prepare("UPDATE llm_calls SET phase = ? WHERE id = ? AND status = 'running'")
      .run(phase, id);
    this.expectChange(result, 'LLM call');
    return this.getLlmCall(id);
  }

  completeLlmCall(id: string, usage: LlmTokenUsage | null): LlmCallRecord {
    const completedAt = now();
    const started = this.getLlmCall(id);
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(started.startedAt));
    const result = this.database
      .prepare(
        `UPDATE llm_calls
         SET phase = 'applying_result', status = 'succeeded', completed_at = ?, duration_ms = ?,
             input_tokens = ?, output_tokens = ?, total_tokens = ?, error_code = NULL
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        completedAt,
        durationMs,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.totalTokens ?? null,
        id,
      );
    this.expectChange(result, 'LLM call');
    this.pruneLlmCalls();
    return this.getLlmCall(id);
  }

  failLlmCall(id: string, errorCode: string): LlmCallRecord {
    const completedAt = now();
    const started = this.getLlmCall(id);
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(started.startedAt));
    const result = this.database
      .prepare(
        `UPDATE llm_calls
         SET status = 'failed', completed_at = ?, duration_ms = ?, error_code = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(completedAt, durationMs, errorCode, id);
    this.expectChange(result, 'LLM call');
    this.pruneLlmCalls();
    return this.getLlmCall(id);
  }

  markInterruptedLlmCalls(): LlmCallRecord[] {
    const running = this.database
      .prepare("SELECT id FROM llm_calls WHERE status = 'running'")
      .all() as Row[];
    return running.map((row) => this.failLlmCall(asString(row.id), 'SERVER_RESTARTED'));
  }

  listLlmCalls(options: { gameId?: string; limit: number }): LlmCallRecord[] {
    const gameFilter = options.gameId ? ' AND game_id = ?' : '';
    const parameters = options.gameId ? [options.gameId] : [];
    const active = this.database
      .prepare(
        `SELECT * FROM llm_calls
         WHERE status = 'running'${gameFilter}
         ORDER BY started_at DESC, rowid DESC`,
      )
      .all(...parameters) as Row[];
    const completed = this.database
      .prepare(
        `SELECT * FROM llm_calls
         WHERE status != 'running'${gameFilter}
         ORDER BY completed_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(...parameters, Math.min(100, Math.max(1, options.limit))) as Row[];
    return [...active, ...completed].map(this.mapLlmCall);
  }

  private getLlmCall(id: string): LlmCallRecord {
    const row = this.database.prepare('SELECT * FROM llm_calls WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) throw notFound('LLM call');
    return this.mapLlmCall(row);
  }

  private pruneLlmCalls() {
    this.database
      .prepare(
        `DELETE FROM llm_calls
         WHERE status != 'running'
           AND id NOT IN (
             SELECT id FROM llm_calls
             WHERE status != 'running'
             ORDER BY completed_at DESC, rowid DESC
             LIMIT 100
           )`,
      )
      .run();
  }

  private initializeCountryProfiles() {
    const games = this.database
      .prepare('SELECT id, current_date FROM games ORDER BY created_at')
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

  private seedHistoricalLaws(gameId: string, enactedDate: string) {
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
    for (const [nationCode, baseline] of this.catalog.countryBaselines) {
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

  private mapGameSummary = (row: Row, language: CatalogLanguage = 'en'): GameSummary => {
    const playerNationCode = asString(row.player_nation_code);
    const playerNation = this.catalog.nations.get(playerNationCode);
    return {
      id: asString(row.id),
      name: asString(row.name),
      playerNationCode,
      playerNationName: playerNation
        ? this.catalog.localizeNation(playerNation, language).name
        : playerNationCode,
      scenarioMode: asString(row.scenario_mode || 'historical') as ScenarioMode,
      difficulty: asString(row.difficulty || 'normal') as GameSummary['difficulty'],
      currentDate: asString(row.current_date),
      turnNumber: asNumber(row.turn_number),
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

  private mapChat = (row: Row): Chat => {
    const targetNationCode = asString(row.target_nation_code);
    const participantRows = this.database
      .prepare(
        'SELECT nation_code FROM chat_participants WHERE chat_id = ? ORDER BY sort_order, nation_code',
      )
      .all(asString(row.id)) as Row[];
    const participantCodes = participantRows.length
      ? participantRows.map((participant) => asString(participant.nation_code))
      : [targetNationCode];
    return {
      id: asString(row.id),
      gameId: asString(row.game_id),
      targetNationCode,
      targetNationName: this.catalog.nations.get(targetNationCode)?.name ?? targetNationCode,
      participants: participantCodes.map((nationCode) => ({
        nationCode,
        nationName: this.catalog.nations.get(nationCode)?.name ?? nationCode,
      })),
      nextSpeakerNationCode:
        row.next_speaker_nation_code === null || row.next_speaker_nation_code === undefined
          ? null
          : asString(row.next_speaker_nation_code),
      status: asString(row.status) as Chat['status'],
      createdAt: asString(row.created_at),
    };
  };

  private mapChatMessage = (row: Row): ChatMessage => ({
    id: asString(row.id),
    chatId: asString(row.chat_id),
    senderNation: asString(row.sender_nation),
    senderName: asString(row.sender_name),
    leaderName: asString(row.leader_name),
    messageText: asString(row.message_text),
    gameDate: asString(row.game_date),
    createdAt: asString(row.created_at),
  });

  private mapLlmCall = (row: Row): LlmCallRecord => ({
    id: asString(row.id),
    gameId: row.game_id === null ? null : asString(row.game_id),
    gameName: row.game_name === null ? null : asString(row.game_name),
    requestId: asString(row.request_id),
    clientId: asString(row.client_id),
    type: asString(row.call_type) as LlmCallType,
    provider: asString(row.provider) as LlmProviderName,
    model: asString(row.model),
    phase: asString(row.phase) as LlmCallPhase,
    status: asString(row.status) as LlmCallStatus,
    startedAt: asString(row.started_at),
    completedAt: row.completed_at === null ? null : asString(row.completed_at),
    durationMs: asNullableNumber(row.duration_ms),
    usage:
      row.input_tokens === null || row.output_tokens === null || row.total_tokens === null
        ? null
        : {
            inputTokens: asNumber(row.input_tokens),
            outputTokens: asNumber(row.output_tokens),
            totalTokens: asNumber(row.total_tokens),
          },
    errorCode: row.error_code === null ? null : asString(row.error_code),
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

  private seedCampaignWorld(gameId: string, timestamp: string) {
    const insertRegion = this.database.prepare(
      `INSERT OR IGNORE INTO game_regions (
        game_id, region_id, name, owner_nation_code, region_type, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const region of this.catalog.regions.regions) {
      insertRegion.run(
        gameId,
        region.id,
        region.name,
        region.nation_code ?? null,
        region.nation_code ? 'land' : 'ocean',
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

export interface LlmCallRecord {
  id: string;
  gameId: string | null;
  gameName: string | null;
  requestId: string;
  clientId: string;
  type: LlmCallType;
  provider: LlmProviderName;
  model: string;
  phase: LlmCallPhase;
  status: LlmCallStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  usage: LlmTokenUsage | null;
  errorCode: string | null;
}

export type RepositoryCatalog = Pick<Catalog, 'nations' | 'listNations'>;
export type { Nation };
