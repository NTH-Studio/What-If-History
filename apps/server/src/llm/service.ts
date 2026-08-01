import { z, ZodError, type ZodType } from 'zod';
import {
  generatedTurnSchema,
  type Action,
  type ChatMessage,
  type Game,
  type GameEvent,
  type GameRegion,
  type GeneratedTurn,
  type LlmSettingsInput,
  type LlmTokenUsage,
  type TimeJump,
} from '@what-if-history/contracts';
import type { Repository } from '../db/repository.js';
import type { AdvancedRepository } from '../db/advanced-repository.js';
import { AppError } from '../errors.js';
import { prompts } from './prompts.js';
import type { LlmActivityHandle } from './activity.js';
import {
  createProvider,
  assertLlmProviderAllowed,
  structuredOutputModeFor,
  toPrivateSettings,
  type CompletionRequest,
  type CompletionResult,
} from './providers.js';
import {
  actionValidationResponseSchema,
  generatedTurnResponseSchemaFor,
} from './response-schemas.js';

const actionValidationSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().max(500),
});

function projectRegions(regions: GameRegion[], actions: Action[]): GameRegion[] {
  const projected = new Map(
    regions.map((region) => [
      region.regionId,
      { ...region, claimNationCodes: [...region.claimNationCodes] },
    ]),
  );
  for (const action of actions) {
    for (const effect of action.effects) {
      if (effect.kind !== 'territory') continue;
      const region = projected.get(effect.regionId);
      if (!region) continue;
      const formerOwner = region.ownerNationCode;
      if (effect.operation === 'cede') {
        region.ownerNationCode = effect.nationCode;
        region.controllerNationCode = effect.nationCode;
        region.claimNationCodes = region.claimNationCodes.filter(
          (code) => code !== formerOwner && code !== effect.nationCode,
        );
      } else if (effect.operation === 'annex') {
        region.ownerNationCode = effect.nationCode;
        region.controllerNationCode = effect.nationCode;
        region.claimNationCodes = [
          ...new Set([
            ...region.claimNationCodes.filter((code) => code !== effect.nationCode),
            ...(formerOwner && formerOwner !== effect.nationCode ? [formerOwner] : []),
          ]),
        ];
      } else if (effect.operation === 'occupy') {
        region.controllerNationCode = effect.nationCode;
      } else if (effect.operation === 'liberate') {
        region.controllerNationCode = region.ownerNationCode;
      } else if (effect.operation === 'add_claim') {
        region.claimNationCodes = [...new Set([...region.claimNationCodes, effect.nationCode])];
      } else {
        region.claimNationCodes = region.claimNationCodes.filter(
          (code) => code !== effect.nationCode,
        );
      }
    }
  }
  return [...projected.values()];
}

export type GenerationLanguage = 'fr' | 'en';
export interface LlmResult<T> {
  value: T;
  usage: LlmTokenUsage | undefined;
  schemaMode?: 'native_json_schema' | 'json_mode' | 'server_validation';
  repairAttempts?: number;
}

const languageInstructions: Record<GenerationLanguage, string> = {
  fr: [
    'Réponds exclusivement en français.',
    'Tous les textes destinés au joueur doivent être rédigés dans un français naturel.',
    'Pour une réponse JSON, conserve exactement les noms de propriétés demandés,',
    'mais écris en français toutes les valeurs textuelles comme les titres, descriptions et raisons.',
  ].join(' '),
  en: [
    'Reply exclusively in English.',
    'All player-facing text must be written in natural English.',
    'For a JSON response, preserve the requested property names exactly,',
    'and write every textual value such as titles, descriptions and reasons in English.',
  ].join(' '),
};

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? content).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // Fall through to the controlled error below.
      }
    }
  }
  throw new AppError(502, 'LLM_INVALID_RESPONSE', 'The AI response was not valid JSON.');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function repairCandidates(initial: unknown, repaired: unknown) {
  const candidates = [repaired];
  if (isJsonObject(initial) && isJsonObject(repaired)) {
    candidates.push({ ...initial, ...repaired });
  }
  return candidates;
}

function structuredIssues(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
  }
  if (error instanceof AppError && error.code === 'LLM_INVALID_RESPONSE') {
    return [{ path: '', message: error.message }];
  }
  return null;
}

function mergeUsage(
  first: LlmTokenUsage | undefined,
  second: LlmTokenUsage | undefined,
): LlmTokenUsage | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

function firstStringColumn(rows: unknown[][]) {
  return rows.flatMap((row) => (typeof row[0] === 'string' ? [row[0]] : []));
}

export class LlmService {
  constructor(
    private readonly repository: Repository,
    private readonly advanced: AdvancedRepository,
    private readonly timeoutMs: number,
    private readonly allowFakeProvider: boolean,
  ) {}

