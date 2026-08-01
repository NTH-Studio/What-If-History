import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue, StatementResultingChanges } from 'node:sqlite';
import type {
  Action,
  AppliedMutation,
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
  NationState,
  Preset,
  PresetDetail,
  PresetInitialWorld,
  RegionChange,
  TimeJump,
  TurnResult,
  UpdateMapFeatureInput,
  UpdatePresetInput,
  WorldEffect,
} from '@what-if-history/contracts';
import { AppError, notFound } from '../errors.js';
import type { Catalog } from '../catalog.js';
import { PresetRepository } from './preset-repository.js';
import { now, nullableText, number, parseJson, sqlValue, text, type Row } from './values.js';

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
  regionStates?: Row[];
  impactZones?: Row[];
  characters?: Row[];
  orders?: Row[];
  wars?: Row[];
  fronts?: Row[];
  contacts?: Row[];
  arsenals?: Row[];
  timeline?: Row[];
  polities?: Row[];
  officeHolders?: Row[];
  historicalContinuity?: Row[];
  historicalTransitions?: Row[];
}

interface MutationContext {
  source: AppliedMutation['source'];
  sourceActionId?: string;
  sourceEventId?: string;
  effect?: WorldEffect;
}

export class AdvancedRepository {
  private readonly presets: PresetRepository;

  constructor(
    readonly database: DatabaseSync,
    private readonly catalog: Catalog,
  ) {
    this.presets = new PresetRepository(database, catalog);
  }

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

  findCompletedTurnResult(gameId: string, idempotencyKey: string): TurnResult | null {
    const row = this.database
      .prepare(
        `SELECT result_json FROM turn_runs
         WHERE game_id = ? AND idempotency_key = ? AND status = 'completed'`,
      )
      .get(gameId, idempotencyKey) as Row | undefined;
    return row?.result_json ? parseJson<TurnResult>(row.result_json, null as never) : null;
  }

