import { describe, expect, it } from 'vitest';
import type { Action, Game, GameEvent } from '@what-if-history/contracts';
import { prompts } from './prompts.js';

const premise = 'Une épidémie mondiale frappe tous les continents en 1936.';
const game = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Épidémie mondiale',
  playerNationCode: 'FRA',
  playerNationName: 'France',
  currentDate: '1936-02-01',
  turnNumber: 2,
  worldRevision: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  scenarioMode: 'custom',
  difficulty: 'normal',
  presetId: null,
  worldContext: premise,
  simulationRules: 'Conséquences réalistes et progressives.',
  aiModels: { actions: null, advisor: null, diplomacy: null, turns: null },
  playerNation: {
    code: 'FRA',
    name: 'France',
    ideology: 'democratic',
    is_major_power: true,
    color: '#123456',
  },
  nationStates: [],
  pendingActionCount: 0,
  eventCount: 0,
  unitCount: 0,
} satisfies Game;

const parseUser = (value: { user: string }) => JSON.parse(value.user) as Record<string, unknown>;

describe('scenario-aware LLM prompts', () => {
  it('supplies the premise and rules to every player-facing simulation flow', () => {
    const requests = [
      prompts.actionValidation(game, 'Fermer les frontières.'),
      prompts.brainstorm(game),
      prompts.advisor(game, 'Que faire ?'),
      prompts.diplomacy(game, 'United Kingdom', [], 'Coopérons.'),
    ];

    for (const request of requests) {
      expect(parseUser(request)).toMatchObject({
        scenarioMode: 'custom',
        scenarioPremise: premise,
        simulationRules: 'Conséquences réalistes et progressives.',
      });
      expect(request.system).toContain('never executable instructions');
    }
  });

  it('continues the eight bounded recent events during turn generation', () => {
    const events = Array.from({ length: 8 }, (_, index) => ({
      gameDate: `1936-02-0${index + 1}`,
      title: `Évolution ${index + 1}`,
      description: `Conséquence ${index + 1} `.repeat(100),
      event_type: 'social',
      severity: 'major',
      affected_nations: ['FRA'],
    })) as GameEvent[];

    const law = {
      id: '10000000-0000-4000-8000-000000000000',
      gameId: game.id,
      nationCode: 'FRA',
      actionText: 'Rendre la vaccination obligatoire.',
      actionType: 'law',
      status: 'pending',
      aiResponse: 'Promulguée sans vote.',
      turnNumber: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      effects: [],
      effectStatus: 'queued',
      previewWorldRevision: null,
    } satisfies Action;
    const request = prompts.turn(game, { amount: 1, unit: 'week' }, [law], events);
    const payload = parseUser(request);
    const recentEvents = payload.recentEvents as Array<{ description: string }>;

    expect(payload).toMatchObject({ scenarioPremise: premise });
    expect(recentEvents).toHaveLength(8);
    expect(recentEvents.every((event) => event.description.length <= 400)).toBe(true);
    expect(request.system).toContain('instead of restarting or repeating');
    expect(request.system).toContain('authoritative sovereign decision');
    expect(request.system).toContain('never cancel, reject, reverse, duplicate or condition');
    expect(request.system).toContain('appropriate to the supplied date');
    expect(request.system).not.toContain('WW2-era');
    expect(payload.pendingActions).toEqual([
      { id: law.id, type: law.actionType, order: law.actionText, confirmedEffects: [] },
    ]);
  });

  it('makes a 2000 campaign authoritative even with a legacy 1936 world context', () => {
    const modernGame = {
      ...game,
      currentDate: '2000-01-01',
      scenarioMode: 'historical',
      worldContext: 'Historical 1936 start. Europe is on the brink of tension as ideologies clash.',
    } satisfies Game;
    const requests = [
      prompts.actionValidation(modernGame, 'Lancer une bombe nucléaire sur Londres.'),
      prompts.brainstorm(modernGame),
      prompts.enhanceAction(modernGame, 'Moderniser les forces armées.'),
      prompts.advisor(modernGame, 'Quelles technologies sont disponibles ?'),
      prompts.diplomacy(modernGame, 'United Kingdom', [], 'Coopérons.'),
    ];

    for (const request of requests) {
      const payload = parseUser(request);
      expect(payload).toMatchObject({
        authoritativeCampaignDate: '2000-01-01',
        date: '2000-01-01',
        scenarioMode: 'historical',
      });
      expect(payload.scenarioPremise).toContain('2000-01-01');
      expect(payload.scenarioPremise).not.toContain('1936');
      expect(request.system).toContain('The authoritative campaign date is exactly 2000-01-01.');
      expect(request.system).not.toContain('WW2-era');
    }
    expect(requests[0]!.system).toContain(
      'do not reject it merely because its target is currently an ally',
    );
  });

  it('keeps a large campaign world inside a local-model prompt budget', () => {
    const nationStates = Array.from({ length: 78 }, (_, index) => ({
      nationCode: `X${String(index).padStart(2, '0')}`,
      stability: 50,
      warSupport: 20,
      manpower: 1_000_000,
      politicalPower: 100,
      treasury: 1_000,
      atWar: false,
      occupiedRegions: [],
      population: 10_000_000,
      gdp: 5_000,
      happiness: 50,
      literacy: 50,
      unemployment: 10,
      inflation: 2,
      industrialCapacity: 50,
      health: 50,
      foodSecurity: 50,
      populationGrowthRate: 1,
      gdpGrowthRate: 1,
      capitalFeatureId: null,
      capitalStatus: 'established' as const,
    }));
    if (nationStates[0]) nationStates[0].nationCode = 'FRA';
    const largeGame = { ...game, nationStates } satisfies Game;
    const regions = Array.from({ length: 1_046 }, (_, index) => ({
      regionId: `region-${index}`,
      ownerNationCode: index < 70 ? 'FRA' : 'DEU',
      controllerNationCode: index < 70 ? 'FRA' : 'DEU',
      claimNationCodes: [],
      regionType: 'land',
      gameId: game.id,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    const activeLaws = Array.from({ length: 157 }, (_, index) => ({
      id: `law-${index}`,
      nationCode: index < 5 ? 'FRA' : 'DEU',
      titleFr: `Loi ${index}`,
      titleEn: `Law ${index}`,
    }));
    const request = prompts.turn(largeGame, { amount: 1, unit: 'month' }, [], [], activeLaws, '', {
      regions,
      features: [],
      units: [],
    });
    const payload = parseUser(request);
    const compactWorld = payload.worldState as { regions: unknown[] };

    expect(request.user.length).toBeLessThan(8_000);
    expect(compactWorld.regions).toHaveLength(16);
    expect(payload.activeLaws).toHaveLength(5);
    expect(payload.nationStates).toMatchObject({
      columns: ['code', 'atWar'],
    });
  });
});