  private settingsForGame(game: Game, mechanic: keyof Game['aiModels']) {
    const settings = this.repository.getLlmSettingsPrivate();
    const model = game.aiModels[mechanic];
    return model ? { ...settings, model } : settings;
  }

  private withPresetPrompt(
    game: Game,
    mechanic: 'actions' | 'advisor' | 'diplomacy' | 'turns' | 'consolidation',
    request: CompletionRequest,
  ): CompletionRequest {
    if (!game.presetId) return request;
    const preview = this.advanced
      .previewPreset(game.presetId, game.id)
      .prompts.find((item) => item.mechanic === mechanic && item.mode === 'custom');
    if (!preview?.preview.trim()) return request;
    return {
      ...request,
      system: `${request.system}\n\nPreset-specific instructions:\n${preview.preview}`,
    };
  }

  private async complete(
    request: CompletionRequest,
    activity: LlmActivityHandle,
    settings = this.repository.getLlmSettingsPrivate(),
  ): Promise<CompletionResult> {
    assertLlmProviderAllowed(settings.provider, this.allowFakeProvider);
    activity.phase('waiting_provider');
    const result = await createProvider(settings, this.timeoutMs).complete(request);
    activity.phase('validating_response');
    return result;
  }

  private localized(request: CompletionRequest, language: GenerationLanguage): CompletionRequest {
    return {
      ...request,
      system: `${request.system}\n\n${languageInstructions[language]}`,
    };
  }

  private async parseOrRepair<T>(
    initial: CompletionResult,
    schema: ZodType<T>,
    expectedOutput: unknown,
    activity: LlmActivityHandle,
    settings: ReturnType<Repository['getLlmSettingsPrivate']>,
    maxTokens: number,
    responseSchema?: CompletionRequest['responseSchema'],
  ): Promise<LlmResult<T>> {
    let initialValue: unknown;
    try {
      initialValue = extractJson(initial.text);
      return {
        value: schema.parse(initialValue),
        usage: initial.usage,
        repairAttempts: 0,
      };
    } catch (error) {
      const issues = structuredIssues(error);
      if (!issues) throw error;
      const repaired = await this.complete(
        {
          system:
            'You repair an AI simulation response. Return one strict JSON object only, with no ' +
            'markdown, commentary or reasoning. Preserve the intended facts, but correct every ' +
            'syntax, type, enum, range and required-field error listed by the validator.',
          user: JSON.stringify({
            expectedOutput,
            validationErrors: issues,
            invalidResponse: initial.text.slice(0, 16_000),
          }),
          maxTokens,
          temperature: 0,
          responseFormat: 'json',
          ...(responseSchema ? { responseSchema } : {}),
        },
        activity,
        settings,
      );
      let repairedValue: unknown;
      try {
        repairedValue = extractJson(repaired.text);
      } catch (repairError) {
        const repairIssues = structuredIssues(repairError);
        if (!repairIssues) throw repairError;
        throw new AppError(
          502,
          'INVALID_AI_RESPONSE',
          'The AI response did not match the required simulation format after one repair attempt.',
          repairIssues,
        );
      }

      let lastRepairError: unknown;
      for (const candidate of repairCandidates(initialValue, repairedValue)) {
        try {
          return {
            value: schema.parse(candidate),
            usage: mergeUsage(initial.usage, repaired.usage),
            repairAttempts: 1,
          };
        } catch (repairError) {
          lastRepairError = repairError;
        }
      }

      const repairIssues = structuredIssues(lastRepairError);
      if (!repairIssues) throw lastRepairError;
      throw new AppError(
        502,
        'INVALID_AI_RESPONSE',
        'The AI response did not match the required simulation format after one repair attempt.',
        repairIssues,
      );
    }
  }

  async test(input: LlmSettingsInput, activity: LlmActivityHandle) {
    const existing = this.repository.getLlmSettingsPrivate();
    const settings = toPrivateSettings(input, existing.apiKey);
    const result = await this.complete(
      {
        system: 'Reply with OK only.',
        user: 'Connection test.',
        maxTokens: 10,
        temperature: 0,
      },
      activity,
      settings,
    );
    return {
      value: { success: true, model: settings.model, response: result.text.slice(0, 40) },
      usage: result.usage,
    };
  }

  async validateAction(
    game: Game,
    text: string,
    activity: LlmActivityHandle,
    language: GenerationLanguage = 'fr',
  ) {
    const result = await this.complete(
      this.localized(
        this.withPresetPrompt(game, 'actions', {
          ...prompts.actionValidation(game, text),
          maxTokens: 300,
          temperature: 0.2,
          responseFormat: 'json',
          responseSchema: {
            name: 'action_validation',
            schema: actionValidationResponseSchema,
          },
        }),
        language,
      ),
      activity,
      this.settingsForGame(game, 'actions'),
    );
    const parsed = await this.parseOrRepair(
      result,
      actionValidationSchema,
      { accepted: true, reason: '1-500 chars' },
      activity,
      this.settingsForGame(game, 'actions'),
      300,
      {
        name: 'action_validation',
        schema: actionValidationResponseSchema,
      },
    );
    return parsed;
  }