  startTurnRun(gameId: string, turnNumber: number, jump: TimeJump, idempotencyKey: string) {
    const existing = this.database
      .prepare('SELECT id FROM turn_runs WHERE game_id = ? AND idempotency_key = ?')
      .get(gameId, idempotencyKey) as Row | undefined;
    if (existing) {
      const id = text(existing.id);
      this.database
        .prepare(
          `UPDATE turn_runs SET turn_number = ?, strategy = ?, jump_payload = ?,
           status = 'preparing', snapshot_id = NULL, error_code = NULL, completed_at = NULL,
           generated_payload = NULL, schema_mode = NULL, repair_attempts = 0,
           mutation_count = 0, result_json = NULL, started_at = ?
           WHERE id = ?`,
        )
        .run(turnNumber, jump.strategy ?? 'fixed', JSON.stringify(jump), now(), id);
      return id;
    }
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO turn_runs (
          id, game_id, turn_number, strategy, jump_payload, status, idempotency_key, started_at
        ) VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?)`,
      )
      .run(
        id,
        gameId,
        turnNumber,
        jump.strategy ?? 'fixed',
        JSON.stringify(jump),
        idempotencyKey,
        now(),
      );
    return id;
  }

  completeTurnRunInTransaction(
    id: string,
    result: TurnResult,
    generatedPayload: unknown,
    schemaMode: string,
    repairAttempts: number,
  ) {
    this.database
      .prepare(
        `UPDATE turn_runs SET status = 'completed', generated_payload = ?, schema_mode = ?,
         repair_attempts = ?, mutation_count = ?, result_json = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(generatedPayload),
        schemaMode,
        repairAttempts,
        result.appliedMutations.length,
        JSON.stringify(result),
        now(),
        id,
      );
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
      regionStates: this.rows('region_states', gameId),
      impactZones: this.rows('impact_zones', gameId),
      characters: this.rows('characters', gameId),
      orders: this.rows('strategic_orders', gameId),
      wars: this.rows('wars', gameId),
      fronts: this.rows('fronts', gameId),
      contacts: this.rows('intel_contacts', gameId),
      arsenals: this.rows('strategic_arsenals', gameId),
      timeline: this.rows('timeline_entries', gameId),
      polities: this.rows('game_polities', gameId),
      officeHolders: this.rows('game_office_holders', gameId),
      historicalContinuity: this.rows('historical_continuity', gameId),
      historicalTransitions: this.rows('historical_transition_runs', gameId),
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
      ['timeline_entries', payload.timeline ?? []],
      ['historical_transition_runs', payload.historicalTransitions ?? []],
      ['historical_continuity', payload.historicalContinuity ?? []],
      ['game_office_holders', payload.officeHolders ?? []],
      ['game_polities', payload.polities ?? []],
      ['intel_contacts', payload.contacts ?? []],
      ['fronts', payload.fronts ?? []],
      ['wars', payload.wars ?? []],
      ['strategic_orders', payload.orders ?? []],
      ['impact_zones', payload.impactZones ?? []],
      ['characters', payload.characters ?? []],
      ['region_states', payload.regionStates ?? []],
      ['strategic_arsenals', payload.arsenals ?? []],
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
      ['game_polities', payload.polities ?? []],
      ['game_office_holders', payload.officeHolders ?? []],
      ['historical_continuity', payload.historicalContinuity ?? []],
      ['historical_transition_runs', payload.historicalTransitions ?? []],
      ['actions', payload.actions],
      ['country_laws', payload.laws],
      ['events', payload.events],
      ['units', payload.units],
      ['game_regions', payload.regions],
      ['map_features', payload.features],
      ['consolidations', payload.consolidations],
      ['world_mutations', payload.mutations],
      ['region_states', payload.regionStates ?? []],
      ['impact_zones', payload.impactZones ?? []],
      ['characters', payload.characters ?? []],
      ['strategic_orders', payload.orders ?? []],
      ['wars', payload.wars ?? []],
      ['fronts', payload.fronts ?? []],
      ['intel_contacts', payload.contacts ?? []],
      ['strategic_arsenals', payload.arsenals ?? []],
      ['timeline_entries', payload.timeline ?? []],
    ];
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const [table] of deleteTables) {
        this.database.prepare(`DELETE FROM ${table} WHERE game_id = ?`).run(gameId);
      }
      for (const [table, rows] of insertTables) this.insertRows(table, rows);
      this.database
        .prepare(
          `UPDATE game_regions SET controller_nation_code = owner_nation_code
           WHERE game_id = ? AND controller_nation_code IS NULL`,
        )
        .run(gameId);
      this.database
        .prepare(
          `UPDATE nation_states
           SET capital_feature_id = (
             SELECT map_features.id FROM map_features
             WHERE map_features.game_id = nation_states.game_id
               AND map_features.nation_code = nation_states.nation_code
               AND map_features.feature_type = 'capital'
             ORDER BY map_features.created_at
             LIMIT 1
           )
           WHERE game_id = ? AND capital_feature_id IS NULL`,
        )
        .run(gameId);
      this.database
        .prepare(
          `UPDATE games SET current_date = ?, turn_number = ?, world_context = ?,
           simulation_rules = ?, difficulty = ?, ai_models = ?,
           world_revision = world_revision + 1, updated_at = ? WHERE id = ?`,
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
      this.database
        .prepare(
          `UPDATE actions SET preview_world_revision = (
             SELECT world_revision FROM games WHERE id = ?
           ) WHERE game_id = ? AND status = 'pending' AND effects_json != '[]'`,
        )
        .run(gameId, gameId);
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
      controllerNationCode: nullableText(row.controller_nation_code),
      claimNationCodes: parseJson<string[]>(row.claim_nation_codes, []),
      territorialStatus: nullableText(row.territorial_status) as GameRegion['territorialStatus'],
      administeringNationCode: nullableText(row.administering_nation_code),
      regionType: text(row.region_type) as GameRegion['regionType'],
      updatedAt: text(row.updated_at),
    }));
  }

  updateRegion(
    gameId: string,
    regionId: string,
    input: {
      ownerNationCode?: string | null;
      controllerNationCode?: string | null;
      claimNationCodes?: string[];
      regionType?: GameRegion['regionType'];
    },
    turnNumber?: number,
    context: MutationContext = { source: turnNumber === undefined ? 'manual' : 'simulation' },
  ) {
    const existing = this.database
      .prepare('SELECT * FROM game_regions WHERE game_id = ? AND region_id = ?')
      .get(gameId, regionId) as Row | undefined;
    if (!existing) throw notFound('Region');
    if (input.ownerNationCode && !this.nationExistsForGame(gameId, input.ownerNationCode)) {
      throw new AppError(400, 'UNKNOWN_NATION', 'The region owner does not exist.');
    }
    if (
      input.controllerNationCode &&
      !this.nationExistsForGame(gameId, input.controllerNationCode)
    ) {
      throw new AppError(400, 'UNKNOWN_NATION', 'The region controller does not exist.');
    }
    for (const claim of input.claimNationCodes ?? []) {
      if (!this.nationExistsForGame(gameId, claim)) {
        throw new AppError(400, 'UNKNOWN_NATION', 'A region claimant does not exist.');
      }
    }
    const owner =
      input.ownerNationCode === undefined
        ? nullableText(existing.owner_nation_code)
        : input.ownerNationCode;
    const controller =
      input.controllerNationCode === undefined
        ? nullableText(existing.controller_nation_code)
        : input.controllerNationCode;
    const claims =
      input.claimNationCodes === undefined
        ? parseJson<string[]>(existing.claim_nation_codes, [])
        : [...new Set(input.claimNationCodes)];
    const regionType = input.regionType ?? (text(existing.region_type) as GameRegion['regionType']);
    this.database
      .prepare(
        `UPDATE game_regions SET owner_nation_code = ?, controller_nation_code = ?,
         claim_nation_codes = ?, region_type = ?, updated_at = ?
         WHERE game_id = ? AND region_id = ?`,
      )
      .run(owner, controller, JSON.stringify(claims), regionType, now(), gameId, regionId);
    if (
      owner !== nullableText(existing.owner_nation_code) ||
      controller !== nullableText(existing.controller_nation_code)
    ) {
      this.markHistoricalDivergence(
        gameId,
        'region',
        regionId,
        `Territorial state changed by ${context.source}.`,
      );
    }
    this.recordMutation(
      gameId,
      turnNumber ?? this.currentTurn(gameId),
      'region',
      regionId,
      existing,
      {
        ...existing,
        owner_nation_code: owner,
        controller_nation_code: controller,
        claim_nation_codes: JSON.stringify(claims),
        region_type: regionType,
      },
      context,
    );
    if (turnNumber === undefined) this.bumpWorldRevision(gameId);
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

  createMapFeature(
    gameId: string,
    input: CreateMapFeatureInput,
    turnNumber?: number,
    context: MutationContext = { source: turnNumber === undefined ? 'manual' : 'simulation' },
  ): MapFeature {
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
      context,
    );
    if (turnNumber === undefined) this.bumpWorldRevision(gameId);
    return feature;
  }

  updateMapFeature(
    gameId: string,
    id: string,
    input: UpdateMapFeatureInput,
    turnNumber?: number,
    context: MutationContext = { source: turnNumber === undefined ? 'manual' : 'simulation' },
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
      context,
    );
    if (turnNumber === undefined) this.bumpWorldRevision(gameId);
    return updated;
  }

  deleteMapFeature(
    gameId: string,
    id: string,
    turnNumber?: number,
    context: MutationContext = { source: turnNumber === undefined ? 'manual' : 'simulation' },
  ) {
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
      context,
    );
    if (turnNumber === undefined) this.bumpWorldRevision(gameId);
  }

  applyWorldChanges(
    gameId: string,
    turnNumber: number,
    regionChanges: RegionChange[],
    unitChanges: GeneratedUnitChange[],
    featureChanges: GeneratedMapFeatureChange[],
    sourceEventId?: string,
  ) {
    const simulationContext: MutationContext = {
      source: 'simulation',
      ...(sourceEventId ? { sourceEventId } : {}),
    };
    for (const change of regionChanges) {
      this.updateRegion(
        gameId,
        change.region_id,
        {
          ...(change.owner_nation_code !== undefined
            ? { ownerNationCode: change.owner_nation_code }
            : {}),
          ...(change.controller_nation_code !== undefined
            ? { controllerNationCode: change.controller_nation_code }
            : {}),
          ...(change.claim_nation_codes !== undefined
            ? { claimNationCodes: change.claim_nation_codes }
            : {}),
          ...(change.region_type ? { regionType: change.region_type } : {}),
        },
        turnNumber,
        simulationContext,
      );
    }
    for (const change of unitChanges) {
      this.applyUnitChange(gameId, turnNumber, change, simulationContext);
    }
    for (const change of featureChanges) {
      this.applyFeatureChange(gameId, turnNumber, change, simulationContext);
    }
  }

  validateQueuedActionRevisions(gameId: string, actions: Action[]) {
    const currentRevision = this.currentWorldRevision(gameId);
    const stale = actions.find(
      (action) =>
        action.effects.length > 0 &&
        action.previewWorldRevision !== null &&
        action.previewWorldRevision !== currentRevision,
    );
    if (stale) {
      throw new AppError(
        409,
        'WORLD_REVISION_CONFLICT',
        'A queued action was previewed against an older world revision.',
        [{ path: `actions.${stale.id}`, message: 'Preview the action effects again.' }],
      );
    }
  }

  applyActionEffects(gameId: string, turnNumber: number, actions: Action[]) {
    for (const action of actions) {
      for (const effect of action.effects) {
        this.applyWorldEffect(gameId, turnNumber, effect, {
          source: 'player_action',
          sourceActionId: action.id,
          effect,
        });
      }
    }
  }

  recordNationStateChanges(
    gameId: string,
    turnNumber: number,
    beforeStates: NationState[],
    afterStates: Map<string, NationState>,
    events: GameEvent[],
  ) {
    const beforeByNation = new Map(beforeStates.map((state) => [state.nationCode, state]));
    for (const event of events) {
      for (const nationCode of Object.keys(event.state_changes)) {
        const before = beforeByNation.get(nationCode);
        const after = afterStates.get(nationCode);
        if (!before || !after || JSON.stringify(before) === JSON.stringify(after)) continue;
        this.recordMutation(gameId, turnNumber, 'nation', nationCode, before, after, {
          source: 'simulation',
          sourceEventId: event.id,
        });
        beforeByNation.set(nationCode, after);
      }
    }
  }

  listWorldMutations(gameId: string): AppliedMutation[] {
    this.assertGame(gameId);
    return (
      this.database
        .prepare(
          `SELECT id, turn_number, mutation_source, source_action_id, source_event_id, mutation_type, target_id,
                before_value, after_value, world_revision, created_at
         FROM world_mutations WHERE game_id = ? ORDER BY turn_number DESC, created_at DESC`,
        )
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      turnNumber: number(row.turn_number),
      source: text(row.mutation_source || 'simulation') as AppliedMutation['source'],
      sourceActionId: nullableText(row.source_action_id),
      sourceEventId: nullableText(row.source_event_id),
      mutationType: text(row.mutation_type) as AppliedMutation['mutationType'],
      targetId: text(row.target_id),
      beforeValue: row.before_value === null ? null : parseJson(row.before_value, null),
      afterValue: row.after_value === null ? null : parseJson(row.after_value, null),
      worldRevision: number(row.world_revision),
      createdAt: text(row.created_at),
    }));
  }

  listPresets(): Preset[] {
    return this.presets.listPresets();
  }

  getPreset(id: string): PresetDetail {
    return this.presets.getPreset(id);
  }

  createPreset(input: CreatePresetInput): PresetDetail {
    return this.presets.createPreset(input);
  }

  updatePreset(id: string, input: UpdatePresetInput): PresetDetail {
    return this.presets.updatePreset(id, input);
  }

  publishPreset(id: string) {
    return this.presets.publishPreset(id);
  }

  archivePreset(id: string) {
    return this.presets.archivePreset(id);
  }

  duplicatePreset(id: string) {
    return this.presets.duplicatePreset(id);
  }

  previewPreset(id: string, gameId?: string) {
    return this.presets.previewPreset(id, gameId);
  }

  applyPresetInitialWorld(gameId: string, initialWorld: PresetInitialWorld) {
    if (!initialWorld.regions.length && !Object.keys(initialWorld.capitalRegionIds).length) return;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updateRegion = this.database.prepare(
        `UPDATE game_regions SET owner_nation_code = ?, controller_nation_code = ?,
         claim_nation_codes = ?, region_type = ?, updated_at = ?
         WHERE game_id = ? AND region_id = ?`,
      );
      for (const region of initialWorld.regions) {
        this.assertRegion(gameId, region.regionId);
        for (const code of [
          region.ownerNationCode,
          region.controllerNationCode,
          ...region.claimNationCodes,
        ]) {
          if (code && !this.nationExistsForGame(gameId, code)) {
            throw new AppError(400, 'UNKNOWN_NATION', `Unknown preset nation: ${code}.`);
          }
        }
        updateRegion.run(
          region.ownerNationCode,
          region.controllerNationCode,
          JSON.stringify(region.claimNationCodes),
          region.regionType,
          now(),
          gameId,
          region.regionId,
        );
        this.markHistoricalDivergence(
          gameId,
          'region',
          region.regionId,
          'The custom preset overrides the historical territory.',
        );
      }
      for (const [nationCode, regionId] of Object.entries(initialWorld.capitalRegionIds)) {
        if (!this.nationExistsForGame(gameId, nationCode)) {
          throw new AppError(400, 'UNKNOWN_NATION', `Unknown preset nation: ${nationCode}.`);
        }
        const feature = regionId
          ? (this.database
              .prepare(
                `SELECT id FROM map_features
                 WHERE game_id = ? AND region_id = ? ORDER BY feature_type = 'capital' DESC, rowid
                 LIMIT 1`,
              )
              .get(gameId, regionId) as Row | undefined)
          : undefined;
        this.database
          .prepare(
            `UPDATE nation_states SET capital_feature_id = ?, capital_status = ?
             WHERE game_id = ? AND nation_code = ?`,
          )
          .run(
            feature ? text(feature.id) : null,
            feature ? 'established' : 'lost',
            gameId,
            nationCode,
          );
        this.markHistoricalDivergence(
          gameId,
          'capital',
          nationCode,
          'The custom preset overrides the historical capital.',
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private applyWorldEffect(
    gameId: string,
    turnNumber: number,
    effect: WorldEffect,
    context: MutationContext,
  ) {
    if (effect.kind === 'territory') {
      const row = this.database
        .prepare('SELECT * FROM game_regions WHERE game_id = ? AND region_id = ?')
        .get(gameId, effect.regionId) as Row | undefined;
      if (!row) throw notFound('Region');
      const owner = nullableText(row.owner_nation_code);
      const claims = parseJson<string[]>(row.claim_nation_codes, []);
      if (effect.operation === 'cede') {
        this.updateRegion(
          gameId,
          effect.regionId,
          {
            ownerNationCode: effect.nationCode,
            controllerNationCode: effect.nationCode,
            claimNationCodes: claims.filter((code) => code !== owner && code !== effect.nationCode),
          },
          turnNumber,
          context,
        );
        this.updateCapitalAfterTerritoryEffect(
          gameId,
          turnNumber,
          effect.regionId,
          owner,
          effect,
          context,
        );
        return;
      }
      if (effect.operation === 'annex') {
        this.updateRegion(
          gameId,
          effect.regionId,
          {
            ownerNationCode: effect.nationCode,
            controllerNationCode: effect.nationCode,
            claimNationCodes:
              owner && owner !== effect.nationCode
                ? [...new Set([...claims, owner])].filter((code) => code !== effect.nationCode)
                : claims.filter((code) => code !== effect.nationCode),
          },
          turnNumber,
          context,
        );
        this.updateCapitalAfterTerritoryEffect(
          gameId,
          turnNumber,
          effect.regionId,
          owner,
          effect,
          context,
        );
        return;
      }
      if (effect.operation === 'occupy') {
        this.updateRegion(
          gameId,
          effect.regionId,
          { controllerNationCode: effect.nationCode },
          turnNumber,
          context,
        );
        this.updateCapitalOccupation(
          gameId,
          turnNumber,
          effect.regionId,
          effect.nationCode,
          context,
        );
        return;
      }
      if (effect.operation === 'liberate') {
        this.updateRegion(
          gameId,
          effect.regionId,
          { controllerNationCode: owner },
          turnNumber,
          context,
        );
        this.updateCapitalOccupation(gameId, turnNumber, effect.regionId, owner, context);
        return;
      }
      this.updateRegion(
        gameId,
        effect.regionId,
        {
          claimNationCodes:
            effect.operation === 'add_claim'
              ? [...new Set([...claims, effect.nationCode])]
              : claims.filter((code) => code !== effect.nationCode),
        },
        turnNumber,
        context,
      );
      return;
    }

    if (effect.kind === 'unit') {
      if (effect.operation === 'create') {
        this.applyUnitChange(
          gameId,
          turnNumber,
          {
            operation: 'create',
            name: effect.name,
            unit_type: effect.unitType,
            nation_code: effect.nationCode,
            region_id: effect.regionId,
            strength: effect.strength,
            organization: effect.organization,
          },
          context,
        );
      } else if (effect.operation === 'move') {
        this.applyUnitChange(
          gameId,
          turnNumber,
          { operation: 'move', unit_id: effect.unitId, region_id: effect.regionId },
          context,
        );
      } else if (effect.operation === 'update') {
        this.applyUnitChange(
          gameId,
          turnNumber,
          {
            operation: 'update',
            unit_id: effect.unitId,
            ...(effect.strength !== undefined ? { strength: effect.strength } : {}),
            ...(effect.organization !== undefined ? { organization: effect.organization } : {}),
            ...(effect.experience !== undefined ? { experience: effect.experience } : {}),
          },
          context,
        );
      } else {
        this.applyUnitChange(
          gameId,
          turnNumber,
          { operation: 'delete', unit_id: effect.unitId },
          context,
        );
      }
      return;
    }

    if (effect.kind === 'feature') {
      if (effect.operation === 'create') {
        this.createMapFeature(
          gameId,
          {
            name: effect.name,
            featureType: effect.featureType,
            regionId: effect.regionId,
            nationCode: effect.nationCode,
            coords: this.regionCoordinates(effect.regionId),
          },
          turnNumber,
          context,
        );
      } else if (effect.operation === 'update') {
        this.updateMapFeature(
          gameId,
          effect.featureId,
          {
            ...(effect.name !== undefined ? { name: effect.name } : {}),
            ...(effect.regionId !== undefined ? { regionId: effect.regionId } : {}),
            ...(effect.nationCode !== undefined ? { nationCode: effect.nationCode } : {}),
          },
          turnNumber,
          context,
        );
      } else {
        this.deleteMapFeature(gameId, effect.featureId, turnNumber, context);
      }
      return;
    }

    if (effect.kind === 'law') {
      if (!this.catalog.nations.has(effect.nationCode)) {
        throw new AppError(400, 'UNKNOWN_NATION', 'The law nation does not exist.');
      }
      const date = text(
        (
          this.database
            .prepare('SELECT games.current_date FROM games WHERE id = ?')
            .get(gameId) as Row
        ).current_date,
      );
      if (effect.operation === 'enact') {
        const id = randomUUID();
        const value = {
          id,
          game_id: gameId,
          nation_code: effect.nationCode,
          title_fr: effect.title,
          title_en: effect.title,
          summary_fr: effect.summary,
          summary_en: effect.summary,
          category: effect.category,
          enacted_date: date,
          status: 'active',
          repealed_date: null,
          source: 'player',
          source_action_id: context.sourceActionId ?? null,
        };
        this.insertRows('country_laws', [value]);
        this.recordMutation(gameId, turnNumber, 'law', id, null, value, context);
      } else {
        const row = this.database
          .prepare(
            `SELECT * FROM country_laws
             WHERE id = ? AND game_id = ? AND nation_code = ? AND status = 'active'`,
          )
          .get(effect.lawId, gameId, effect.nationCode) as Row | undefined;
        if (!row) throw notFound('Active law');
        this.database
          .prepare(
            `UPDATE country_laws SET status = 'repealed', repealed_date = ?
             WHERE id = ? AND game_id = ?`,
          )
          .run(date, effect.lawId, gameId);
        this.recordMutation(
          gameId,
          turnNumber,
          'law',
          effect.lawId,
          row,
          { ...row, status: 'repealed', repealed_date: date },
          context,
        );
      }
      return;
    }

    if (effect.kind === 'capital') {
      if (!this.catalog.nations.has(effect.nationCode)) {
        throw new AppError(400, 'UNKNOWN_NATION', 'The capital nation does not exist.');
      }
      if (effect.featureId) {
        const feature = this.database
          .prepare('SELECT * FROM map_features WHERE id = ? AND game_id = ?')
          .get(effect.featureId, gameId) as Row | undefined;
        if (!feature) throw notFound('Capital feature');
      }
      const before = this.database
        .prepare('SELECT * FROM nation_states WHERE game_id = ? AND nation_code = ?')
        .get(gameId, effect.nationCode) as Row | undefined;
      if (!before) throw notFound('Nation state');
      const status = effect.featureId ? 'established' : 'lost';
      this.database
        .prepare(
          `UPDATE nation_states SET capital_feature_id = ?, capital_status = ?
           WHERE game_id = ? AND nation_code = ?`,
        )
        .run(effect.featureId, status, gameId, effect.nationCode);
      this.recordMutation(
        gameId,
        turnNumber,
        'capital',
        effect.nationCode,
        before,
        { ...before, capital_feature_id: effect.featureId, capital_status: status },
        context,
      );
      return;
    }

    this.applyNationAdjustment(gameId, turnNumber, effect, context);
  }

  private applyUnitChange(
    gameId: string,
    turnNumber: number,
    change: GeneratedUnitChange,
    context: MutationContext = { source: 'simulation' },
  ) {
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
      this.recordMutation(gameId, turnNumber, 'unit', id, null, value, context);
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
      this.recordMutation(gameId, turnNumber, 'unit', change.unit_id, row, null, context);
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
    this.recordMutation(gameId, turnNumber, 'unit', change.unit_id, row, updated, context);
  }

  private applyFeatureChange(
    gameId: string,
    turnNumber: number,
    change: GeneratedMapFeatureChange,
    context: MutationContext = { source: 'simulation' },
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
        context,
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
      this.deleteMapFeature(gameId, change.feature_id, turnNumber, context);
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
      context,
    );
  }

  private updateCapitalAfterTerritoryEffect(
    gameId: string,
    turnNumber: number,
    regionId: string,
    formerOwner: string | null,
    effect: WorldEffect,
    context: MutationContext,
  ) {
    if (!formerOwner || effect.kind !== 'territory') return;
    const before = this.database
      .prepare(
        `SELECT ns.* FROM nation_states ns
         JOIN map_features mf ON mf.id = ns.capital_feature_id AND mf.game_id = ns.game_id
         WHERE ns.game_id = ? AND ns.nation_code = ? AND mf.region_id = ?`,
      )
      .get(gameId, formerOwner, regionId) as Row | undefined;
    if (!before) return;
    this.database
      .prepare(
        `UPDATE nation_states SET capital_feature_id = NULL, capital_status = 'lost'
         WHERE game_id = ? AND nation_code = ?`,
      )
      .run(gameId, formerOwner);
    this.recordMutation(
      gameId,
      turnNumber,
      'capital',
      formerOwner,
      before,
      { ...before, capital_feature_id: null, capital_status: 'lost' },
      context,
    );
    this.database
      .prepare(
        `UPDATE map_features SET nation_code = ?, feature_type = 'city', updated_at = ?
         WHERE id = ? AND game_id = ?`,
      )
      .run(effect.nationCode, now(), sqlValue(before.capital_feature_id), gameId);
  }

  private updateCapitalOccupation(
    gameId: string,
    turnNumber: number,
    regionId: string,
    controllerNationCode: string | null,
    context: MutationContext,
  ) {
    const capital = this.database
      .prepare(
        `SELECT ns.*, mf.region_id FROM nation_states ns
         JOIN map_features mf ON mf.id = ns.capital_feature_id AND mf.game_id = ns.game_id
         WHERE ns.game_id = ? AND mf.region_id = ?`,
      )
      .get(gameId, regionId) as Row | undefined;
    if (!capital) return;
    const status = controllerNationCode === text(capital.nation_code) ? 'established' : 'occupied';
    if (text(capital.capital_status) === status) return;
    this.database
      .prepare(`UPDATE nation_states SET capital_status = ? WHERE game_id = ? AND nation_code = ?`)
      .run(status, gameId, sqlValue(capital.nation_code));
    this.recordMutation(
      gameId,
      turnNumber,
      'capital',
      text(capital.nation_code),
      capital,
      { ...capital, capital_status: status },
      context,
    );
  }

  private applyNationAdjustment(
    gameId: string,
    turnNumber: number,
    effect: Extract<WorldEffect, { kind: 'nation' }>,
    context: MutationContext,
  ) {
    const before = this.database
      .prepare('SELECT * FROM nation_states WHERE game_id = ? AND nation_code = ?')
      .get(gameId, effect.nationCode) as Row | undefined;
    if (!before) throw notFound('Nation state');
    const allowed: Record<string, string> = {
      stability: 'stability',
      warSupport: 'war_support',
      manpower: 'manpower',
      politicalPower: 'political_power',
      treasury: 'treasury',
      atWar: 'at_war',
      occupiedRegions: 'occupied_regions',
      population: 'population',
      gdp: 'gdp',
      happiness: 'happiness',
      literacy: 'literacy',
      unemployment: 'unemployment',
      inflation: 'inflation',
      industrialCapacity: 'industrial_capacity',
      health: 'health',
      foodSecurity: 'food_security',
    };
    const assignments: string[] = [];
    const values: SQLInputValue[] = [];
    const after = { ...before };
    for (const [key, value] of Object.entries(effect.changes)) {
      const column = allowed[key];
      if (!column) {
        throw new AppError(400, 'INVALID_WORLD_EFFECT', `Unsupported nation indicator: ${key}.`);
      }
      assignments.push(`${column} = ?`);
      const persisted =
        typeof value === 'boolean'
          ? value
            ? 1
            : 0
          : Array.isArray(value)
            ? JSON.stringify(value)
            : value;
      values.push(persisted);
      after[column] = persisted;
    }
    if (assignments.length === 0) return;
    this.database
      .prepare(
        `UPDATE nation_states SET ${assignments.join(', ')}
         WHERE game_id = ? AND nation_code = ?`,
      )
      .run(...values, gameId, effect.nationCode);
    this.recordMutation(gameId, turnNumber, 'nation', effect.nationCode, before, after, context);
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

  private currentWorldRevision(gameId: string) {
    const row = this.database
      .prepare('SELECT world_revision FROM games WHERE id = ?')
      .get(gameId) as Row | undefined;
    if (!row) throw notFound('Game');
    return number(row.world_revision);
  }

  private bumpWorldRevision(gameId: string) {
    this.database
      .prepare('UPDATE games SET world_revision = world_revision + 1, updated_at = ? WHERE id = ?')
      .run(now(), gameId);
  }

  private recordMutation(
    gameId: string,
    turnNumber: number,
    mutationType: AppliedMutation['mutationType'],
    targetId: string,
    before: unknown,
    after: unknown,
    context: MutationContext = { source: 'simulation' },
  ) {
    const worldRevision =
      context.source === 'manual'
        ? this.currentWorldRevision(gameId) + 1
        : this.currentWorldRevision(gameId) + 1;
    this.database
      .prepare(
        `INSERT INTO world_mutations (
          id, game_id, turn_number, mutation_source, source_action_id, source_event_id,
          mutation_type, target_id, before_value, after_value, effect_json, world_revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        gameId,
        turnNumber,
        context.source,
        context.sourceActionId ?? null,
        context.sourceEventId ?? null,
        mutationType,
        targetId,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        context.effect ? JSON.stringify(context.effect) : null,
        worldRevision,
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

  private nationExistsForGame(gameId: string, nationCode: string) {
    return Boolean(
      this.database
        .prepare('SELECT 1 FROM game_polities WHERE game_id = ? AND nation_code = ?')
        .get(gameId, nationCode) || this.catalog.nations.has(nationCode),
    );
  }

  private markHistoricalDivergence(
    gameId: string,
    entityType: 'polity' | 'office' | 'capital' | 'region',
    entityId: string,
    reason: string,
  ) {
    const game = this.database
      .prepare(
        'SELECT games.current_date AS game_date, historical_baseline_mode FROM games WHERE id = ?',
      )
      .get(gameId) as Row | undefined;
    if (!game || text(game.historical_baseline_mode) !== 'historical_v1') return;
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO historical_continuity (
          game_id, entity_type, entity_id, continuity_status, diverged_at, reason, updated_at
        ) VALUES (?, ?, ?, 'diverged', ?, ?, ?)
        ON CONFLICT(game_id, entity_type, entity_id) DO UPDATE SET
          continuity_status = 'diverged', diverged_at = excluded.diverged_at,
          reason = excluded.reason, updated_at = excluded.updated_at`,
      )
      .run(gameId, entityType, entityId, text(game.game_date), reason, timestamp);
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
}
