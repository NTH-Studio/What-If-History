import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue, StatementResultingChanges } from 'node:sqlite';
import type {
  AdvisorMessage,
  Consolidation,
  ConsolidationSettings,
  CreateMapFeatureInput,
  CreatePresetInput,
  EventMapCue,
  GameEvent,
  GameRegion,
  GameSnapshot,
  GeneratedMapFeatureChange,
  GeneratedUnitChange,
  MapFeature,
  Preset,
  PresetDetail,
  PresetHelper,
  PresetPrompt,
  RegionChange,
  TimeJump,
  UpdateMapFeatureInput,
  UpdatePresetInput,
} from '@what-if-history/contracts';
import { AppError, notFound } from '../errors.js';
import type { Catalog } from '../catalog.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const text = (value: unknown) => String(value ?? '');
const number = (value: unknown) => Number(value ?? 0);
const nullableText = (value: unknown) =>
  value === null || value === undefined ? null : text(value);
const sqlValue = (value: unknown): SQLInputValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return text(value);
};
const parseJson = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(text(value)) as T;
  } catch {
    return fallback;
  }
};

interface SnapshotPayload {
  game: Row;
  nationStates: Row[];
  units: Row[];
  actions: Row[];
  events: Row[];
  laws: Row[];
  regions: Row[];
  features: Row[];
  consolidations: Row[];
  mutations: Row[];
}

export class AdvancedRepository {
  constructor(
    readonly database: DatabaseSync,
    private readonly catalog: Catalog,
  ) {}