  async brainstorm(
    game: Game,
    activity: LlmActivityHandle,
    language: GenerationLanguage = 'fr',
  ): Promise<LlmResult<string>> {
    const result = await this.complete(
      this.localized(
        this.withPresetPrompt(game, 'actions', {
          ...prompts.brainstorm(game),
          maxTokens: 800,
          temperature: 0.7,
        }),
        language,
      ),
      activity,
      this.settingsForGame(game, 'actions'),
    );
    return { value: result.text, usage: result.usage };
  }

  async enhanceAction(
    game: Game,
    text: string,
    activity: LlmActivityHandle,
    language: GenerationLanguage = 'fr',
  ): Promise<LlmResult<string>> {
    const result = await this.complete(
      this.localized(
        this.withPresetPrompt(game, 'actions', {
          ...prompts.enhanceAction(game, text),
          maxTokens: 1_000,
          temperature: 0.35,
        }),
        language,
      ),
      activity,
      this.settingsForGame(game, 'actions'),
    );
    const value = result.text.trim();
    if (!value) throw new AppError(502, 'LLM_INVALID_RESPONSE', 'The improved action was empty.');
    return { value, usage: result.usage };
  }

  async advise(
    game: Game,
    question: string,
    activity: LlmActivityHandle,
    language: GenerationLanguage = 'fr',
  ): Promise<LlmResult<string>> {
    const result = await this.complete(
      this.localized(
        this.withPresetPrompt(game, 'advisor', {
          ...prompts.advisor(game, question),
          maxTokens: 1_500,
          temperature: 0.5,
        }),
        language,
      ),
      activity,
      this.settingsForGame(game, 'advisor'),
    );
    return { value: result.text, usage: result.usage };
  }

  async diplomaticReply(
    game: Game,
    targetNationName: string,
    history: ChatMessage[],
    message: string,
    activity: LlmActivityHandle,
    language: GenerationLanguage = 'fr',
  ): Promise<LlmResult<string>> {
    const result = await this.complete(
      this.localized(
        this.withPresetPrompt(game, 'diplomacy', {
          ...prompts.diplomacy(game, targetNationName, history, message),
          maxTokens: 1_000,
          temperature: 0.7,
        }),
        language,
      ),
      activity,
      this.settingsForGame(game, 'diplomacy'),
    );
    return { value: result.text, usage: result.usage };
  }

  async generateTurn(
    game: Game,
    jump: TimeJump,
    actions: Action[],
    recentEvents: GameEvent[],
    activity: LlmActivityHandle,
    language: GenerationLanguage = 'fr',
    characters: unknown[] = [],
  ): Promise<LlmResult<GeneratedTurn>> {
    const turnPrompt = prompts.turn(
      game,
      jump,
      actions,
      recentEvents,
      this.repository.listActiveLawsForSimulation(game.id),
      this.advanced.consolidationContext(game.id),
      {
        regions: projectRegions(this.advanced.listRegions(game.id), actions),
        features: this.advanced.listMapFeatures(game.id),
        units: this.repository.listUnits(game.id),
        characters,
      },
    );
    const turnContext = JSON.parse(turnPrompt.user) as {
      output: unknown;
      worldState: {
        regions: unknown[][];
        features: unknown[][];
        units: unknown[][];
        characters: unknown[][];
      };
    };
    const expectedOutput = turnContext.output;
    const responseSchema = generatedTurnResponseSchemaFor({
      nationCodes: game.nationStates.map((state) => state.nationCode),
      regionIds: firstStringColumn(turnContext.worldState.regions),
      featureIds: firstStringColumn(turnContext.worldState.features),
      unitIds: firstStringColumn(turnContext.worldState.units),
      characterIds: firstStringColumn(turnContext.worldState.characters),
      lawIds: this.repository
        .listActiveLawsForSimulation(game.id)
        .filter((law) => law.nationCode === game.playerNation.code)
        .slice(0, 20)
        .map((law) => law.id),
    });
    const settings = this.settingsForGame(game, 'turns');
    const result = await this.complete(
      this.localized(
        this.withPresetPrompt(game, 'turns', {
          ...turnPrompt,
          maxTokens: 1_500,
          temperature: 0.3,
          responseFormat: 'json',
          responseSchema: {
            name: 'generated_turn',
            schema: responseSchema,
          },
        }),
        language,
      ),
      activity,
      settings,
    );
    const parsed = await this.parseOrRepair(
      result,
      generatedTurnSchema,
      expectedOutput,
      activity,
      settings,
      1_500,
      {
        name: 'generated_turn',
        schema: responseSchema,
      },
    );
    return {
      ...parsed,
      schemaMode: structuredOutputModeFor(settings),
    };
  }
}
