import type {
  EventLocation,
  GeneratedEvent,
  TimeJump,
  TurnResult,
} from '@what-if-history/contracts';
import { addTime, applyEventChanges, applyNaturalEvolution } from '@what-if-history/core';
import type { Repository } from './db/repository.js';
import type { AdvancedRepository } from './db/advanced-repository.js';
import type { StrategicRepository } from './db/strategic-repository.js';
import { AppError } from './errors.js';
import type { LlmActivityTracker } from './llm/activity.js';
import type { GenerationLanguage, LlmService } from './llm/service.js';
import type { SseHub } from './sse.js';

export class TurnService {
  private readonly activeGames = new Set<string>();

  constructor(
    private readonly repository: Repository,
    private readonly advanced: AdvancedRepository,
    private readonly strategic: StrategicRepository,
    private readonly llm: LlmService,
    private readonly stream: SseHub,
    private readonly activity: LlmActivityTracker,
  ) {}

  async advance(
    gameId: string,
    jump: TimeJump,
    request: { requestId: string; clientId: string },
    idempotencyKey: string,
    language: GenerationLanguage = 'fr',
  ): Promise<TurnResult> {
    const completed = this.advanced.findCompletedTurnResult(gameId, idempotencyKey);
    if (completed) return completed;
    if (this.activeGames.has(gameId)) {
      throw new AppError(
        409,
        'TURN_IN_PROGRESS',
        'A turn is already being generated for this game.',
      );
    }
    const game = this.repository.getGame(gameId);
    const actions = this.repository.listActions(gameId);
    const pendingActions = actions.filter((action) => action.status === 'pending');
    this.advanced.validateQueuedActionRevisions(gameId, pendingActions);
    const recentEvents = this.repository.listEvents(gameId).slice(0, 8).reverse();
    const turnRunId = this.advanced.startTurnRun(gameId, game.turnNumber, jump, idempotencyKey);
    const snapshot = this.advanced.createSnapshot(
      gameId,
      language === 'en' ? `Before turn ${game.turnNumber}` : `Avant le tour ${game.turnNumber}`,
    );
    this.advanced.updateTurnRun(turnRunId, 'generating', { snapshotId: snapshot.id });

    this.activeGames.add(gameId);
    this.stream.publish(gameId, 'turn.started', { gameId, jump, turnNumber: game.turnNumber });
    const activity = this.activity.start({
      gameId,
      gameName: game.name,
      requestId: request.requestId,
      clientId: request.clientId,
      type: 'turn_generation',
    });
    try {
      const generated = await this.llm.generateTurn(
        game,
        jump,
        pendingActions,
        recentEvents,
        activity,
        language,
        this.strategic.listCharacters(gameId),
      );
      const effectiveJump: TimeJump =
        jump.strategy === 'next_major_event'
          ? {
              ...jump,
              amount: Math.min(jump.amount, generated.value.time_advance_amount ?? jump.amount),
            }
          : jump;
      const generatedEvents = this.resolveAndValidateEventLocations(
        gameId,
        game.nationStates.map((state) => state.nationCode),
        generated.value.events,
      );
      const confirmedTerritoryIds = new Set(
        pendingActions
          .filter((action) => action.mode === 'imposed')
          .flatMap((action) =>
            action.effects
              .filter((effect) => effect.kind === 'territory')
              .map((effect) => effect.regionId),
          ),
      );
      const secondaryRegionChanges = generated.value.region_changes.filter(
        (change) => !confirmedTerritoryIds.has(change.region_id),
      );
      const nextDate = addTime(game.currentDate, effectiveJump);
      const states = applyEventChanges(
        applyNaturalEvolution(
          new Map(game.nationStates.map((state) => [state.nationCode, state])),
          effectiveJump,
        ),
        generatedEvents,
      );
      activity.phase('applying_result');
      this.advanced.updateTurnRun(turnRunId, 'applying');
      let result: TurnResult | undefined;
      this.repository.commitTurn(
        gameId,
        game.turnNumber,
        nextDate,
        states,
        generatedEvents,
        generated.value.law_changes,
        (persistedEvents) => {
          this.advanced.applyActionEffects(gameId, game.turnNumber, pendingActions);
          this.advanced.recordNationStateChanges(
            gameId,
            game.turnNumber,
            game.nationStates,
            states,
            persistedEvents,
          );
          this.advanced.applyWorldChanges(
            gameId,
            game.turnNumber,
            secondaryRegionChanges,
            generated.value.unit_changes,
            generated.value.map_feature_changes,
            persistedEvents.length === 1 ? persistedEvents[0]?.id : undefined,
          );
          this.strategic.applyCharacterChanges(
            gameId,
            generated.value.character_changes,
            nextDate,
            game.turnNumber,
          );
          this.strategic.advanceDailySimulation(
            gameId,
            game.currentDate,
            nextDate,
            game.turnNumber,
          );
          for (const event of persistedEvents) {
            this.strategic.appendEventTimeline(gameId, event);
          }
          const worldRevision = game.worldRevision + 1;
          const appliedMutations = this.advanced
            .listWorldMutations(gameId)
            .filter((mutation) => mutation.worldRevision === worldRevision);
          result = {
            previousDate: game.currentDate,
            newDate: nextDate,
            turnNumber: game.turnNumber + 1,
            events: persistedEvents,
            processedActions: pendingActions.length,
            worldRevision,
            appliedMutations,
          };
          this.advanced.completeTurnRunInTransaction(
            turnRunId,
            result,
            generated.value,
            generated.schemaMode ?? 'server_validation',
            generated.repairAttempts ?? 0,
          );
        },
      );
      if (!result) throw new AppError(500, 'TURN_COMMIT_FAILED', 'The turn result was not stored.');
      this.advanced.maybeCreateConsolidation(gameId, game.turnNumber);
      activity.succeed(generated.usage);
      this.stream.publish(gameId, 'world.changed', {
        gameId,
        worldRevision: result.worldRevision,
        regionIds: [
          ...new Set(
            result.appliedMutations
              .filter((mutation) => mutation.mutationType === 'region')
              .map((mutation) => mutation.targetId),
          ),
        ],
        unitIds: [
          ...new Set(
            result.appliedMutations
              .filter((mutation) => mutation.mutationType === 'unit')
              .map((mutation) => mutation.targetId),
          ),
        ],
        featureIds: [
          ...new Set(
            result.appliedMutations
              .filter((mutation) => mutation.mutationType === 'feature')
              .map((mutation) => mutation.targetId),
          ),
        ],
      });
      this.stream.publish(gameId, 'turn.completed', result);
      return result;
    } catch (error) {
      this.advanced.updateTurnRun(turnRunId, 'failed', {
        errorCode: error instanceof AppError ? error.code : 'TURN_FAILED',
      });
      activity.fail(error);
      this.stream.publish(gameId, 'turn.failed', {
        gameId,
        turnNumber: game.turnNumber,
        code: error instanceof AppError ? error.code : 'TURN_FAILED',
      });
      throw error;
    } finally {
      this.activeGames.delete(gameId);
    }
  }