  listAdvisorMessages(gameId: string): AdvisorMessage[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM advisor_messages WHERE game_id = ? ORDER BY created_at')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      role: text(row.role) as AdvisorMessage['role'],
      messageText: text(row.message_text),
      createdAt: text(row.created_at),
    }));
  }

  addAdvisorExchange(gameId: string, question: string, response: string): AdvisorMessage[] {
    this.assertGame(gameId);
    const timestamp = now();
    const messages: AdvisorMessage[] = [
      { id: randomUUID(), gameId, role: 'user', messageText: question, createdAt: timestamp },
      {
        id: randomUUID(),
        gameId,
        role: 'advisor',
        messageText: response,
        createdAt: new Date(Date.now() + 1).toISOString(),
      },
    ];
    const insert = this.database.prepare(
      `INSERT INTO advisor_messages (id, game_id, role, message_text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const message of messages) {
        insert.run(
          message.id,
          message.gameId,
          message.role,
          message.messageText,
          message.createdAt,
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return messages;
  }

  clearAdvisorMessages(gameId: string) {
    this.assertGame(gameId);
    this.database.prepare('DELETE FROM advisor_messages WHERE game_id = ?').run(gameId);
  }

  startTurnRun(gameId: string, turnNumber: number, jump: TimeJump) {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO turn_runs (
          id, game_id, turn_number, strategy, jump_payload, status, started_at
        ) VALUES (?, ?, ?, ?, ?, 'preparing', ?)`,
      )
      .run(id, gameId, turnNumber, jump.strategy ?? 'fixed', JSON.stringify(jump), now());
    return id;
  }

  updateTurnRun(
    id: string,
    status: 'generating' | 'applying' | 'completed' | 'failed',
    options: { snapshotId?: string; errorCode?: string } = {},
  ) {
    this.database
      .prepare(
        `UPDATE turn_runs SET status = ?, snapshot_id = COALESCE(?, snapshot_id),
         error_code = ?, completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE NULL END
         WHERE id = ?`,
      )
      .run(status, options.snapshotId ?? null, options.errorCode ?? null, status, now(), id);
  }

  listTurnRuns(gameId: string) {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM turn_runs WHERE game_id = ? ORDER BY started_at DESC LIMIT 50')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      turnNumber: number(row.turn_number),
      strategy: text(row.strategy),
      jump: parseJson(row.jump_payload, {}),
      status: text(row.status),
      snapshotId: nullableText(row.snapshot_id),
      errorCode: nullableText(row.error_code),
      startedAt: text(row.started_at),
      completedAt: nullableText(row.completed_at),
    }));
  }

  createSnapshot(gameId: string, label: string): GameSnapshot {
    const game = this.database.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as
      Row | undefined;
    if (!game) throw notFound('Game');
    const payload: SnapshotPayload = {
      game,
      nationStates: this.rows('nation_states', gameId),
      units: this.rows('units', gameId),
      actions: this.rows('actions', gameId),
      events: this.rows('events', gameId),
      laws: this.rows('country_laws', gameId),
      regions: this.rows('game_regions', gameId),
      features: this.rows('map_features', gameId),
      consolidations: this.rows('consolidations', gameId),
      mutations: this.rows('world_mutations', gameId),
    };
    const snapshot: GameSnapshot = {
      id: randomUUID(),
      gameId,
      turnNumber: number(game.turn_number),
      gameDate: text(game.current_date),
      label,
      createdAt: now(),
    };
    this.database
      .prepare(
        `INSERT INTO game_snapshots (
          id, game_id, turn_number, game_date, label, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.gameId,
        snapshot.turnNumber,
        snapshot.gameDate,
        snapshot.label,
        JSON.stringify(payload),
        snapshot.createdAt,
      );
    return snapshot;
  }

  listSnapshots(gameId: string): GameSnapshot[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare(
          `SELECT id, game_id, turn_number, game_date, label, created_at
           FROM game_snapshots WHERE game_id = ? ORDER BY turn_number DESC, created_at DESC`,
        )
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      turnNumber: number(row.turn_number),
      gameDate: text(row.game_date),
      label: text(row.label),
      createdAt: text(row.created_at),
    }));
  }

  restoreSnapshot(gameId: string, snapshotId: string) {
    const row = this.database
      .prepare('SELECT payload FROM game_snapshots WHERE id = ? AND game_id = ?')
      .get(snapshotId, gameId) as Row | undefined;
    if (!row) throw notFound('Snapshot');
    const payload = parseJson<SnapshotPayload | null>(row.payload, null);
    if (!payload?.game || text(payload.game.id) !== gameId) {
      throw new AppError(422, 'INVALID_SNAPSHOT', 'The snapshot payload is invalid.');
    }
    const deleteTables = [
      ['events', payload.events],
      ['country_laws', payload.laws],
      ['actions', payload.actions],
      ['units', payload.units],
      ['nation_states', payload.nationStates],
      ['game_regions', payload.regions],
      ['map_features', payload.features],
      ['consolidations', payload.consolidations],
      ['world_mutations', payload.mutations],
    ] as const;
    const insertTables: Array<[string, Row[]]> = [
      ['nation_states', payload.nationStates],
      ['actions', payload.actions],
      ['country_laws', payload.laws],
      ['events', payload.events],
      ['units', payload.units],
      ['game_regions', payload.regions],
      ['map_features', payload.features],
      ['consolidations', payload.consolidations],
      ['world_mutations', payload.mutations],
    ];
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const [table] of deleteTables) {
        this.database.prepare(`DELETE FROM ${table} WHERE game_id = ?`).run(gameId);
      }
      for (const [table, rows] of insertTables) this.insertRows(table, rows);
      this.database
        .prepare(
          `UPDATE games SET current_date = ?, turn_number = ?, world_context = ?,
           simulation_rules = ?, difficulty = ?, ai_models = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          sqlValue(payload.game.current_date),
          sqlValue(payload.game.turn_number),
          sqlValue(payload.game.world_context),
          sqlValue(payload.game.simulation_rules),
          sqlValue(payload.game.difficulty),
          sqlValue(payload.game.ai_models),
          now(),
          gameId,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getConsolidationSettings(gameId: string): ConsolidationSettings {
    const row = this.database
      .prepare(
        `SELECT consolidation_start_round, consolidation_chunk_size
         FROM games WHERE id = ?`,
      )
      .get(gameId) as Row | undefined;
    if (!row) throw notFound('Game');
    return {
      startRound: number(row.consolidation_start_round),
      chunkSize: number(row.consolidation_chunk_size),
    };
  }

  updateConsolidationSettings(gameId: string, settings: ConsolidationSettings) {
    const result = this.database
      .prepare(
        `UPDATE games SET consolidation_start_round = ?, consolidation_chunk_size = ?,
         updated_at = ? WHERE id = ?`,
      )
      .run(settings.startRound, settings.chunkSize, now(), gameId);
    this.expectChange(result, 'Game');
    return settings;
  }

  listConsolidations(gameId: string): Consolidation[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM consolidations WHERE game_id = ? ORDER BY end_turn DESC')
        .all(gameId) as Row[]
    ).map(this.mapConsolidation);
  }

  consolidationContext(gameId: string) {
    return this.listConsolidations(gameId)
      .filter((item) => item.status === 'current')
      .slice(0, 8)
      .reverse()
      .map((item) => `Tours ${item.startTurn}–${item.endTurn}: ${item.summary}`)
      .join('\n');
  }

  maybeCreateConsolidation(gameId: string, completedTurn: number) {
    const settings = this.getConsolidationSettings(gameId);
    if (
      completedTurn < settings.startRound ||
      (completedTurn - settings.startRound) % settings.chunkSize !== 0
    ) {
      return null;
    }
    const endTurn = completedTurn;
    const startTurn = Math.max(1, endTurn - settings.chunkSize + 1);
    const events = this.database
      .prepare(
        `SELECT game_date, title, description FROM events
         WHERE game_id = ? AND turn_number BETWEEN ? AND ?
         ORDER BY turn_number, created_at`,
      )
      .all(gameId, startTurn, endTurn) as Row[];
    if (!events.length) return null;
    const summary = events
      .map(
        (event) =>
          `${text(event.game_date)} — ${text(event.title)}: ${text(event.description).slice(0, 360)}`,
      )
      .join('\n');
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO consolidations (
          id, game_id, start_turn, end_turn, summary, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'current', ?, ?)
        ON CONFLICT(game_id, start_turn, end_turn) DO UPDATE SET
          summary = excluded.summary, status = 'current', updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), gameId, startTurn, endTurn, summary, timestamp, timestamp);
    return this.listConsolidations(gameId).find(
      (item) => item.startTurn === startTurn && item.endTurn === endTurn,
    );
  }

  updateConsolidation(gameId: string, id: string, summary: string) {
    const result = this.database
      .prepare(
        `UPDATE consolidations SET summary = ?, status = 'current', updated_at = ?
         WHERE id = ? AND game_id = ?`,
      )
      .run(summary, now(), id, gameId);
    this.expectChange(result, 'Consolidation');
    return this.listConsolidations(gameId).find((item) => item.id === id)!;
  }

  deleteConsolidation(gameId: string, id: string) {
    this.expectChange(
      this.database
        .prepare('DELETE FROM consolidations WHERE id = ? AND game_id = ?')
        .run(id, gameId),
      'Consolidation',
    );
  }

  updateEvent(
    gameId: string,
    eventId: string,
    input: Partial<
      Pick<GameEvent, 'title' | 'description' | 'event_type' | 'severity' | 'map_cue'>
    >,
  ) {
    const row = this.database
      .prepare('SELECT * FROM events WHERE id = ? AND game_id = ?')
      .get(eventId, gameId) as Row | undefined;
    if (!row) throw notFound('Event');
    if (input.map_cue) this.assertEventMapCue(gameId, input.map_cue);
    this.database
      .prepare(
        `UPDATE events SET title = ?, description = ?, event_type = ?, severity = ?, map_cue = ?
         WHERE id = ? AND game_id = ?`,
      )
      .run(
        sqlValue(input.title ?? row.title),
        sqlValue(input.description ?? row.description),
        sqlValue(input.event_type ?? row.event_type),
        sqlValue(input.severity ?? row.severity),
        input.map_cue ? JSON.stringify(input.map_cue) : sqlValue(row.map_cue),
        eventId,
        gameId,
      );
    this.markConsolidationsStale(gameId, number(row.turn_number));
    return this.mapEvent(
      this.database.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as Row,
    );
  }

  deleteEvent(gameId: string, eventId: string) {
    const row = this.database
      .prepare('SELECT turn_number FROM events WHERE id = ? AND game_id = ?')
      .get(eventId, gameId) as Row | undefined;
    if (!row) throw notFound('Event');
    this.database.prepare('DELETE FROM events WHERE id = ? AND game_id = ?').run(eventId, gameId);
    this.markConsolidationsStale(gameId, number(row.turn_number));
  }

  listRegions(gameId: string): GameRegion[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM game_regions WHERE game_id = ? ORDER BY name')
        .all(gameId) as Row[]
    ).map((row) => ({
      gameId: text(row.game_id),
      regionId: text(row.region_id),
      name: text(row.name),
      ownerNationCode: nullableText(row.owner_nation_code),
      regionType: text(row.region_type) as GameRegion['regionType'],
      updatedAt: text(row.updated_at),
    }));
  }

  updateRegion(
    gameId: string,
    regionId: string,
    input: { ownerNationCode?: string | null; regionType?: GameRegion['regionType'] },
    turnNumber?: number,
  ) {
    const existing = this.database
      .prepare('SELECT * FROM game_regions WHERE game_id = ? AND region_id = ?')
      .get(gameId, regionId) as Row | undefined;
    if (!existing) throw notFound('Region');
    if (input.ownerNationCode && !this.catalog.nations.has(input.ownerNationCode)) {
      throw new AppError(400, 'UNKNOWN_NATION', 'The region owner does not exist.');
    }
    const owner =
      input.ownerNationCode === undefined
        ? nullableText(existing.owner_nation_code)
        : input.ownerNationCode;
    const regionType = input.regionType ?? (text(existing.region_type) as GameRegion['regionType']);
    this.database
      .prepare(
        `UPDATE game_regions SET owner_nation_code = ?, region_type = ?, updated_at = ?
         WHERE game_id = ? AND region_id = ?`,
      )
      .run(owner, regionType, now(), gameId, regionId);
    this.recordMutation(
      gameId,
      turnNumber ?? this.currentTurn(gameId),
      'region',
      regionId,
      existing,
      {
        ...existing,
        owner_nation_code: owner,
        region_type: regionType,
      },
    );
    return this.listRegions(gameId).find((region) => region.regionId === regionId)!;
  }

  listMapFeatures(gameId: string): MapFeature[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM map_features WHERE game_id = ? ORDER BY feature_type, name')
        .all(gameId) as Row[]
    ).map(this.mapFeature);
  }

  createMapFeature(gameId: string, input: CreateMapFeatureInput, turnNumber?: number): MapFeature {
    this.assertRegion(gameId, input.regionId);
    if (input.nationCode && !this.catalog.nations.has(input.nationCode)) {
      throw new AppError(400, 'UNKNOWN_NATION', 'The feature nation does not exist.');
    }
    const timestamp = now();
    const feature: MapFeature = {
      id: randomUUID(),
      gameId,
      name: input.name,
      featureType: input.featureType,
      regionId: input.regionId,
      nationCode: input.nationCode ?? null,
      coords: input.coords,
      color: input.color ?? '#f5c451',
      symbol: input.symbol ?? '•',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.database
      .prepare(
        `INSERT INTO map_features (
          id, game_id, name, feature_type, region_id, nation_code, color, symbol,
          created_at, updated_at, coords_x, coords_y
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        feature.id,
        feature.gameId,
        feature.name,
        feature.featureType,
        feature.regionId,
        feature.nationCode,
        feature.color,
        feature.symbol,
        feature.createdAt,
        feature.updatedAt,
        feature.coords[0],
        feature.coords[1],
      );
    this.recordMutation(
      gameId,
      turnNumber ?? this.currentTurn(gameId),
      'feature',
      feature.id,
      null,
      feature,
    );
    return feature;
  }

  updateMapFeature(
    gameId: string,
    id: string,
    input: UpdateMapFeatureInput,
    turnNumber?: number,
  ): MapFeature {
    const row = this.database
      .prepare('SELECT * FROM map_features WHERE id = ? AND game_id = ?')
      .get(id, gameId) as Row | undefined;
    if (!row) throw notFound('Map feature');
    if (input.regionId) this.assertRegion(gameId, input.regionId);
    if (input.nationCode && !this.catalog.nations.has(input.nationCode)) {
      throw new AppError(400, 'UNKNOWN_NATION', 'The feature nation does not exist.');
    }
    this.database
      .prepare(
        `UPDATE map_features SET name = ?, feature_type = ?, region_id = ?, nation_code = ?,
         color = ?, symbol = ?, coords_x = ?, coords_y = ?, updated_at = ?
         WHERE id = ? AND game_id = ?`,
      )
      .run(
        sqlValue(input.name ?? row.name),
        sqlValue(input.featureType ?? row.feature_type),
        sqlValue(input.regionId ?? row.region_id),
        sqlValue(input.nationCode === undefined ? row.nation_code : input.nationCode),
        sqlValue(input.color ?? row.color),
        sqlValue(input.symbol ?? row.symbol),
        sqlValue(input.coords?.[0] ?? row.coords_x),
        sqlValue(input.coords?.[1] ?? row.coords_y),
        now(),
        id,
        gameId,
      );
    const updated = this.mapFeature(
      this.database.prepare('SELECT * FROM map_features WHERE id = ?').get(id) as Row,
    );
    this.recordMutation(
      gameId,
      turnNumber ?? this.currentTurn(gameId),
      'feature',
      id,
      row,
      updated,
    );
    return updated;
  }

  deleteMapFeature(gameId: string, id: string, turnNumber?: number) {
    const existing = this.database
      .prepare('SELECT * FROM map_features WHERE id = ? AND game_id = ?')
      .get(id, gameId) as Row | undefined;
    if (!existing) throw notFound('Map feature');
    this.expectChange(
      this.database
        .prepare('DELETE FROM map_features WHERE id = ? AND game_id = ?')
        .run(id, gameId),
      'Map feature',
    );
    this.recordMutation(
      gameId,
      turnNumber ?? this.currentTurn(gameId),
      'feature',
      id,
      existing,
      null,
    );
  }

  applyWorldChanges(
    gameId: string,
    turnNumber: number,
    regionChanges: RegionChange[],
    unitChanges: GeneratedUnitChange[],
    featureChanges: GeneratedMapFeatureChange[],
  ) {
    for (const change of regionChanges) {
      this.updateRegion(
        gameId,
        change.region_id,
        {
          ...(change.owner_nation_code !== undefined
            ? { ownerNationCode: change.owner_nation_code }
            : {}),
          ...(change.region_type ? { regionType: change.region_type } : {}),
        },
        turnNumber,
      );
    }
    for (const change of unitChanges) this.applyUnitChange(gameId, turnNumber, change);
    for (const change of featureChanges) this.applyFeatureChange(gameId, turnNumber, change);
  }

  listWorldMutations(gameId: string) {
    this.assertGame(gameId);
    return this.database
      .prepare(
        `SELECT id, turn_number, mutation_type, target_id, before_value, after_value, created_at
         FROM world_mutations WHERE game_id = ? ORDER BY turn_number DESC, created_at DESC`,
      )
      .all(gameId);
  }

  listPresets(): Preset[] {
    return (
      this.database
        .prepare("SELECT * FROM presets WHERE status != 'archived' ORDER BY updated_at DESC")
        .all() as Row[]
    ).map(this.mapPreset);
  }

  getPreset(id: string): PresetDetail {
    const row = this.database.prepare('SELECT * FROM presets WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) throw notFound('Preset');
    return {
      ...this.mapPreset(row),
      aiModels: {
        actions: null,
        advisor: null,
        diplomacy: null,
        turns: null,
        ...parseJson(row.ai_models, {}),
      },
      prompts: (
        this.database
          .prepare('SELECT * FROM preset_prompts WHERE preset_id = ? ORDER BY mechanic')
          .all(id) as Row[]
      ).map((prompt) => ({
        mechanic: text(prompt.mechanic) as PresetPrompt['mechanic'],
        mode: text(prompt.mode) as PresetPrompt['mode'],
        template: text(prompt.template),
      })),
      helpers: (
        this.database
          .prepare('SELECT * FROM preset_helpers WHERE preset_id = ? ORDER BY helper_key')
          .all(id) as Row[]
      ).map((helper) => ({
        key: text(helper.helper_key),
        label: text(helper.label),
        source: text(helper.source) as PresetHelper['source'],
        format: text(helper.format) as PresetHelper['format'],
      })),
    };
  }

  createPreset(input: CreatePresetInput): PresetDetail {
    const timestamp = now();
    const id = randomUUID();
    const normalized = this.normalizePresetInput(input);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO presets (
            id, title, summary, category, tags, start_date, world_context, simulation_rules,
            recommended_difficulty, playable_nation_codes, ai_models, status, current_version,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?)`,
        )
        .run(
          id,
          normalized.title,
          normalized.summary,
          normalized.category,
          JSON.stringify(normalized.tags),
          normalized.startDate,
          normalized.worldContext,
          normalized.simulationRules,
          normalized.recommendedDifficulty,
          JSON.stringify(normalized.playableNationCodes),
          JSON.stringify(normalized.aiModels),
          timestamp,
          timestamp,
        );
      this.replacePresetStudio(id, normalized.prompts, normalized.helpers);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getPreset(id);
  }

  updatePreset(id: string, input: UpdatePresetInput): PresetDetail {
    const current = this.getPreset(id);
    if (current.status === 'archived') {
      throw new AppError(409, 'PRESET_ARCHIVED', 'An archived preset cannot be edited.');
    }
    const normalized = this.normalizePresetInput({
      title: input.title ?? current.title,
      summary: input.summary ?? current.summary,
      category: input.category ?? current.category,
      tags: input.tags ?? current.tags,
      startDate: input.startDate ?? current.startDate,
      worldContext: input.worldContext ?? current.worldContext,
      simulationRules: input.simulationRules ?? current.simulationRules,
      recommendedDifficulty: input.recommendedDifficulty ?? current.recommendedDifficulty,
      playableNationCodes: input.playableNationCodes ?? current.playableNationCodes,
      aiModels: input.aiModels ?? current.aiModels,
      prompts: input.prompts ?? current.prompts,
      helpers: input.helpers ?? current.helpers,
    });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `UPDATE presets SET title = ?, summary = ?, category = ?, tags = ?, start_date = ?,
           world_context = ?, simulation_rules = ?, recommended_difficulty = ?,
           playable_nation_codes = ?, ai_models = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          normalized.title,
          normalized.summary,
          normalized.category,
          JSON.stringify(normalized.tags),
          normalized.startDate,
          normalized.worldContext,
          normalized.simulationRules,
          normalized.recommendedDifficulty,
          JSON.stringify(normalized.playableNationCodes),
          JSON.stringify(normalized.aiModels),
          now(),
          id,
        );
      this.replacePresetStudio(id, normalized.prompts, normalized.helpers);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getPreset(id);
  }

  publishPreset(id: string) {
    const preset = this.getPreset(id);
    const version = preset.currentVersion + 1;
    const timestamp = now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO preset_versions (id, preset_id, version, snapshot, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), id, version, JSON.stringify(preset), timestamp);
      this.database
        .prepare(
          `UPDATE presets SET status = 'published', current_version = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(version, timestamp, id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getPreset(id);
  }

  archivePreset(id: string) {
    this.expectChange(
      this.database
        .prepare("UPDATE presets SET status = 'archived', updated_at = ? WHERE id = ?")
        .run(now(), id),
      'Preset',
    );
  }

  duplicatePreset(id: string) {
    const preset = this.getPreset(id);
    return this.createPreset({
      ...preset,
      title: `${preset.title} — copie`,
      summary: preset.summary,
    });
  }

  previewPreset(id: string, gameId?: string) {
    const preset = this.getPreset(id);
    const game = gameId
      ? (this.database.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Row | undefined)
      : undefined;
    const values: Record<PresetHelper['source'], unknown> = {
      'game.date': game?.current_date ?? preset.startDate,
      'game.turn': game?.turn_number ?? 1,
      'game.player': game?.player_nation_code ?? preset.playableNationCodes[0],
      'game.world': game?.world_context ?? preset.worldContext,
      'game.rules': game?.simulation_rules ?? preset.simulationRules,
    };
    const helpers = Object.fromEntries(
      preset.helpers.map((helper) => [
        helper.key,
        helper.format === 'json'
          ? JSON.stringify(values[helper.source])
          : text(values[helper.source]),
      ]),
    );
    const prompts = preset.prompts.map((prompt) => ({
      ...prompt,
      preview: Object.entries(helpers).reduce(
        (result, [key, value]) => result.replaceAll(`\${${key}}`, value),
        prompt.template,
      ),
    }));
    return { helpers, prompts };
  }

  private normalizePresetInput(input: CreatePresetInput) {
    const playableNationCodes = input.playableNationCodes?.length
      ? [...new Set(input.playableNationCodes)]
      : ['FRA'];
    for (const code of playableNationCodes) {
      if (!this.catalog.nations.has(code)) {
        throw new AppError(400, 'UNKNOWN_NATION', `Unknown playable nation: ${code}.`);
      }
    }
    return {
      title: input.title,
      summary: input.summary ?? '',
      category: input.category ?? 'custom',
      tags: [...new Set(input.tags ?? [])],
      startDate: input.startDate,
      worldContext: input.worldContext,
      simulationRules: input.simulationRules,
      recommendedDifficulty: input.recommendedDifficulty ?? 'normal',
      playableNationCodes,
      aiModels: {
        actions: null,
        advisor: null,
        diplomacy: null,
        turns: null,
        ...(input.aiModels ?? {}),
      },
      prompts: input.prompts ?? [],
      helpers: input.helpers ?? [],
    } satisfies Omit<PresetDetail, 'id' | 'status' | 'currentVersion' | 'createdAt' | 'updatedAt'>;
  }

  private replacePresetStudio(id: string, prompts: PresetPrompt[], helpers: PresetHelper[]) {
    this.database.prepare('DELETE FROM preset_prompts WHERE preset_id = ?').run(id);
    this.database.prepare('DELETE FROM preset_helpers WHERE preset_id = ?').run(id);
    const insertPrompt = this.database.prepare(
      `INSERT INTO preset_prompts (preset_id, mechanic, mode, template)
       VALUES (?, ?, ?, ?)`,
    );
    for (const prompt of prompts) {
      insertPrompt.run(id, prompt.mechanic, prompt.mode, prompt.template);
    }
    const insertHelper = this.database.prepare(
      `INSERT INTO preset_helpers (preset_id, helper_key, label, source, format)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const helper of helpers) {
      insertHelper.run(id, helper.key, helper.label, helper.source, helper.format);
    }
  }

  private applyUnitChange(gameId: string, turnNumber: number, change: GeneratedUnitChange) {
    if (change.operation === 'create') {
      this.assertRegion(gameId, change.region_id);
      if (!this.catalog.nations.has(change.nation_code)) {
        throw new AppError(422, 'INVALID_AI_RESPONSE', 'A unit referenced an unknown nation.');
      }
      const id = randomUUID();
      const coords = this.regionCoordinates(change.region_id);
      const value = {
        id,
        game_id: gameId,
        name: change.name,
        unit_type: change.unit_type,
        nation_code: change.nation_code,
        region_id: change.region_id,
        centroid: JSON.stringify(coords),
        strength: change.strength,
        organization: change.organization,
        experience: 0,
        created_at: now(),
      };
      this.insertRows('units', [value]);
      this.recordMutation(gameId, turnNumber, 'unit', id, null, value);
      return;
    }
    const row = this.database
      .prepare('SELECT * FROM units WHERE id = ? AND game_id = ?')
      .get(change.unit_id, gameId) as Row | undefined;
    if (!row)
      throw new AppError(422, 'INVALID_AI_RESPONSE', 'A unit change referenced an unknown unit.');
    if (change.operation === 'delete') {
      this.database
        .prepare('DELETE FROM units WHERE id = ? AND game_id = ?')
        .run(change.unit_id, gameId);
      this.recordMutation(gameId, turnNumber, 'unit', change.unit_id, row, null);
      return;
    }
    if (change.operation === 'move') {
      this.assertRegion(gameId, change.region_id);
      this.database
        .prepare('UPDATE units SET region_id = ?, centroid = ? WHERE id = ? AND game_id = ?')
        .run(
          change.region_id,
          JSON.stringify(this.regionCoordinates(change.region_id)),
          change.unit_id,
          gameId,
        );
    } else {
      this.database
        .prepare(
          `UPDATE units SET strength = ?, organization = ?, experience = ?
           WHERE id = ? AND game_id = ?`,
        )
        .run(
          sqlValue(change.strength ?? row.strength),
          sqlValue(change.organization ?? row.organization),
          sqlValue(change.experience ?? row.experience),
          change.unit_id,
          gameId,
        );
    }
    const updated = this.database
      .prepare('SELECT * FROM units WHERE id = ? AND game_id = ?')
      .get(change.unit_id, gameId) as Row;
    this.recordMutation(gameId, turnNumber, 'unit', change.unit_id, row, updated);
  }

  private applyFeatureChange(
    gameId: string,
    turnNumber: number,
    change: GeneratedMapFeatureChange,
  ) {
    if (change.operation === 'create') {
      this.createMapFeature(
        gameId,
        {
          name: change.name,
          featureType: change.feature_type,
          regionId: change.region_id,
          nationCode: change.nation_code,
          color: change.color,
          symbol: change.symbol,
          coords: this.regionCoordinates(change.region_id),
        },
        turnNumber,
      );
      return;
    }
    const existing = this.database
      .prepare('SELECT * FROM map_features WHERE id = ? AND game_id = ?')
      .get(change.feature_id, gameId) as Row | undefined;
    if (!existing) {
      throw new AppError(
        422,
        'INVALID_AI_RESPONSE',
        'A feature change referenced an unknown feature.',
      );
    }
    if (change.operation === 'delete') {
      this.deleteMapFeature(gameId, change.feature_id, turnNumber);
      return;
    }
    this.updateMapFeature(
      gameId,
      change.feature_id,
      {
        ...(change.name ? { name: change.name } : {}),
        ...(change.region_id ? { regionId: change.region_id } : {}),
        ...(change.nation_code !== undefined ? { nationCode: change.nation_code } : {}),
        ...(change.color ? { color: change.color } : {}),
        ...(change.symbol ? { symbol: change.symbol } : {}),
      },
      turnNumber,
    );
  }

  private regionCoordinates(regionId: string): [number, number] {
    const city = this.catalog.cities.find((candidate) => candidate.region_id === regionId);
    return city?.coords ?? [700, 300];
  }

  private currentTurn(gameId: string) {
    const row = this.database.prepare('SELECT turn_number FROM games WHERE id = ?').get(gameId) as
      Row | undefined;
    if (!row) throw notFound('Game');
    return number(row.turn_number);
  }

  private recordMutation(
    gameId: string,
    turnNumber: number,
    mutationType: string,
    targetId: string,
    before: unknown,
    after: unknown,
  ) {
    this.database
      .prepare(
        `INSERT INTO world_mutations (
          id, game_id, turn_number, mutation_type, target_id, before_value, after_value, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        gameId,
        turnNumber,
        mutationType,
        targetId,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        now(),
      );
  }

  private markConsolidationsStale(gameId: string, turnNumber: number) {
    this.database
      .prepare(
        `UPDATE consolidations SET status = 'stale', updated_at = ?
         WHERE game_id = ? AND start_turn <= ? AND end_turn >= ?`,
      )
      .run(now(), gameId, turnNumber, turnNumber);
  }

  private rows(table: string, gameId: string) {
    return this.database.prepare(`SELECT * FROM ${table} WHERE game_id = ?`).all(gameId) as Row[];
  }

  private insertRows(table: string, rows: Row[]) {
    if (!rows.length) return;
    const columns = Object.keys(rows[0]!);
    const statement = this.database.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    );
    for (const row of rows) {
      statement.run(...columns.map((column) => sqlValue(row[column] ?? null)));
    }
  }

  private assertGame(gameId: string) {
    if (!this.database.prepare('SELECT 1 FROM games WHERE id = ?').get(gameId)) {
      throw notFound('Game');
    }
  }

  private assertRegion(gameId: string, regionId: string) {
    if (
      !this.database
        .prepare('SELECT 1 FROM game_regions WHERE game_id = ? AND region_id = ?')
        .get(gameId, regionId)
    ) {
      throw notFound('Region');
    }
  }

  private assertEventMapCue(gameId: string, cue: EventMapCue) {
    for (const location of cue.locations) {
      if (location.kind === 'region') {
        this.assertRegion(gameId, location.region_id);
      } else if (
        location.kind === 'feature' &&
        !this.database
          .prepare('SELECT 1 FROM map_features WHERE id = ? AND game_id = ?')
          .get(location.feature_id, gameId)
      ) {
        throw notFound('Map feature');
      } else if (
        location.kind === 'unit' &&
        !this.database
          .prepare('SELECT 1 FROM units WHERE id = ? AND game_id = ?')
          .get(location.unit_id, gameId)
      ) {
        throw notFound('Unit');
      } else if (location.kind === 'nation' && !this.catalog.nations.has(location.nation_code)) {
        throw notFound('Nation');
      }
    }
  }

  private expectChange(result: StatementResultingChanges, resource: string) {
    if (number(result.changes) === 0) throw notFound(resource);
  }

  private mapConsolidation = (row: Row): Consolidation => ({
    id: text(row.id),
    gameId: text(row.game_id),
    startTurn: number(row.start_turn),
    endTurn: number(row.end_turn),
    summary: text(row.summary),
    status: text(row.status) as Consolidation['status'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  });

  private mapEvent = (row: Row): GameEvent => {
    const affectedNations = parseJson<string[]>(row.affected_nations, []);
    const storedCue = parseJson<GameEvent['map_cue']>(row.map_cue, {
      locations: [],
      camera: 'auto',
    });
    return {
      id: text(row.id),
      gameId: text(row.game_id),
      title: text(row.title),
      description: text(row.description),
      event_type: text(row.event_type) as GameEvent['event_type'],
      severity: text(row.severity) as GameEvent['severity'],
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
      gameDate: text(row.game_date),
      createdAt: text(row.created_at),
      turnNumber: number(row.turn_number),
    };
  };

  private mapFeature = (row: Row): MapFeature => ({
    id: text(row.id),
    gameId: text(row.game_id),
    name: text(row.name),
    featureType: text(row.feature_type) as MapFeature['featureType'],
    regionId: text(row.region_id),
    nationCode: nullableText(row.nation_code),
    color: text(row.color),
    symbol: text(row.symbol),
    coords: [number(row.coords_x), number(row.coords_y)],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  });

  private mapPreset = (row: Row): Preset => ({
    id: text(row.id),
    title: text(row.title),
    summary: text(row.summary),
    category: text(row.category) as Preset['category'],
    tags: parseJson(row.tags, []),
    startDate: text(row.start_date),
    worldContext: text(row.world_context),
    simulationRules: text(row.simulation_rules),
    recommendedDifficulty: text(row.recommended_difficulty) as Preset['recommendedDifficulty'],
    playableNationCodes: parseJson(row.playable_nation_codes, []),
    status: text(row.status) as Preset['status'],
    currentVersion: number(row.current_version),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  });
}
