import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite';
import type {
  CreatePresetInput,
  Preset,
  PresetDetail,
  PresetHelper,
  PresetInitialWorld,
  PresetPrompt,
  UpdatePresetInput,
} from '@what-if-history/contracts';
import type { Catalog } from '../catalog.js';
import { AppError, notFound } from '../errors.js';
import { now, number, parseJson, text, type Row } from './values.js';

export class PresetRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly catalog: Catalog,
  ) {}

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
      initialWorld: parseJson<PresetInitialWorld>(row.initial_world_json, {
        regions: [],
        capitalRegionIds: {},
      }),
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
            initial_world_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?)`,
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
          JSON.stringify(normalized.initialWorld),
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
      initialWorld: input.initialWorld ?? current.initialWorld,
    });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `UPDATE presets SET title = ?, summary = ?, category = ?, tags = ?, start_date = ?,
           world_context = ?, simulation_rules = ?, recommended_difficulty = ?,
           playable_nation_codes = ?, ai_models = ?, initial_world_json = ?,
           updated_at = ? WHERE id = ?`,
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
          JSON.stringify(normalized.initialWorld),
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
      initialWorld: input.initialWorld ?? { regions: [], capitalRegionIds: {} },
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

  private expectChange(result: StatementResultingChanges, resource: string) {
    if (result.changes === 0) throw notFound(resource);
  }
}