  private resolveAndValidateEventLocations(
    gameId: string,
    nationCodes: string[],
    events: GeneratedEvent[],
  ): GeneratedEvent[] {
    const regionIds = new Set(this.advanced.listRegions(gameId).map((region) => region.regionId));
    const featureIds = new Set(this.advanced.listMapFeatures(gameId).map((feature) => feature.id));
    const unitIds = new Set(this.repository.listUnits(gameId).map((unit) => unit.id));
    const allowedNations = new Set(nationCodes);

    const validateLocation = (location: EventLocation) => {
      const valid =
        location.kind === 'region'
          ? regionIds.has(location.region_id)
          : location.kind === 'feature'
            ? featureIds.has(location.feature_id)
            : location.kind === 'unit'
              ? unitIds.has(location.unit_id)
              : location.kind === 'nation'
                ? allowedNations.has(location.nation_code)
                : true;
      if (!valid) {
        throw new AppError(
          422,
          'INVALID_AI_RESPONSE',
          'An event referenced an unknown map location.',
          [{ path: 'events.map_cue.locations', message: 'Unknown geographic identifier.' }],
        );
      }
    };

    return events.map((event) => {
      const sourceLocations: EventLocation[] = event.map_cue.locations.length
        ? event.map_cue.locations
        : event.affected_nations[0]
          ? [{ kind: 'nation', role: 'primary', nation_code: event.affected_nations[0] }]
          : [{ kind: 'global', role: 'primary' }];
      sourceLocations.forEach(validateLocation);
      const primaryIndex = Math.max(
        0,
        sourceLocations.findIndex((location) => location.role === 'primary'),
      );
      const locations = sourceLocations.map((location, index) => {
        return {
          ...location,
          role: index === primaryIndex ? 'primary' : 'secondary',
        } as EventLocation;
      });
      return {
        ...event,
        map_cue: {
          ...event.map_cue,
          locations,
        },
      };
    });
  }
}
